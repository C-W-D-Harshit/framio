import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  SOURCE_ATTRIBUTE,
  type EditOperation,
  type SourceSelection,
} from "../../contracts/edits";
import { FrameMessage } from "../../contracts/frame-message";
import { displayedFrame, registeredFrames, sourceFrame } from "../frame-bridge";
import {
  emptyHistory,
  pushEdit,
  finishUndo,
  finishRedo,
  dropConflict,
  type EditHistory,
} from "../edit-history";
import { matchesRestore, type SelectionRestore } from "../edit-restore";
import { ProjectClient } from "./project-client";

type EditTask = {
  type: "edit";
  frameId: string;
  source: Window;
  id: string;
  edit: EditOperation;
  index: number;
  version: number;
};
type Task = EditTask | { type: "history"; direction: "undo" | "redo" };
const networkNotice =
  "Couldn't save the edit. Check that Framio is still running.";

const make = Effect.gen(function* () {
  const client = yield* ProjectClient;
  const queue = yield* Queue.unbounded<Task>();
  const noticeWake = yield* Queue.sliding<void>(1);
  const notices = yield* SubscriptionRef.make<{
    id: number;
    message: string;
  } | null>(null);
  let serial = 0;
  let history: EditHistory = emptyHistory;
  const selections = new Map<Window, SourceSelection>();
  const pending = new Map<string, SelectionRestore>();
  const notice = Effect.fn("EditController.notice")(function* (
    message: string,
  ) {
    yield* SubscriptionRef.set(notices, { id: ++serial, message });
    Queue.offerUnsafe(noticeWake, undefined);
  });
  const flushRestores = () => {
    for (const [frameId, restore] of pending) {
      for (const iframe of registeredFrames()) {
        if (iframe.dataset.frame !== frameId) continue;
        const elements = iframe.contentDocument?.querySelectorAll(
          `[${SOURCE_ATTRIBUTE}]`,
        );
        const containsRef = elements
          ? [...elements].some(
              (element) =>
                element.getAttribute(SOURCE_ATTRIBUTE) === restore.ref,
            )
          : false;
        if (
          !matchesRestore(restore, {
            frameId,
            version: Number(iframe.dataset.version),
            currentVersion: Number(iframe.dataset.currentVersion),
            shown: iframe.dataset.shown === "true",
            ready: iframe.dataset.ready === "true",
            containsRef,
          })
        )
          continue;
        iframe.contentWindow?.postMessage(
          {
            source: "framio-canvas",
            type: "select-source",
            ref: restore.ref,
            index: restore.index,
          },
          location.origin,
        );
        pending.delete(frameId);
        break;
      }
    }
  };
  const restore = (
    frameId: string,
    ref: string | null,
    index: number,
    afterVersion: number,
  ) => {
    pending.delete(frameId);
    if (ref !== null)
      pending.set(frameId, { frameId, ref, index, afterVersion });
    flushRestores();
  };
  const reply = (task: EditTask, ok: boolean) =>
    task.source.postMessage(
      {
        source: "framio-canvas",
        type: "edit-result",
        id: task.id,
        ok,
      },
      location.origin,
    );
  const process = Effect.fn("EditController.process")(
    function* (task: Task) {
      if (task.type === "edit") {
        // The originating window is retained even if a reload replaces it during the request.
        const response = yield* client
          .edit(task.edit)
          .pipe(
            Effect.catch((error) =>
              Effect.sync(() => reply(task, false)).pipe(
                Effect.andThen(
                  notice(
                    error._tag === "UpdateFailure"
                      ? error.message
                      : networkNotice,
                  ),
                ),
                Effect.as(null),
              ),
            ),
          );
        if (!response) return;
        reply(task, response.ok);
        if (!response.ok) {
          yield* notice(response.message);
          return;
        }
        history = pushEdit(history, {
          frameId: task.frameId,
          label: response.label,
          undo: response.undo,
          beforeRef: task.edit.ref,
          beforeIndex: task.index,
          afterRef: response.ref,
          afterIndex: task.index,
        });
        restore(task.frameId, response.ref, task.index, task.version);
        return;
      }
      const entry = history[task.direction].at(-1);
      if (!entry) return;
      const version = Number(
        displayedFrame(entry.frameId)?.dataset.version ?? -1,
      );
      const patch =
        task.direction === "undo" ? entry.undo : history.redo.at(-1)!.redo;
      const response = yield* client.patch(patch);
      if (!response.ok) {
        if (response.reason === "conflict")
          history = dropConflict(history, task.direction);
        yield* notice(response.message);
        return;
      }
      history =
        task.direction === "undo"
          ? finishUndo(history, response.inverse)
          : finishRedo(history, response.inverse);
      restore(
        entry.frameId,
        task.direction === "undo" ? entry.beforeRef : entry.afterRef,
        task.direction === "undo" ? entry.beforeIndex : entry.afterIndex,
        version,
      );
    },
    Effect.catch((error) =>
      notice(error._tag === "UpdateFailure" ? error.message : networkNotice),
    ),
  );

  yield* Stream.fromQueue(queue).pipe(
    Stream.runForEach((task) =>
      process(task).pipe(
        // HTTP failures must acknowledge the optimistic preview too.
        Effect.onExit((exit) =>
          Effect.sync(() => {
            // process handles typed errors; this guards defects and interruption.
            if (task.type === "edit" && exit._tag === "Failure")
              reply(task, false);
          }),
        ),
      ),
    ),
    Effect.forkScoped,
  );
  yield* Stream.fromQueue(noticeWake).pipe(
    Stream.debounce("4 seconds"),
    Stream.runForEach(() => SubscriptionRef.set(notices, null)),
    Effect.forkScoped,
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const controller = new AbortController();
      const receive = (event: MessageEvent) => {
        if (event.origin !== location.origin) return;
        const decoded = Schema.decodeUnknownResult(FrameMessage)(event.data);
        if (Result.isFailure(decoded)) return;
        const msg = decoded.success;
        const iframe = sourceFrame(event.source, msg.frame);
        if (!iframe) return;
        const source = event.source as Window;
        if (msg.type === "ready") {
          iframe.dataset.ready = "true";
          flushRestores();
        } else if (msg.type === "text-editing") {
          iframe.dataset.textEditing = String(msg.active);
          window.dispatchEvent(new Event("framio:frame-documents"));
        } else if (msg.type === "select" && iframe.dataset.shown === "true") {
          if (msg.sourceSelection) selections.set(source, msg.sourceSelection);
        } else if (msg.type === "edit" && iframe.dataset.shown === "true") {
          const selected = selections.get(source);
          Queue.offerUnsafe(queue, {
            type: "edit",
            frameId: msg.frame,
            source,
            id: msg.id,
            edit: msg.edit,
            index: selected?.ref === msg.edit.ref ? selected.index : 0,
            version: Number(iframe.dataset.version),
          });
        }
      };
      window.addEventListener("message", receive, {
        signal: controller.signal,
      });
      window.addEventListener(
        "framio:frame-documents",
        () => {
          for (const source of selections.keys())
            if (
              !registeredFrames().some(
                (iframe) => iframe.contentWindow === source,
              )
            )
              selections.delete(source);
          flushRestores();
        },
        { signal: controller.signal },
      );
      return controller;
    }),
    (controller) => Effect.sync(() => controller.abort()),
  );
  return {
    notice,
    changes: SubscriptionRef.changes(notices),
    history: (direction: "undo" | "redo") =>
      Queue.offer(queue, { type: "history", direction }),
  };
});

export class EditController extends Context.Service<
  EditController,
  Effect.Success<typeof make>
>()("framio/ui/EditController") {
  static readonly layer = Layer.effect(EditController, make);
}
