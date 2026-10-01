import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/** Keep the whole pinch gesture on the canvas as frames mount or swap underneath it. */
export const studioInputLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const pinches = yield* Queue.sliding<void>(1);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        window.addEventListener(
          "wheel",
          (event) => {
            // Browsers encode trackpad pinch as Ctrl+wheel. Do this synchronously,
            // including for input forwarded by a frame, before hit-testing changes.
            if (!event.ctrlKey) return;
            event.preventDefault();
            document.documentElement.classList.add("is-zooming");
            Queue.offerUnsafe(pinches, undefined);
          },
          { capture: true, passive: false, signal: controller.signal },
        );
        return controller;
      }),
      (controller) =>
        Effect.sync(() => {
          controller.abort();
          document.documentElement.classList.remove("is-zooming");
        }),
    );
    yield* Stream.fromQueue(pinches).pipe(
      Stream.debounce("200 millis"),
      Stream.runForEach(() =>
        Effect.sync(() =>
          document.documentElement.classList.remove("is-zooming"),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
