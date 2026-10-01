import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { join } from "node:path";
import { scaffoldFiles } from "../generated/assets.js";
import { ensureBrowser, isBrowserInstalled } from "../lib/browser";
import { runBun } from "../lib/bun";
import { FRAMIO_DIR, projectPaths } from "../lib/paths";
import { InvalidInput, PackageCommandFailed } from "../domain/errors";

const SKILL_DIRS = [".claude/skills/framio", ".agents/skills/framio"];
export const init = Effect.fn("init")(function*(skipInstall: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(process.cwd());
  const p = projectPaths(root);
  if (yield* fs.exists(p.framio)) return yield* new InvalidInput({ message: `${FRAMIO_DIR} already exists here.` });
  for (const [rel, file] of Object.entries(scaffoldFiles)) {
    // Bun embeds these paths in /$bunfs; node:fs cannot copy those virtual files.
    const bytes = yield* Effect.tryPromise({
      try: async () => new Uint8Array(await Bun.file(file).arrayBuffer()),
      catch: cause => new InvalidInput({ message: `Could not read embedded scaffold ${rel}: ${String(cause)}` }),
    });
    const destinations = rel.startsWith("skill/") ? SKILL_DIRS.map(dir => join(root, dir, rel.slice("skill/".length))) : [join(p.framio, rel === "_gitignore" ? ".gitignore" : rel)];
    for (const target of destinations) {
      yield* fs.makeDirectory(target.slice(0, target.lastIndexOf("/")), { recursive: true });
      yield* fs.writeFile(target, bytes);
    }
  }
  yield* fs.makeDirectory(p.assets, { recursive: true });
  yield* Console.log(`Created ${FRAMIO_DIR}/ with shadcn/ui, a theme, and an example page.`);
  yield* Console.log(`Added the framio skill for agents in ${SKILL_DIRS.join(" and ")}.`);
  if (skipInstall) return;
  const needsBrowser = yield* isBrowserInstalled;
  yield* Console.log(needsBrowser ? "Installing packages…" : "Installing packages and the screenshot browser…");
  const start = yield* Clock.currentTimeMillis;
  const [deps, browser] = yield* Effect.all([
    runBun(["install"], p.framio, { quiet: true }).pipe(Effect.result),
    ensureBrowser().pipe(Effect.result),
  ], { concurrency: "unbounded" });
  if (deps._tag === "Failure" || deps.success.code !== 0) return yield* new PackageCommandFailed({ message: `Package install failed:\n${deps._tag === "Failure" ? deps.failure.message : deps.success.output}\nRetry with \`framio install\`.` });
  if (browser._tag === "Failure") yield* Console.warn(`Could not download the screenshot browser (${browser.failure.message}). It will retry on first screenshot.`);
  yield* Console.log(`Done in ${(((yield* Clock.currentTimeMillis) - start) / 1000).toFixed(1)}s.\n`);
  yield* Console.log("Next: run `framio start`, then ask your agent to design something, e.g.");
  yield* Console.log('  "Use framio to design the onboarding for my invoicing app"');
});
