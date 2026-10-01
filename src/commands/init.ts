import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, sep } from "node:path";
import { ensureBrowser, isBrowserInstalled } from "../lib/browser";
import { runBun } from "../lib/bun";
import { FRAMIO_DIR, SCAFFOLD_DIR, projectPaths } from "../lib/paths";
import { CliError } from "./shared";

/** Agent skill locations, one per harness. Written per project so they're versioned with the designs. */
const SKILL_DIRS = [".claude/skills/framio", ".agents/skills/framio"];

export async function init(args: string[]) {
  const root = process.cwd();
  const p = projectPaths(root);
  if (existsSync(p.framio)) throw new CliError(`${FRAMIO_DIR} already exists here.`);

  const skillSrc = join(SCAFFOLD_DIR, "skill");
  cpSync(SCAFFOLD_DIR, p.framio, {
    recursive: true,
    filter: (src) => src !== skillSrc && !src.startsWith(skillSrc + sep),
  });
  renameSync(join(p.framio, "_gitignore"), join(p.framio, ".gitignore"));
  for (const dir of SKILL_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
    cpSync(join(skillSrc, "SKILL.md"), join(root, dir, "SKILL.md"));
  }
  console.log(`Created ${FRAMIO_DIR}/ with shadcn/ui, a theme, and an example page.`);
  console.log(`Added the framio skill for agents in ${SKILL_DIRS.join(" and ")}.`);

  if (args.includes("--skip-install")) return;

  const needsBrowser = !isBrowserInstalled();
  console.log(needsBrowser ? "Installing packages and the screenshot browser…" : "Installing packages…");
  const t = performance.now();
  const [deps, browser] = await Promise.allSettled([
    runBun(["install"], p.framio, { quiet: true }),
    needsBrowser ? ensureBrowser() : Promise.resolve(""),
  ]);

  if (deps.status === "rejected" || deps.value.code !== 0) {
    const output = deps.status === "fulfilled" ? deps.value.output : String(deps.reason);
    throw new CliError(`Package install failed:\n${output}\nRetry with \`framio install\`.`);
  }
  if (browser.status === "rejected")
    console.warn(`Could not download the screenshot browser (${browser.reason}). It will retry on first screenshot.`);

  console.log(`Done in ${((performance.now() - t) / 1000).toFixed(1)}s.\n`);
  console.log("Next: run `framio start`, then ask your agent to design something.");
}
