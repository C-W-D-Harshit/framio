import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import { readDesignCss } from "./design-md";

const SOURCE_DIRS = ["pages", "components", "lib", "hooks"];

/**
 * Compiles .framio/theme.css with Tailwind v4, scanning only .framio sources. Tokens from
 * .framio/DESIGN.md are layered on top (see design-md.ts).
 *
 * Viewport units are rewritten to `calc(n * var(--fvh))`, where each frame sets `--fvh`
 * from its meta.height. This lets a frame grow to its full content height on the canvas
 * without `min-h-screen` growing along with it.
 */
export async function buildThemeCss(p: ProjectPaths): Promise<{ css: string; error: string | null }> {
  if (!existsSync(p.theme)) return { css: "", error: ".framio/theme.css is missing" };
  const theme = readFileSync(p.theme, "utf8");
  // A broken DESIGN.md is reported but never takes the theme down with it.
  let design: ReturnType<typeof readDesignCss> = null;
  let designError: string | null = null;
  try {
    design = readDesignCss(p.designMd, theme);
  } catch (err) {
    designError = (err as Error).message;
  }
  async function build(source: string) {
    const compiler = await compile(source, {
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
    return rewriteViewportUnits(css);
  }
  try {
    const source = design ? `${design.imports}\n${theme}\n\n${design.rules}\n` : theme;
    return { css: await build(source), error: designError };
  } catch (err) {
    if (design) {
      try {
        return { css: await build(theme), error: `DESIGN.md theme could not compile: ${(err as Error).message}` };
      } catch {}
    }
    return { css: "", error: `theme.css: ${(err as Error).message}` };
  }
}

export function rewriteViewportUnits(css: string) {
  return css.replace(/(-?\d*\.?\d+)[dsl]?vh\b/g, (_, n) => `calc(${n} * var(--fvh, 1vh))`);
}
