import { recordIfAvailable } from "./analytics";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ServerRegistry } from "./server-registry";
import { displayPath, projectPaths } from "../lib/paths";
import { basename } from "node:path";
import { TerminalUI } from "./terminal-ui";
import { defaultHost } from "../domain/server-addresses";
import { printServerUrls } from "./server-display";
export const serve = Effect.fn("serve")(function* (
  root: string,
  shouldOpen: boolean,
  terminal = false,
  host = defaultHost,
) {
  const fs = yield* FileSystem.FileSystem;
  root = yield* fs.realPath(root);
  const registry = yield* ServerRegistry;
  const p = projectPaths(root);
  if (yield* registry.running(p)) return;
  if (!(yield* registry.lock(p))) return;
  if (process.platform === "win32")
    yield* fs.remove(`${p.state}/stop-${process.pid}`, { force: true });
  if (!process.env.FRAMIO_SERVER_PORT)
    yield* (yield* FileSystem.FileSystem).remove(`${p.state}/restart.json`, {
      force: true,
    });
  const ui = terminal ? yield* TerminalUI : null;
  if (ui) {
    yield* ui.banner(basename(root));
    yield* ui.message("info", "Starting canvas...");
  }
  const { runServer } = yield* Effect.promise(() => import("../server/server"));
  const server = yield* runServer(root, host);
  yield* registry.register(p, server.info);
  yield* recordIfAvailable("server started", {});
  yield* Effect.sleep("12 hours").pipe(
    Effect.andThen(recordIfAvailable("server heartbeat", {})),
    Effect.forever,
    Effect.forkScoped,
  );
  if (ui) {
    yield* printServerUrls(server.info);
    yield* ui.row("Files", displayPath(p.framio));
    yield* ui.row("Status", "Watching for changes");
    yield* ui.next("Keep this terminal open", ["Ctrl+C to stop"]);
    yield* Effect.addFinalizer(() => ui.message("info", "Canvas stopped."));
  }
  if (shouldOpen) {
    const { tryOpenBrowser } = yield* Effect.promise(
      () => import("../commands/server"),
    );
    yield* tryOpenBrowser(server.info.url);
  }
  if (process.platform === "win32") {
    const stopFile = `${p.state}/stop-${process.pid}`;
    yield* Effect.addFinalizer(() =>
      fs
        .remove(stopFile, { force: true })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Stop request cleanup failed", error.message),
          ),
        ),
    );
    process.exitCode = yield* Effect.raceFirst(
      server.restart.pipe(Effect.as(75)),
      Effect.gen(function* () {
        while (!(yield* fs.exists(stopFile))) yield* Effect.sleep("100 millis");
        return 0;
      }),
    );
  } else {
    yield* server.restart;
    process.exitCode = 75;
  }
});
