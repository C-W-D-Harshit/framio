import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ServerRegistry } from "./server-registry";
import { displayPath, projectPaths } from "../lib/paths";
import { basename } from "node:path";
import { TerminalUI } from "./terminal-ui";
export const serve = Effect.fn("serve")(function* (
  root: string,
  shouldOpen: boolean,
  terminal = false,
) {
  root = yield* (yield* FileSystem.FileSystem).realPath(root);
  const registry = yield* ServerRegistry;
  const p = projectPaths(root);
  if (yield* registry.running(p)) return;
  if (!(yield* registry.lock(p))) return;
  const ui = terminal ? yield* TerminalUI : null;
  if (ui) {
    yield* ui.banner(basename(root));
    yield* ui.message("info", "Starting canvas...");
  }
  const { runServer } = yield* Effect.promise(() => import("../server/server"));
  const server = yield* runServer(root);
  yield* registry.register(p, server.info);
  if (ui) {
    yield* ui.row("Canvas", server.info.url);
    yield* ui.row("Files", displayPath(p.framio));
    yield* ui.row("Status", "Watching for changes");
    yield* ui.next("Keep this terminal open", ["Ctrl+C to stop"]);
    yield* Effect.addFinalizer(() => ui.message("info", "Canvas stopped."));
  }
  if (shouldOpen) {
    const { openBrowser } = yield* Effect.promise(
      () => import("../commands/server"),
    );
    yield* openBrowser(server.info.url);
  }
  yield* server.restart;
  process.exitCode = 75;
});
