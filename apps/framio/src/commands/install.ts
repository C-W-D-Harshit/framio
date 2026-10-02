import * as Effect from "effect/Effect";
import { runBun } from "../lib/bun";
import { projectPaths } from "../lib/paths";
import { requireProject } from "./shared";
import { PackageCommandFailed } from "../domain/errors";
import { basename } from "node:path";
import { TerminalUI } from "../services/terminal-ui";

export const install = Effect.fn("install")(function* (
  packages: readonly string[],
  verbose = false,
) {
  const p = projectPaths(yield* requireProject);
  const ui = yield* TerminalUI;
  yield* ui.banner(basename(p.root));
  yield* ui.tasks(
    (tasks) =>
      tasks.run(
        "Packages",
        Effect.gen(function* () {
          const result = yield* runBun(
            packages.length ? ["add", ...packages] : ["install"],
            p.framio,
            { quiet: !verbose },
          );
          if (result.code !== 0)
            return yield* new PackageCommandFailed({
              message: `Install failed.\n${result.output}\nRetry with \`framio install --verbose\` for full output.`,
            });
        }),
        { done: packages.length ? packages.join(", ") : "Installed" },
      ),
    { live: !verbose },
  );
  yield* ui.message("success", "Packages ready.");
});
