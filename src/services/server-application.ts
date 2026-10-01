import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ServerRegistry } from "./server-registry";
import { projectPaths } from "../lib/paths";
export const serve = Effect.fn("serve")(function*(root: string, shouldOpen: boolean) {
  root = yield* (yield* FileSystem.FileSystem).realPath(root);
  const registry = yield* ServerRegistry;
  const p = projectPaths(root);
  if (yield* registry.running(p)) return;
  if (!(yield* registry.lock(p))) return;
  const { runServer } = yield* Effect.promise(() => import("../server/server"));
  const server = yield* runServer(root);
  yield* registry.register(p, server.info);
  if (shouldOpen) { const { openBrowser } = yield* Effect.promise(() => import("../commands/server")); yield* openBrowser(server.info.url); }
  yield* Effect.never;
});
