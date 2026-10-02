import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { basename, dirname, join } from "node:path";
import { scaffoldFiles } from "../generated/assets.js";
import { ensureBrowser } from "../lib/browser";
import { runBun } from "../lib/bun";
import { FRAMIO_DIR, projectPaths } from "../lib/paths";
import { InvalidInput, PackageCommandFailed } from "../domain/errors";
import { TerminalUI, type TerminalTasks } from "../services/terminal-ui";

const SKILL_DIRS = [".claude/skills/framio", ".agents/skills/framio"];
export const init = Effect.fn("init")(function* (
  skipInstall: boolean,
  verbose = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(process.cwd());
  const p = projectPaths(root);
  if (yield* fs.exists(p.framio))
    return yield* new InvalidInput({
      message: `${FRAMIO_DIR} already exists here.`,
    });
  const ui = yield* TerminalUI;
  yield* ui.banner(basename(root));
  const writeFiles = Effect.fnUntraced(function* (skills: boolean) {
    for (const [rel, file] of Object.entries(scaffoldFiles)) {
      if (rel.startsWith("skill/") !== skills) continue;
      // Bun embeds these paths in /$bunfs; node:fs cannot copy those virtual files.
      const bytes = yield* Effect.tryPromise({
        try: async () => new Uint8Array(await Bun.file(file).arrayBuffer()),
        catch: (cause) =>
          new InvalidInput({
            message: `Could not read embedded scaffold ${rel}: ${String(cause)}`,
          }),
      });
      const destinations = rel.startsWith("skill/")
        ? SKILL_DIRS.map((dir) => join(root, dir, rel.slice("skill/".length)))
        : [join(p.framio, rel === "_gitignore" ? ".gitignore" : rel)];
      for (const target of destinations) {
        yield* fs.makeDirectory(dirname(target), {
          recursive: true,
        });
        yield* fs.writeFile(target, bytes);
      }
    }
    if (!skills) yield* fs.makeDirectory(p.assets, { recursive: true });
  });
  const browser = yield* ui.tasks(
    Effect.fnUntraced(function* (tasks: TerminalTasks) {
      yield* tasks.run("Canvas files", writeFiles(false), {
        done: ".framio/ with shadcn/ui, theme and examples",
      });
      yield* tasks.run("Agent skills", writeFiles(true), {
        done: "Claude Code + Codex",
      });
      if (skipInstall) return null;
      const [, browser] = yield* Effect.all(
        [
          tasks.run(
            "Packages",
            Effect.gen(function* () {
              const result = yield* runBun(["install"], p.framio, {
                quiet: !verbose,
              });
              if (result.code !== 0)
                return yield* new PackageCommandFailed({
                  message: `Package install failed.\n${result.output}\nRetry with \`framio install\`.`,
                });
            }),
            { done: "Installed", failed: "Retry with framio install" },
          ),
          tasks
            .run("Screenshot browser", ensureBrowser(), {
              done: "Ready",
              failed: "Unavailable",
              warningOnFailure: true,
            })
            .pipe(Effect.result),
        ],
        { concurrency: 2 },
      );
      return browser;
    }),
    { live: !verbose },
  );
  if (skipInstall) {
    yield* ui.message("info", "Files ready. Package installation was skipped.");
    yield* ui.next("Finish setup", ["framio install", "framio start"]);
    return;
  }
  if (browser?._tag === "Failure")
    yield* ui.message(
      "warning",
      `Canvas ready. Screenshots unavailable.\n${browser.failure.message}\nThe browser download will retry on your first screenshot.`,
    );
  else yield* ui.message("success", "Your canvas is ready.");
  yield* ui.next("Open your canvas", ["framio start"]);
  yield* ui.message(
    "info",
    'Then ask your agent: "Use Framio to design the onboarding for my invoicing app."',
  );
});
