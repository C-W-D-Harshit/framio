import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import * as Effect from "effect/Effect";
import { selfCommand } from "../lib/bun";
import type { ProjectPaths } from "../lib/paths";
import { ServerStartupFailed } from "../domain/errors";
import { defaultHost } from "../domain/server-addresses";

/** Direct descriptors keep detached server logs independent of the parent scope.
 * Effect's process output sinks use parent-owned pipes, so this adapter handles
 * the detached/temporary logged-server case only. */
export const acquireLoggedServer = (
  p: ProjectPaths,
  temporary: boolean,
  host = defaultHost,
) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        const fd = openSync(p.serverLog, "a");
        let child;
        try {
          const [command, ...args] = selfCommand([
            "__supervise",
            p.root,
            "--host",
            host,
          ]);
          child = spawn(command!, args, {
            cwd: p.root,
            detached: !temporary,
            stdio: ["ignore", fd, fd],
          });
        } finally {
          closeSync(fd);
        }
        let owned = true;
        let spawnError: Error | undefined;
        const exit = new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          child.once("error", (error) => {
            spawnError = error;
            resolve();
          });
        });
        const wait = Effect.promise(() => exit);
        const stop = Effect.gen(function* () {
          if (
            !owned ||
            child.exitCode !== null ||
            child.signalCode !== null ||
            spawnError
          )
            return;
          child.kill("SIGTERM");
          if (
            (yield* wait.pipe(Effect.timeoutOption("10 seconds")))._tag ===
            "None"
          ) {
            child.kill("SIGKILL");
            yield* wait.pipe(Effect.timeoutOption("2 seconds"));
          }
        });
        return {
          pid: child.pid,
          isRunning: () =>
            !spawnError && child.exitCode === null && child.signalCode === null,
          error: () => spawnError,
          stop,
          detach: Effect.sync(() => {
            child.unref();
            owned = false;
          }),
        };
      },
      catch: (cause) => new ServerStartupFailed({ message: String(cause) }),
    }),
    (child) => child.stop,
  );
