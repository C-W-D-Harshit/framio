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

export async function runBun(args: string[], cwd: string, opts: { quiet?: boolean } = {}) {
  const { cmd, env } = bunCommand(args);
  const proc = Bun.spawn(cmd, {
    cwd,
    env,
    stdout: opts.quiet ? "pipe" : "inherit",
    stderr: opts.quiet ? "pipe" : "inherit",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    opts.quiet ? new Response(proc.stdout as ReadableStream).text() : "",
    opts.quiet ? new Response(proc.stderr as ReadableStream).text() : "",
  ]);
  return { code, output: `${stdout}${stderr}` };
}

/** Command to re-invoke this CLI, both from source (`bun src/cli.ts`) and as a compiled binary. */
export function selfCommand(args: string[]): string[] {
  const compiled = Bun.main.startsWith("/$bunfs") || Bun.main.startsWith("B:/~BUN");
  return compiled ? [process.execPath, ...args] : [process.execPath, Bun.main, ...args];
}
