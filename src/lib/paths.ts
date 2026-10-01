import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const FRAMIO_DIR = ".framio";

/** Machine-wide framio data (downloaded browsers, caches). Never inside the user's project. */
export const GLOBAL_DIR = join(homedir(), ".framio");
export const BROWSERS_DIR = join(GLOBAL_DIR, "browsers");

/** Walks up from `from` to find the nearest directory containing `.framio`. */
export function findProjectRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, FRAMIO_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export type ProjectPaths = ReturnType<typeof projectPaths>;

export function projectPaths(root: string) {
  const framio = join(root, FRAMIO_DIR);
  const state = join(framio, ".state");
  return {
    root,
    framio,
    pages: join(framio, "pages"),
    theme: join(framio, "theme.css"),
    state,
    entries: join(state, "entries"),
    screenshots: join(state, "screenshots"),
    serverFile: join(state, "server.json"),
    serverLog: join(state, "server.log"),
    selectionFile: join(state, "selection.json"),
    errorsFile: join(state, "errors.json"),
  };
}
