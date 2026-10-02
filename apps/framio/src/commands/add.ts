import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { basename, join } from "node:path";
import { GLOBAL_DIR, projectPaths } from "../lib/paths";
import { requireProject } from "./shared";
import { InvalidInput, PackageCommandFailed } from "../domain/errors";
import { TerminalUI } from "../services/terminal-ui";

const SHIM_DIR = join(GLOBAL_DIR, "shims");
export const add = Effect.fn("add")(function* (
  items: readonly string[],
  overwrite: boolean,
  verbose = false,
) {
  const p = projectPaths(yield* requireProject);
  if (!items.length)
    return yield* new InvalidInput({
      message: "Usage: framio add <item>... [--overwrite]",
    });
  if (!Bun.which("npx"))
    return yield* new InvalidInput({
      message:
        "framio add needs Node.js (npx). Install Node from https://nodejs.org.",
    });
  const fs = yield* FileSystem.FileSystem;
  const shim = join(SHIM_DIR, "bun");
  const executable = `'${process.execPath.replace(/'/g, "'\\''")}'`;
  const script = `#!/bin/sh\nBUN_BE_BUN=1 exec ${executable} "$@"\n`;
  const current = yield* fs
    .readFileString(shim)
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed("")),
    );
  if (current !== script) {
    yield* fs.makeDirectory(SHIM_DIR, { recursive: true });
    yield* fs.writeFileString(shim, script);
    yield* fs.chmod(shim, 0o755);
  }
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const ui = yield* TerminalUI;
  yield* ui.banner(basename(p.root));
  const input = new TextEncoder().encode(overwrite ? "" : "n\n".repeat(500));
  yield* ui.tasks(
    (tasks) =>
      tasks.run(
        "Components",
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            ChildProcess.make(
              "npx",
              [
                "-y",
                "shadcn@latest",
                "add",
                ...items,
                "--yes",
                ...(overwrite ? ["--overwrite"] : []),
              ],
              {
                cwd: p.framio,
                env: {
                  PATH: `${SHIM_DIR}:${process.env.PATH ?? ""}`,
                  ...(verbose ? {} : { NO_COLOR: "1" }),
                },
                extendEnv: true,
                stdin: Stream.make(input),
                stdout: verbose ? "inherit" : "pipe",
                stderr: verbose ? "inherit" : "pipe",
                forceKillAfter: "10 seconds",
              },
            ),
          );
          const [code, output] = yield* Effect.all(
            [
              child.exitCode,
              verbose
                ? Effect.succeed("")
                : child.all.pipe(
                    Stream.decodeText(),
                    Stream.runFold(
                      () => "",
                      (output, chunk) => output + chunk,
                    ),
                  ),
            ],
            { concurrency: 2 },
          );
          if (code !== 0)
            return yield* new PackageCommandFailed({
              message: `framio add failed.\n${output}\nRetry with \`framio add ${items.join(" ")} --verbose\` for full output.`,
            });
        }),
        { done: items.join(", ") },
      ),
    { live: !verbose },
  );
  yield* ui.message("success", "Components ready.");
});
