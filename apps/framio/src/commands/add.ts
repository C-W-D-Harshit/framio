import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { join } from "node:path";
import { GLOBAL_DIR, projectPaths } from "../lib/paths";
import { requireProject } from "./shared";
import { InvalidInput, PackageCommandFailed } from "../domain/errors";

const SHIM_DIR = join(GLOBAL_DIR, "shims");
export const add = Effect.fn("add")(function* (
  items: readonly string[],
  overwrite: boolean,
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
  const input = new TextEncoder().encode(overwrite ? "" : "n\n".repeat(500));
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
        env: { PATH: `${SHIM_DIR}:${process.env.PATH ?? ""}` },
        extendEnv: true,
        stdin: Stream.make(input),
        stdout: "inherit",
        stderr: "inherit",
        forceKillAfter: "10 seconds",
      },
    ),
  );
  if ((yield* child.exitCode) !== 0)
    return yield* new PackageCommandFailed({ message: "framio add failed." });
});
