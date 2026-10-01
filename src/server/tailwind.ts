import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectPaths } from "../lib/paths";

const SOURCE_DIRS = ["pages", "components", "lib", "hooks"];

/**
 * Compiles .framio/theme.css with Tailwind v4, scanning only .framio sources.
 *
 * Viewport units are rewritten to `calc(n * var(--fvh))`, where each frame sets `--fvh`
 * from its meta.height. This lets a frame grow to its full content height on the canvas
 * without `min-h-screen` growing along with it.
 */
export async function buildThemeCss(p: ProjectPaths): Promise<{ css: string; error: string | null }> {
  if (!existsSync(p.theme)) return { css: "", error: ".framio/theme.css is missing" };
  try {
    const compiler = await compile(readFileSync(p.theme, "utf8"), {
      base: dirname(p.theme),
      from: p.theme,
      onDependency: () => {},
    });
    const scanner = new Scanner({
      sources: [
        ...SOURCE_DIRS.map((dir) => ({ base: join(p.framio, dir), pattern: "**/*.{ts,tsx}", negated: false })),
        ...compiler.sources,
      ],
    });
    const css = compiler.build(scanner.scan());
    return { css: rewriteViewportUnits(css), error: null };
  } catch (err) {
    return { css: "", error: `theme.css: ${(err as Error).message}` };
  }
}

export function rewriteViewportUnits(css: string) {
  return css.replace(/(-?\d*\.?\d+)[dsl]?vh\b/g, (_, n) => `calc(${n} * var(--fvh, 1vh))`);
}
