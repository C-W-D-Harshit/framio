import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_DIR, projectPaths } from "../lib/paths";
import { CliError, requireProject } from "./shared";

const SHIM_DIR = join(GLOBAL_DIR, "shims");

/**
 * The shadcn CLI installs dependencies with the package manager it detects (bun, from
 * .framio/bun.lock). Users don't need Bun installed: this shim makes `bun` resolve to the Bun
 * built into framio.
 */
function ensureBunShim() {
  const shim = join(SHIM_DIR, "bun");
  const executable = `'${process.execPath.replace(/'/g, "'\\''")}'`;
  const script = `#!/bin/sh\nBUN_BE_BUN=1 exec ${executable} "$@"\n`;
  if (!existsSync(shim) || readFileSync(shim, "utf8") !== script) {
    mkdirSync(SHIM_DIR, { recursive: true });
    writeFileSync(shim, script);
    chmodSync(shim, 0o755);
  }
}

/**
 * Adds components from shadcn registries (@react-bits, @aceternity, @kokonutui, @rareui, shadcn
 * itself, or any registry URL) into .framio. Existing files are kept unless --overwrite is passed,
 * so a component that depends on `button` never clobbers a customized button.
 */
export async function add(args: string[]) {
  const p = projectPaths(requireProject());
  const items = args.filter((a) => !a.startsWith("-"));
  if (!items.length)
    throw new CliError(
      "Usage: framio add <item>... [--overwrite]\n\nExamples:\n  framio add @react-bits/ShinyText-TS-TW\n  framio add @aceternity/spotlight\n  framio add @kokonutui/shimmer-text\n  framio add @rareui/LiquidMetal",
    );
  if (!Bun.which("npx")) throw new CliError("framio add needs Node.js (npx). Install Node from https://nodejs.org.");

  ensureBunShim();
  const overwrite = args.includes("--overwrite");
  const proc = Bun.spawn(["npx", "-y", "shadcn@latest", "add", ...items, "--yes", ...(overwrite ? ["--overwrite"] : [])], {
    cwd: p.framio,
    env: { ...process.env, PATH: `${SHIM_DIR}:${process.env.PATH ?? ""}` },
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });
  // Answer "no" to every "file already exists, overwrite?" prompt.
  if (!overwrite) proc.stdin.write("n\n".repeat(500));
  proc.stdin.end();
  if ((await proc.exited) !== 0) throw new CliError("framio add failed.");
}
