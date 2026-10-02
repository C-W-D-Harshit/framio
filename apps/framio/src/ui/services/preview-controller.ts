import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import {
  planPreviews,
  type PreviewFrame,
  type PreviewMode,
  hiddenPreview,
} from "../preview-policy";

/** React Flow owns pointer mechanics. This scope owns preview admission and lifetime. */
export const runPreviewController = (host: {
  read(): {
    frames: readonly PreviewFrame[];
    viewport: Parameters<typeof planPreviews>[1];
  };
  subscribe(wake: () => void): () => void;
  publish(id: string, mode: PreviewMode): void;
}) =>
  Effect.gen(function* () {
    const wake = yield* Queue.sliding<void>(1);
    let modes = new Map<string, PreviewMode>();
    const ready = new Map<string, number>();
    const shown = new Map<string, number>();
    const loading = new Map<string, number>();
    const expired = new Map<string, number>();
    let navigating = false;
    const update = () => {
      const current = host.read();
      const next = planPreviews(
        current.frames,
        current.viewport,
        modes,
        ready,
        shown,
        navigating,
        loading,
        expired,
      );
      for (const [id, mode] of next) {
        if (!mode.live) {
          ready.delete(id);
          shown.delete(id);
          loading.delete(id);
          expired.delete(id);
        }
        if (mode !== modes.get(id)) host.publish(id, mode);
      }
      for (const id of modes.keys())
        if (!next.has(id)) {
          host.publish(id, hiddenPreview);
          ready.delete(id);
          shown.delete(id);
          loading.delete(id);
          expired.delete(id);
        }
      modes = next;
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const signal = () => Queue.offerUnsafe(wake, undefined);
        const unsubscribe = host.subscribe(signal);
        const controller = new AbortController();
        window.addEventListener(
          "framio:frame-state",
          ((
            event: CustomEvent<{
              id: string;
              version: number;
              phase: "ready" | "shown" | "loading" | "expired";
            }>,
          ) => {
            const { id, version, phase } = event.detail;
            if (!modes.get(id)?.live) return;
            (phase === "ready"
              ? ready
              : phase === "expired"
                ? expired
                : phase === "loading"
                  ? loading
                  : shown
            ).set(id, version);
            signal();
          }) as EventListener,
          { signal: controller.signal },
        );
        window.addEventListener(
          "framio:navigation",
          ((event: CustomEvent<boolean>) => {
            navigating = event.detail;
            signal();
          }) as EventListener,
          { signal: controller.signal },
        );
        signal();
        return () => {
          unsubscribe();
          controller.abort();
          for (const id of modes.keys()) host.publish(id, hiddenPreview);
        };
      }),
      (dispose) => Effect.sync(dispose),
    );
    yield* Stream.fromQueue(wake).pipe(
      Stream.debounce("16 millis"),
      Stream.runForEach(() => Effect.sync(update)),
    );
  });
