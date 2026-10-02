import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as PlatformError from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
/**
 * Framio never relies on a package manager being installed on the machine.
 * The framio binary is itself Bun, and `BUN_BE_BUN=1` makes it behave as the `bun` CLI.
 */
export function bunCommand(args: string[]) {
  return {
    cmd: [process.execPath, ...args],
    env: { ...process.env, BUN_BE_BUN: "1" },
  };
}

export const runBun = Effect.fn("runBun")(function* (
  args: string[],
  cwd: string,
  opts: { quiet?: boolean } = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { cmd, env } = bunCommand(args);
  const proc = yield* spawner.spawn(
    ChildProcess.make(cmd[0]!, cmd.slice(1), {
      cwd,
      env,
      detached: true,
      windowsHide: true,
      forceKillAfter: "10 seconds",
      stdout: opts.quiet ? "pipe" : "inherit",
      stderr: opts.quiet ? "pipe" : "inherit",
    }),
  );
  const collect = (
    stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  ) =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runCollect,
      Effect.map((parts) => parts.join("")),
    );
  const [code, stdout, stderr] = yield* Effect.all(
    [
      proc.exitCode,
      opts.quiet ? collect(proc.stdout) : Effect.succeed(""),
      opts.quiet ? collect(proc.stderr) : Effect.succeed(""),
    ],
    { concurrency: "unbounded" },
  );
  return { code, output: stdout + stderr };
}, Effect.scoped);

/** Command to re-invoke this CLI, both from source (`bun src/cli.ts`) and as a compiled binary. */
export function selfCommand(args: string[]): string[] {
  const compiled =
    Bun.main.startsWith("/$bunfs") ||
    Bun.main.replaceAll("\\", "/").startsWith("B:/~BUN");
  return compiled
    ? [process.execPath, ...args]
    : [process.execPath, Bun.main, ...args];
}
