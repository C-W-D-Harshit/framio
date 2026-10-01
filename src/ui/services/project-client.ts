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
          SubscriptionRef.update(state, (current) => ({
            ...current,
            saveError: null,
          })),
        ),
      ),
    canvas: (payload) =>
      api.project.canvas({ payload }).pipe(
        Effect.tap(() =>
          SubscriptionRef.update(state, (current) => ({
            ...current,
            saveError: null,
          })),
        ),
      ),
    onError: (error) =>
      Effect.logError("Could not save canvas state", error).pipe(
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
            snapshot,
            connected: true,
          })),
        ),
      );
    }).pipe(Effect.provide(Protocol)),
  ).pipe(
    Effect.onExit(() =>
      SubscriptionRef.update(state, (current) => ({
        ...current,
        connected: false,
      })),
    ),
    Effect.retry(Schedule.spaced("1 second")),
    Effect.forkScoped,
  );
  return { changes: SubscriptionRef.changes(state), ...persistence };
});
export class ProjectClient extends Context.Service<
  ProjectClient,
  Effect.Success<typeof make>
>()("framio/ui/ProjectClient") {
  static readonly layer = Layer.effect(ProjectClient, make).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}
