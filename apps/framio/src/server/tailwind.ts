import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { dirname, join } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import { readDesignCss } from "./design-md";

const SOURCE_DIRS = ["pages", "components", "lib", "hooks"];
export type ThemeSession = {
  source?: string;
  compiler?: Awaited<ReturnType<typeof compile>>;
  scanner?: Scanner;
  builds: number;
};
export const buildThemeCss = Effect.fn("Theme.build")(function* (
  p: ProjectPaths,
  session?: ThemeSession,
) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(p.theme)))
    return { css: "", error: ".framio/theme.css is missing" };
  const theme = yield* fs.readFileString(p.theme);
  const parsed = yield* readDesignCss(p.designMd, theme).pipe(Effect.result);
  const design = parsed._tag === "Success" ? parsed.success : null;
  const designError = parsed._tag === "Failure" ? parsed.failure.message : null;
  const build = (source: string) =>
    Effect.tryPromise(async () => {
      const reuse = session?.source === source && session.builds < 32;
      const compiler =
        reuse && session.compiler
          ? session.compiler
          : await compile(source, {
              base: dirname(p.theme),
              from: p.theme,
              onDependency: () => {},
            });
      const scanner =
        reuse && session.scanner
          ? session.scanner
          : new Scanner({
              sources: [
                ...SOURCE_DIRS.map((dir) => ({
                  base: join(p.framio, dir),
                  pattern: "**/*.{ts,tsx,js,jsx}",
                  negated: false,
                })),
                ...compiler.sources,
              ],
            });
      if (session) {
        session.source = source;
        session.compiler = compiler;
        session.scanner = scanner;
        session.builds = reuse ? session.builds + 1 : 1;
      }
      return rewriteViewportUnits(compiler.build(scanner.scan()));
    });
  const result = yield* build(
    design ? `${design.imports}\n${theme}\n\n${design.rules}\n` : theme,
  ).pipe(Effect.result);
  if (result._tag === "Success")
    return { css: result.success, error: designError };
  if (design) {
    const fallback = yield* build(theme).pipe(Effect.result);
    if (fallback._tag === "Success")
      return {
        css: fallback.success,
        error: `DESIGN.md theme could not compile: ${result.failure.message}`,
      };
  }
  return { css: "", error: `theme.css: ${result.failure.message}` };
});
export function rewriteViewportUnits(css: string) {
  return css.replace(
    /(-?\d*\.?\d+)[dsl]?vh\b/g,
    (_, n) => `calc(${n} * var(--fvh, 1vh))`,
  );
}
