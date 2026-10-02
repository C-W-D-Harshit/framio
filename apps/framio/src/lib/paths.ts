import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const FRAMIO_DIR = ".framio";

/** Machine-wide framio data (downloaded browsers, caches). Never inside the user's project. */
export const GLOBAL_DIR = join(homedir(), ".framio");
export const BROWSERS_DIR = join(GLOBAL_DIR, "browsers");

export type ProjectPaths = ReturnType<typeof projectPaths>;

export function projectPaths(root: string) {
  root = resolve(root);
  const framio = join(root, FRAMIO_DIR);
  const state = join(framio, ".state");
  return {
    root,
    framio,
    pages: join(framio, "pages"),
    theme: join(framio, "theme.css"),
    designMd: join(framio, "DESIGN.md"),
    assets: join(framio, "assets"),
    state,
    entries: join(state, "entries"),
    screenshots: join(state, "screenshots"),
    serverFile: join(state, "server.json"),
    serverLog: join(state, "server.log"),
    selectionFile: join(state, "selection.json"),
    errorsFile: join(state, "errors.json"),
  };
}
