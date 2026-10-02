import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { ServerRegistry } from "./server-registry";
import { makeUpdater } from "./update/updater";
import { projectPaths } from "../lib/paths";
import { selfCommand } from "../lib/bun";
import { RestartJournal } from "../contracts/restart";
import { ServerStartupFailed } from "../domain/errors";
export const supervise = Effect.fn("SessionSupervisor.run")(function* (
  root: string,
  open: boolean,
  options: {
    terminal?: boolean;
    verbose?: boolean;
    updater?: Parameters<typeof makeUpdater>[0];
    command?: string[];
    readinessTimeout?: import("effect/Duration").Input;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  root = yield* fs.realPath(root);
  const p = projectPaths(root);
  const registry = yield* ServerRegistry;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const updater = yield* makeUpdater(options.updater);
  const journal = `${p.state}/restart.json`;
  const read = fs.readFileString(journal).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(RestartJournal))(text),
    ),
    Effect.catch(() => Effect.succeed(null)),
  );
  const write = (value: typeof RestartJournal.Type) =>
    Effect.gen(function* () {
      const temporary = `${journal}.${process.pid}.tmp`;
      yield* fs.writeFileString(temporary, JSON.stringify(value));
      yield* fs.rename(temporary, journal);
    });
  const serverArgs = [
    "__serve",
    root,
    ...(options.terminal ? ["--terminal"] : []),
    ...(options.verbose ? ["--verbose"] : []),
  ];
  let command =
    options.command ??
    selfCommand([...serverArgs, ...(open ? ["--open"] : [])]);
  let restarting: typeof RestartJournal.Type | null = null;
  let recovery = false;
  while (true) {
    const outcome = yield* Effect.scoped(
      Effect.gen(function* () {
        const launch = Effect.gen(function* () {
          const child = yield* spawner.spawn(
            ChildProcess.make(command[0]!, command.slice(1), {
              cwd: root,
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
              detached: false,
              forceKillAfter: "10 seconds",
              env: {
                ...process.env,
                FRAMIO_SUPERVISOR_PID: String(process.pid),
                FRAMIO_INSTALLATION_TARGET: updater.target,
                ...(restarting
                  ? { FRAMIO_SERVER_PORT: String(restarting.port) }
                  : {}),
              },
            }),
          );
          if (restarting) {
            const expected = restarting.version;
            const ready = yield* Effect.gen(function* () {
              while (true) {
                const info = yield* registry.running(p);
                if (
                  info?.pid === Number(child.pid) &&
                  info.port === restarting!.port &&
                  info.version === expected
                )
                  return true;
                yield* Effect.sleep("100 millis");
              }
            }).pipe(
              Effect.timeoutOption(options.readinessTimeout ?? "30 seconds"),
            );
            if (ready._tag === "None") return null;
            yield* write({
              ...(restarting as typeof RestartJournal.Type),
              phase: recovery ? "recovered" : "ready",
              error: recovery
                ? "The updated server could not start. This session recovered using the previous executable. Retry restart or roll back."
                : null,
            });
          }
          return child;
        });
        const child = yield* restarting
          ? updater.store.lock(updater.key, launch)
          : launch;
        if (!child) return { code: -1, ready: false };
        return { code: Number(yield* child.exitCode), ready: true };
      }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed({ code: -1, ready: false, error: error.message }),
      ),
    );
    if (!outcome.ready) {
      if (!restarting) return outcome.code;
      if (!recovery) {
        const state = yield* updater.status();
        if (state.previousVersion) {
          recovery = true;
          restarting = {
            ...(restarting as typeof RestartJournal.Type),
            version: state.previousVersion,
          };
          command = [updater.backup, ...serverArgs];
          continue;
        }
      }
      yield* write({
        ...restarting,
        phase: "failed",
        error:
          "The replacement and recovery server could not start. Run framio start for this project, or framio upgrade --rollback, then framio start.",
      });
      return 1;
    }
    if (outcome.code !== 75) return outcome.code;
    const request = yield* read;
    if (!request || request.phase !== "requested")
      return yield* new ServerStartupFailed({
        message: "Server requested restart without a valid restart journal.",
      });
    // Child scope is closed here, including sockets and registry finalizers.
    if (yield* registry.running(p))
      return yield* new ServerStartupFailed({
        message: "The old server still owns this project. Restart refused.",
      });
    restarting = { ...request, phase: "starting" };
    recovery = false;
    yield* write(restarting);
    command = [updater.target, ...serverArgs];
  }
});
