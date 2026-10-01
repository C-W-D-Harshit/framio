import { relative } from "node:path";
import { projectPaths } from "../lib/paths";
import { ensureServer } from "./server";
import { CliError, requireProject } from "./shared";

type Result = { frame: string; path?: string; width?: number; height?: number; error?: string | null };

export async function screenshot(args: string[]) {
  const p = projectPaths(requireProject());
  const scaleArg = args.find((a) => a.startsWith("--scale="));
  const scale = scaleArg ? Number(scaleArg.split("=")[1]) : 1;
  const frames = args.filter((a) => !a.startsWith("--"));
  if (!frames.length && !args.includes("--all"))
    throw new CliError("Usage: framio screenshot <page/frame | frame>... [--scale=2]  (or --all)");

  const { info } = await ensureServer(p);
  const res = await fetch(`${info.url}/api/screenshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ frames, scale }),
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
