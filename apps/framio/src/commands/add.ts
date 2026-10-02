import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { basename, delimiter, join } from "node:path";
import { GLOBAL_DIR, projectPaths } from "../lib/paths";
import { requireProject } from "./shared";
import { InvalidInput, PackageCommandFailed } from "../domain/errors";
import { TerminalUI } from "../services/terminal-ui";
import { installRegistryItems } from "../services/registry-installer";

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
  const shim = join(SHIM_DIR, process.platform === "win32" ? "bun.cmd" : "bun");
  const executable = `'${process.execPath.replace(/'/g, "'\\''")}'`;
  const script =
    process.platform === "win32"
      ? '@echo off\r\nset "BUN_BE_BUN=1"\r\n"%FRAMIO_BUN_EXECUTABLE%" %*\r\n'
      : `#!/bin/sh\nBUN_BE_BUN=1 exec ${executable} "$@"\n`;
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
  const ui = yield* TerminalUI;
  yield* ui.banner(basename(p.root));
  const receipt = yield* ui.tasks(
    (tasks) =>
      tasks.run(
        "Components",
        Effect.gen(function* () {
          const result = yield* installRegistryItems(
            p.framio,
            items,
            overwrite,
            {
              verbose,
              path: `${SHIM_DIR}${delimiter}${process.env.PATH ?? ""}`,
            },
          );
          for (const file of result.files)
            yield* ui.message(
              file.status === "failed" ? "error" : "info",
              `${file.status === "installed" ? "Installed" : file.status === "skipped" ? "Skipped" : "Failed"}: ${file.path}. ${file.reason}`,
            );
          if (verbose && result.output)
            yield* ui.message("info", result.output.trim());
          if (!result.complete)
            return yield* new PackageCommandFailed({
              message: `framio add failed: ${result.installed} installed, ${result.skipped} skipped, ${result.failed} failed.\n${result.error ?? "The installation did not complete."}\n${result.output}\nRetry with \`framio add ${items.join(" ")} --verbose\` for full output.`,
            });
          return result;
        }),
        { done: "Verified" },
      ),
    { live: !verbose },
  );
  yield* ui.message(
    "success",
    `Components: ${receipt.installed} installed, ${receipt.skipped} skipped, ${receipt.failed} failed.`,
  );
});
