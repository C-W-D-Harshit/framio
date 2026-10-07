import { it } from "@effect/vitest";
import { expect, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import { EditController } from "../../src/ui/services/edit-controller";
import { ProjectClient } from "../../src/ui/services/project-client";
import { registerFrame } from "../../src/ui/frame-bridge";
import { frameTextEditing } from "../../src/ui/frame-bridge";
import type {
  EditResponse,
  EditOperation,
  SourcePatch,
} from "../../src/contracts/edits";

vi.mock("../../src/ui/services/analytics", () => ({
  reportError: vi.fn(),
  track: vi.fn(),
}));

const ref = "frame.tsx:0:4:aaaaaaaaaaaa";
const nextRef = "frame.tsx:0:4:bbbbbbbbbbbb";
const undo = {
  file: "frame.tsx",
  revision: "edited",
  start: 0,
  end: 4,
  text: "old",
};
const success: EditResponse = {
  ok: true,
  ref: nextRef,
  undo,
  label: "Change text",
};
type Receipt = {
  type: string;
  id?: string;
  ok?: boolean;
  ref?: string;
  index?: number;
};
type Api = Pick<ProjectClient["Service"], "edit" | "patch">;

const withController = <A>(
  api: Api,
  use: (host: {
    frame: HTMLIFrameElement;
    send(data: Record<string, unknown>, source?: Window, origin?: string): void;
    receipts: Queue.Queue<Receipt>;
  }) => Effect.Effect<A, never, EditController | Scope.Scope>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const receipts = yield* Queue.unbounded<Receipt>();
      const host = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const events = new EventTarget();
          vi.stubGlobal("window", events);
          vi.stubGlobal("location", { origin: "http://studio.test" });
          const source = {
            postMessage: (message: Receipt) =>
              Queue.offerUnsafe(receipts, message),
          } as unknown as Window;
          const frame = {
            contentWindow: source,
            isConnected: true,
            contentDocument: {
              querySelectorAll: () => [{ getAttribute: () => nextRef }],
            },
            dataset: {
              frame: "frame",
              version: "1",
              currentVersion: "1",
              shown: "true",
            },
          } as unknown as HTMLIFrameElement;
          const unregister = registerFrame(frame);
          return {
            frame,
            receipts,
            send: (
              data: Record<string, unknown>,
              sender = source,
              origin = "http://studio.test",
            ) => {
              const event = Object.assign(new Event("message"), {
                data: { source: "framio", frame: "frame", ...data },
                source: sender,
                origin,
              });
              events.dispatchEvent(event);
            },
            dispose: () => {
              unregister();
              vi.unstubAllGlobals();
            },
          };
        }),
        (host) => Effect.sync(host.dispose),
      );
      return yield* use(host).pipe(
        Effect.provide(EditController.layer),
        Effect.provideService(ProjectClient, api as ProjectClient["Service"]),
      );
    }),
  );

it.effect(
  "serializes edits, validates senders, and acknowledges the originating window",
  () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const started = yield* Queue.unbounded<EditOperation>();
      const calls: EditOperation[] = [];
      yield* withController(
        {
          edit: (operation) =>
            Effect.gen(function* () {
              calls.push(operation);
              yield* Queue.offer(started, operation);
              if (calls.length === 1) yield* Deferred.await(gate);
              return success;
            }),
          patch: () => Effect.succeed({ ok: true, inverse: undo }),
        },
        ({ frame, send, receipts }) =>
          Effect.gen(function* () {
            yield* EditController;
            send(
              { type: "edit", id: "rogue", edit: { type: "remove", ref } },
              {} as Window,
            );
            send(
              { type: "edit", id: "foreign", edit: { type: "remove", ref } },
              undefined,
              "http://foreign.test",
            );
            send({
              frame: "other",
              type: "edit",
              id: "wrong-frame",
              edit: { type: "remove", ref },
            });
            send({
              type: "select",
              element: null,
              sourceSelection: {
                ref,
                index: 2,
                count: 3,
                allowed: ["text"],
                locks: [],
              },
            });
            send({
              type: "edit",
              id: "one",
              edit: { type: "text", ref, text: "one" },
            });
            send({
              type: "edit",
              id: "two",
              edit: { type: "text", ref, text: "two" },
            });
            yield* Queue.take(started);
            expect(calls).toHaveLength(1);
            // The response arrives after the replacement is already displayed and ready.
            frame.dataset.version = "2";
            frame.dataset.currentVersion = "2";
            frame.dataset.ready = "true";
            yield* Deferred.succeed(gate, undefined);
            expect(yield* Queue.take(receipts)).toMatchObject({
              type: "edit-result",
              id: "one",
              ok: true,
            });
            expect(yield* Queue.take(receipts)).toMatchObject({
              type: "select-source",
              ref: nextRef,
              index: 2,
            });
            expect(yield* Queue.take(receipts)).toMatchObject({
              type: "edit-result",
              id: "two",
              ok: true,
            });
            expect(
              calls.map((call) => (call.type === "text" ? call.text : "")),
            ).toEqual(["one", "two"]);
          }),
      );
    }),
);

it.effect(
  "reverts a failed network edit, publishes a notice, and continues the queue",
  () => {
    let calls = 0;
    const networkFailure = {
      _tag: "HttpClientError",
      message: "Connection lost",
    } as unknown as Effect.Error<ReturnType<Api["edit"]>>;
    return withController(
      {
        edit: () =>
          ++calls === 1 ? Effect.fail(networkFailure) : Effect.succeed(success),
        patch: () => Effect.succeed({ ok: true, inverse: undo }),
      },
      ({ send, receipts }) =>
        Effect.gen(function* () {
          const controller = yield* EditController;
          send({ type: "edit", id: "network", edit: { type: "remove", ref } });
          expect(yield* Queue.take(receipts)).toMatchObject({
            id: "network",
            ok: false,
          });
          const notice = yield* controller.changes.pipe(
            Stream.filter((value) => value !== null),
            Stream.take(1),
            Stream.runCollect,
          );
          expect(notice[0]?.message).toBe(
            "Couldn't save the edit. Check that Framio is still running.",
          );
          send({ type: "edit", id: "next", edit: { type: "remove", ref } });
          expect(yield* Queue.take(receipts)).toMatchObject({
            id: "next",
            ok: true,
          });
        }),
    );
  },
);

it.effect(
  "retains undo on a network failure and drops it only on conflict",
  () => {
    const patches: SourcePatch[] = [];
    let attempt = 0;
    return withController(
      {
        edit: () => Effect.succeed(success),
        patch: (patch) => {
          patches.push(patch);
          if (++attempt === 1)
            return Effect.fail({
              _tag: "HttpClientError",
            } as unknown as Effect.Error<ReturnType<Api["patch"]>>);
          return Effect.succeed({
            ok: false,
            reason: "conflict",
            message: "Conflict",
          });
        },
      },
      ({ send, receipts }) =>
        Effect.gen(function* () {
          const controller = yield* EditController;
          send({
            type: "edit",
            id: "one",
            edit: { type: "text", ref, text: "new" },
          });
          yield* Queue.take(receipts);
          yield* controller.history("undo");
          yield* controller.changes.pipe(
            Stream.filter(
              (value) => value?.message.includes("Couldn't save") ?? false,
            ),
            Stream.take(1),
            Stream.runCollect,
          );
          yield* controller.history("undo");
          const notice = yield* controller.changes.pipe(
            Stream.filter((value) => value?.message === "Conflict"),
            Stream.take(1),
            Stream.runCollect,
          );
          expect(notice[0]?.message).toBe("Conflict");
          yield* controller.history("undo");
          // A following edit is a queue barrier, proving the second undo had no patch to apply.
          send({
            type: "edit",
            id: "barrier",
            edit: { type: "text", ref, text: "next" },
          });
          yield* Queue.take(receipts);
          expect(patches).toEqual([undo, undo]);
        }),
    );
  },
);

it.effect(
  "restores only after a replacement is shown, keeping the reply on the original window",
  () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const targets: string[] = [];
      yield* withController(
        {
          edit: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(gate)),
              Effect.as(success),
            ),
          patch: () => Effect.succeed({ ok: true, inverse: undo }),
        },
        ({ frame, send, receipts }) =>
          Effect.gen(function* () {
            yield* EditController;
            send({
              type: "edit",
              id: "edit",
              edit: { type: "text", ref, text: "new" },
            });
            yield* Deferred.await(started);
            const replacementSource = {
              postMessage: (message: Receipt) => {
                targets.push("replacement");
                Queue.offerUnsafe(receipts, message);
              },
            } as unknown as Window;
            const replacement = {
              contentWindow: replacementSource,
              isConnected: true,
              contentDocument: frame.contentDocument,
              dataset: {
                frame: "frame",
                version: "2",
                currentVersion: "2",
                shown: "false",
              },
            } as unknown as HTMLIFrameElement;
            const unregister = yield* Effect.acquireRelease(
              Effect.sync(() => registerFrame(replacement)),
              (dispose) => Effect.sync(dispose),
            );
            frame.dataset.currentVersion = "2";
            send({ type: "ready", height: 100 }, replacementSource);
            yield* Deferred.succeed(gate, undefined);
            expect(yield* Queue.take(receipts)).toMatchObject({
              type: "edit-result",
              id: "edit",
              ok: true,
            });
            expect(targets).toEqual([]);
            expect(Queue.takeUnsafe(receipts)).toBeUndefined();
            frame.dataset.shown = "false";
            replacement.dataset.shown = "true";
            window.dispatchEvent(new Event("framio:frame-documents"));
            expect(yield* Queue.take(receipts)).toMatchObject({
              type: "select-source",
              ref: nextRef,
            });
            expect(targets).toEqual(["replacement"]);
            unregister();
          }),
      );
    }),
);

it.effect(
  "tracks text editing per displayed frame and releases the gate when it unmounts",
  () =>
    withController(
      {
        edit: () => Effect.succeed(success),
        patch: () => Effect.succeed({ ok: true, inverse: undo }),
      },
      ({ frame, send }) =>
        Effect.gen(function* () {
          yield* EditController;
          send({ type: "text-editing", active: true });
          expect(frameTextEditing()).toBe(true);
          send({ type: "text-editing", active: false });
          expect(frameTextEditing()).toBe(false);
          send({ type: "text-editing", active: true });
          frame.dataset.shown = "false";
          expect(frameTextEditing()).toBe(false);
          frame.dataset.shown = "true";
          Object.assign(frame, { isConnected: false });
          expect(frameTextEditing()).toBe(false);
        }),
    ),
);
