import { relative } from "node:path";
import { projectPaths } from "../lib/paths";
import { ensureServer } from "./server";
import { CliError, requireProject } from "./shared";

type Result = { frame: string; path?: string; width?: number; height?: number; error?: string | null };

const USAGE = `Usage:
  framio screenshot <page/frame | frame>...   one PNG per frame
  framio screenshot --page <page>             one PNG of the whole page, laid out like the canvas
  framio screenshot --all                     every frame
Options: --scale=2 for retina output`;

function flag(args: string[], name: string) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  const arg = args[i]!;
  if (arg.includes("=")) return arg.slice(arg.indexOf("=") + 1);
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new CliError(`--${name} needs a value.\n\n${USAGE}`);
  args.splice(i + 1, 1);
  return value;
}

export async function screenshot(argv: string[]) {
  const args = [...argv];
  const p = projectPaths(requireProject());
  const scale = Number(flag(args, "scale") ?? 1);
  const page = flag(args, "page");
  const frames = args.filter((a) => !a.startsWith("--"));
  if (!page && !frames.length && !args.includes("--all")) throw new CliError(USAGE);

  const { info } = await ensureServer(p);
  const res = await fetch(`${info.url}/api/screenshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ frames, page, scale }),
  });
  const { results } = (await res.json()) as { results: Result[] };

  let failed = false;
  for (const r of results) {
    if (r.path) console.log(`${relative(process.cwd(), r.path)}  (${r.width}×${r.height}, ${r.frame})`);
    if (r.error) {
      failed = true;
      console.error(`error in ${r.frame}:\n${r.error}\n`);
    }
  }
  if (failed) process.exitCode = 1;
}
