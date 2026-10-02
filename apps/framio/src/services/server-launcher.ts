import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { acquireLoggedServer } from "../platform/server-child";
import { ServerRegistry, isAlive } from "./server-registry";
import { selfCommand } from "../lib/bun";
import type { ProjectPaths } from "../lib/paths";
import type { ServerInfo } from "../contracts/server-info";
import { ServerStartupFailed } from "../domain/errors";

export class ServerLauncher extends Context.Service<
  ServerLauncher,
  {
    ensure: (
      p: ProjectPaths,
      temporary?: boolean,
    ) => Effect.Effect<
      { info: ServerInfo; started: boolean },
      PlatformError.PlatformError | ServerStartupFailed,
      Scope.Scope
    >;
    foreground: (
      p: ProjectPaths,
      open: boolean,
    ) => Effect.Effect<number, PlatformError.PlatformError, Scope.Scope>;
  }
>()("framio/services/ServerLauncher") {
  static readonly layer = Layer.effect(
    ServerLauncher,
    Effect.gen(function* () {
      const registry = yield* ServerRegistry;
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const ensure = Effect.fn("ServerLauncher.ensure")(function* (
        p: ProjectPaths,
        temporary = false,
      ) {
        const running = yield* registry.running(p);
        if (running) return { info: running, started: false };
        yield* fs.makeDirectory(p.state, { recursive: true });
        const child = yield* acquireLoggedServer(p, temporary);
        const result = yield* Effect.gen(function* () {
          while (true) {
            yield* Effect.sleep("100 millis");
            const info = yield* registry.running(p);
            if (info) {
              if ((info.supervisorPid ?? info.pid) !== child.pid) {
                yield* child.stop;
                return { info, started: false };
              }
              if (!temporary) yield* child.detach;
              return { info, started: true };
            }
            if (child.error()) break;
            if (!child.isRunning()) {
              const pid = yield* fs
                .readFileString(`${p.state}/server.lock`)
                .pipe(
                  Effect.map(Number),
                  Effect.catchReason("PlatformError", "NotFound", () =>
                    Effect.succeed(0),
                  ),
                );
              if (!Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) break;
            }
          }
          return null;
        }).pipe(Effect.timeoutOption("30 seconds"));
        if (result._tag === "Some" && result.value) return result.value;
        yield* child.stop;
        return yield* new ServerStartupFailed({
          message: `The framio server did not start${child.error() ? `: ${child.error()!.message}` : ""}. See ${p.serverLog}`,
        });
      });
      const foreground = Effect.fn("ServerLauncher.foreground")(function* (
        p: ProjectPaths,
        open: boolean,
      ) {
        const [command, ...args] = selfCommand([
          "__supervise",
          p.root,
          ...(open ? ["--open"] : []),
        ]);
        const child = yield* spawner.spawn(
          ChildProcess.make(command!, args, {
            cwd: p.root,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            detached: false,
            forceKillAfter: "10 seconds",
          }),
        );
        return yield* child.exitCode;
      });
      return ServerLauncher.of({ ensure, foreground });
    }),
  );
}
