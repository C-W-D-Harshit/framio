import { runBun } from "../lib/bun";
import { projectPaths } from "../lib/paths";
import { CliError, requireProject } from "./shared";

/** Adds packages to .framio/package.json using the Bun bundled inside framio. */
export async function install(args: string[]) {
  const p = projectPaths(requireProject());
  const pkgs = args.filter((a) => !a.startsWith("-"));
  const { code } = await runBun(pkgs.length ? ["add", ...pkgs] : ["install"], p.framio);
  if (code !== 0) throw new CliError("Install failed.");
}
