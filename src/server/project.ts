import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import { imageSize } from "./image-size";

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

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg"];

export type Frame = {
  id: string; // "<page>/<slug>"
  /** "tsx": a React mockup. "image": a reference, moodboard shot, or generated image placed on the canvas. */
  kind: "tsx" | "image";
  page: string;
  /** File name without extension for tsx frames, full file name for images. */
  slug: string;
  /** Images only: a caption shown under the frame, e.g. what to borrow from a reference. */
  note?: string;
  /** Images only: where the image came from (Mobbin link, URL). */
  source?: string;
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
    kind: "tsx",
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

/**
 * Images get their size from the file. Optional sidecar `<file>.json` sets
 * { name, width, note, source, variationOf }. Images 2400px or wider are assumed to be @2x.
 */
function readImage(p: ProjectPaths, page: string, fileName: string): Frame {
  const file = join(p.pages, page, fileName);
  const ext = fileName.split(".").pop()!.toLowerCase();
  let side: { name?: string; width?: number; note?: string; source?: string; variationOf?: string } = {};
  let metaError: string | undefined;
  const sidecar = `${file}.json`;
  if (existsSync(sidecar)) {
    try {
      const parsed = JSON.parse(readFileSync(sidecar, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object");
      for (const key of ["name", "note", "source", "variationOf"]) {
        if (parsed[key] !== undefined && typeof parsed[key] !== "string") throw new Error(`${key} must be a string`);
      }
      if (parsed.width !== undefined && (typeof parsed.width !== "number" || !Number.isFinite(parsed.width) || parsed.width <= 0))
        throw new Error("width must be a positive number");
      side = parsed;
    } catch (err) {
      metaError = `Could not parse ${fileName}.json: ${(err as Error).message}`;
    }
  }
  const natural = imageSize(new Uint8Array(readFileSync(file)), ext) ?? { width: 1440, height: 900 };
  const width = Math.max(1, Math.round(side.width ?? (natural.width >= 2400 ? natural.width / 2 : natural.width)));
  const height = Math.max(1, Math.round((natural.height * width) / natural.width));
  return {
    id: `${page}/${fileName}`,
    kind: "image",
    page,
    slug: fileName,
    file,
    relFile: relative(p.root, file),
    meta: { name: side.name ?? fileName.replace(/\.[^.]+$/, ""), width, height, variationOf: side.variationOf },
    note: side.note,
    source: side.source,
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
        .filter((f) => f.endsWith(".tsx") || IMAGE_EXTENSIONS.includes(f.split(".").pop()!.toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => (f.endsWith(".tsx") ? readFrame(p, dir, f) : readImage(p, dir, f))),
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
