import { reportError, track } from "./analytics";
import * as Semaphore from "effect/Semaphore";
import { UpdateFailure, type UpdateAction } from "../../contracts/update";
import { reconcileSnapshot } from "../snapshot-reconciliation";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { Api } from "../../contracts/api";
import { LiveRpc } from "../../contracts/live";
import type { Snapshot } from "../../contracts/snapshot";
import { makePersistence } from "../../services/persistence";

export type LiveState = {
  snapshot: Snapshot | null;
  connected: boolean;
  saveError: string | null;
};
const make = Effect.gen(function* () {
  const api = yield* HttpApiClient.make(Api, { baseUrl: location.origin });
  const state = yield* SubscriptionRef.make<LiveState>({
    snapshot: null,
    connected: false,
    saveError: null,
  });
  const persistence = yield* makePersistence({
    selection: (payload) =>
      api.project.selection({ payload }).pipe(
        Effect.tap(() =>
          SubscriptionRef.update(state, (current) =>
            current.saveError === null
              ? current
              : {
                  ...current,
                  saveError: null,
                },
          ),
        ),
      ),
    canvas: (payload) =>
      api.project.canvas({ payload }).pipe(
        Effect.tap(() =>
          SubscriptionRef.update(state, (current) =>
            current.saveError === null
              ? current
              : {
                  ...current,
                  saveError: null,
                },
          ),
        ),
      ),
    onError: (error) =>
      Effect.sync(() => reportError("canvas_save")).pipe(
        Effect.andThen(Effect.logError("Could not save canvas state", error)),
        Effect.andThen(
          SubscriptionRef.update(state, (current) => ({
            ...current,
            saveError:
              "Could not save your selection or positions. Try the change again.",
          })),
        ),
      ),
  });
  const Protocol = RpcClient.layerProtocolSocket({
    retryTransientErrors: false,
  }).pipe(
    Layer.provide(
      Socket.layerWebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      ).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    ),
    Layer.provide(RpcSerialization.layerJson),
  );
  yield* Effect.scoped(
    Effect.gen(function* () {
      const rpc = yield* RpcClient.make(LiveRpc);
      yield* rpc.snapshotsV1().pipe(
        Stream.runForEach((snapshot) =>
          SubscriptionRef.update(state, (current) => ({
            ...current,
            snapshot: reconcileSnapshot(current.snapshot, snapshot),
            connected: true,
          })),
        ),
      );
    }).pipe(Effect.provide(Protocol)),
  ).pipe(
    Effect.onExit(() =>
      SubscriptionRef.modify(state, (current) => [
        current.connected,
        { ...current, connected: false },
      ]).pipe(
        Effect.flatMap((wasConnected) =>
          wasConnected
            ? Effect.sync(() => track("studio disconnected"))
            : Effect.void,
        ),
      ),
    ),
    Effect.retry(Schedule.spaced("1 second")),
    Effect.forkScoped,
  );
  const updates = yield* SubscriptionRef.make<
    import("../../contracts/update").UpdateStatus | null
  >(null);
  yield* api.project.updateStatus().pipe(
    Effect.tap((value) => SubscriptionRef.set(updates, value)),
    Effect.catch(() => Effect.void),
    Effect.repeat(Schedule.spaced("1 second")),
    Effect.forkScoped,
  );
  const mutations = yield* Semaphore.make(1);
  let frozen = false;
  const comment = Effect.fn("ProjectClient.comment")(
    (payload: import("../../contracts/comments").CommentOperation) =>
      Effect.suspend(() =>
        frozen
          ? Effect.fail(
              new UpdateFailure({
                message: "Project restarting. Your draft remains local.",
              }),
            )
          : (payload.type === "create"
              ? api.project.comments({ payload })
              : payload.type === "reply"
                ? api.project.comments({ payload })
                : payload.type === "status"
                  ? api.project.comments({ payload })
                  : api.project.comments({ payload })
            ).pipe(
              Semaphore.withPermits(mutations, 1),
              Effect.tap((response) =>
                SubscriptionRef.update(state, (current) => ({
                  ...current,
                  saveError: response.error ?? null,
                })),
              ),
              Effect.catch((error) =>
                SubscriptionRef.update(state, (current) => ({
                  ...current,
                  saveError: "Could not save your comment. Try again.",
                })).pipe(
                  Effect.as({
                    ok: false,
                    error: "Could not save your comment. Try again.",
                  }),
                ),
              ),
            ),
      ),
  );
  return {
    comment,
    changes: SubscriptionRef.changes(state),
    ...persistence,
    updateChanges: SubscriptionRef.changes(updates),
    update: Effect.fn("ProjectClient.update")(function* (
      action: (typeof UpdateAction.Type)["action"],
    ) {
      if (action !== "install" && action !== "restart") {
        const result = yield* api.project.updateAction({ payload: { action } });
        if (!result.ok)
          return yield* new UpdateFailure({
            message: result.error ?? "Update action failed",
          });
        return;
      }
      frozen = true;
      yield* Effect.gen(function* () {
        yield* persistence.flush;
        const before = yield* api.project.health();
        const selected = yield* api.project.updateStatus();
        const expected =
          action === "install"
            ? selected.release?.version
            : selected.installedVersion;
        const result = yield* api.project
          .updateAction({ payload: { action } })
          .pipe(Effect.catch(() => Effect.succeed({ ok: true, error: null })));
        if (!result.ok)
          return yield* new UpdateFailure({
            message: result.error ?? "Restart failed",
          });
        yield* Effect.gen(function* () {
          while (true) {
            const ready = yield* Effect.gen(function* () {
              const health = yield* api.project.health();
              const update = yield* api.project.updateStatus();
              return (
                health.root === before.root &&
                health.pid !== before.pid &&
                (health.version === expected ||
                  update.restartPhase === "recovered")
              );
            }).pipe(Effect.catch(() => Effect.succeed(false)));
            if (ready) {
              yield* Effect.sync(() => location.reload());
              return;
            }
            yield* Effect.sleep("500 millis");
          }
        }).pipe(
          Effect.timeout("75 seconds"),
          Effect.mapError(
            () =>
              new UpdateFailure({
                message:
                  "Could not reconnect to the replacement server. Retry restart, or run framio start in this project.",
              }),
          ),
        );
      }).pipe(
        Semaphore.withPermits(mutations, 1),
        Effect.ensuring(
          persistence.resume.pipe(
            Effect.andThen(
              Effect.sync(() => {
                frozen = false;
              }),
            ),
          ),
        ),
      );
    }),
    renameLayer: (
      payload: typeof import("../../contracts/layers").RenameRequest.Type,
    ) =>
      Effect.suspend(() =>
        frozen
          ? Effect.fail(
              new UpdateFailure({
                message: "Project restarting. Layer changes are paused.",
              }),
            )
          : api.project
              .renameLayer({ payload })
              .pipe(
                Effect.mapError(
                  (error) => new UpdateFailure({ message: error.message }),
                ),
              ),
      ).pipe(Semaphore.withPermits(mutations, 1)),
  };
});
export class ProjectClient extends Context.Service<
  ProjectClient,
  Effect.Success<typeof make>
>()("framio/ui/ProjectClient") {
  static readonly layer = Layer.effect(ProjectClient, make).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}
