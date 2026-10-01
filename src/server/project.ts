import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectPaths } from "../lib/paths";

export type FrameMeta = {
  name: string;
  /** Viewport width in px. */
  width: number;
  /** Viewport height in px. `h-screen` / `vh` units resolve against this. */
  height: number;
  /** Slug of the frame this one is a variation of ("slug" in the same page, or "page/slug"). */
  variationOf?: string;
  theme?: "light" | "dark";
};

export type Frame = {
  id: string; // "<page>/<slug>"
  page: string;
  slug: string;
  file: string; // absolute
  relFile: string; // relative to the project root
  meta: FrameMeta;
  /** Resolved id of the parent frame, when variationOf points at an existing frame. */
  parent: string | null;
  metaError?: string;
};

export type Page = {
  id: string; // directory name
  name: string;
  frames: Frame[];
  positions: Record<string, { x: number; y: number }>;
};

const DEFAULT_META: FrameMeta = { name: "", width: 1440, height: 900 };

export function prettyPageName(dir: string) {
  const name = dir.replace(/^\d+[-_ ]+/, "").replace(/[-_]+/g, " ").trim();
  return name ? name[0]!.toUpperCase() + name.slice(1) : dir;
}

/** Extracts the object literal after `export const meta =` without executing the frame module. */
export function parseMeta(source: string): Partial<FrameMeta> {
  const match = /export\s+const\s+meta\s*(?::[^=]+)?=\s*/.exec(source);
  if (!match) return {};
  const start = source.indexOf("{", match.index + match[0].length - 1);
  if (start === -1) return {};
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      const literal = source.slice(start, i + 1).replace(/\}\s*as\s+const\s*$/, "}");
      return new Function(`return (${literal});`)() as Partial<FrameMeta>;
    }
  }
  return {};
}

function readFrame(p: ProjectPaths, page: string, fileName: string): Frame {
  const slug = fileName.replace(/\.tsx$/, "");
  const file = join(p.pages, page, fileName);
  let meta: Partial<FrameMeta> = {};
  let metaError: string | undefined;
  try {
    meta = parseMeta(readFileSync(file, "utf8"));
  } catch (err) {
    metaError = `Could not read \`export const meta\`: ${(err as Error).message}`;
  }
  return {
    id: `${page}/${slug}`,
    page,
    slug,
    file,
    relFile: relative(p.root, file),
    meta: {
      ...DEFAULT_META,
      name: slug,
      ...meta,
      width: Number(meta.width) || DEFAULT_META.width,
      height: Number(meta.height) || DEFAULT_META.height,
    },
    parent: null,
    metaError,
  };
}

function readPositions(p: ProjectPaths, page: string): Page["positions"] {
  const file = join(p.pages, page, "canvas.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")).positions ?? {};
  } catch {
    return {};
  }
}

export function scanProject(p: ProjectPaths): Page[] {
  if (!existsSync(p.pages)) return [];
  const pages: Page[] = readdirSync(p.pages)
    .filter((dir) => !dir.startsWith(".") && statSync(join(p.pages, dir)).isDirectory())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((dir) => ({
      id: dir,
      name: prettyPageName(dir),
      frames: readdirSync(join(p.pages, dir))
        .filter((f) => f.endsWith(".tsx"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => readFrame(p, dir, f)),
      positions: readPositions(p, dir),
    }));

  const byId = new Map(pages.flatMap((pg) => pg.frames.map((f) => [f.id, f] as const)));
  for (const frame of byId.values()) {
    const ref = frame.meta.variationOf;
    if (!ref) continue;
    const id = ref.includes("/") ? ref : `${frame.page}/${ref}`;
    if (id !== frame.id && byId.has(id)) frame.parent = id;
  }
  return pages;
}

/** Resolves "page/slug" or a bare "slug" (if unique across pages) to a frame. */
export function findFrame(pages: Page[], ref: string): Frame | { error: string } {
  const all = pages.flatMap((pg) => pg.frames);
  const clean = ref.replace(/^\.framio\/pages\//, "").replace(/\.tsx$/, "");
  const exact = all.find((f) => f.id === clean);
  if (exact) return exact;
  const matches = all.filter((f) => f.slug === clean);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) return { error: `"${ref}" is ambiguous: ${matches.map((f) => f.id).join(", ")}` };
  return { error: `No frame "${ref}". Frames: ${all.map((f) => f.id).join(", ") || "(none)"}` };
}
