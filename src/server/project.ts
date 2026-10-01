import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { join, relative } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import { InvalidInput } from "../domain/errors";
import { parseMetaLiteral } from "./meta-literal";
import { imageSize } from "./image-size";
import {
  FrameMeta,
  FrameMetaInput,
  ImageSidecar,
  CanvasFile,
  IMAGE_EXTENSIONS,
  type Frame,
  type Page,
} from "../domain/project";
export { IMAGE_EXTENSIONS };
export type { FrameMeta, Frame, Page } from "../domain/project";
const DEFAULT_META: FrameMeta = { name: "", width: 1440, height: 900 };
export function prettyPageName(dir: string) {
  const name = dir
    .replace(/^\d+[-_ ]+/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return name ? name[0]!.toUpperCase() + name.slice(1) : dir;
}
export function parseMeta(source: string): Partial<FrameMeta> {
  const match = /export\s+const\s+meta\s*(?::[^=]+)?=\s*/.exec(source);
  if (!match) return {};
  const input = Schema.decodeUnknownSync(FrameMetaInput)(
    parseMetaLiteral(source, match.index + match[0].length),
  );
  return {
    ...input,
    width: input.width === undefined ? undefined : Number(input.width) || 1440,
    height:
      input.height === undefined ? undefined : Number(input.height) || 900,
  };
}

const readFrame = Effect.fn("Project.readFrame")(function* (
  p: ProjectPaths,
  page: string,
  fileName: string,
): Effect.fn.Return<
  Frame,
  import("effect/PlatformError").PlatformError,
  FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const slug = fileName.replace(/\.tsx$/, "");
  const file = join(p.pages, page, fileName);
  const source = yield* fs.readFileString(file).pipe(Effect.result);
  const result =
    source._tag === "Failure"
      ? source
      : yield* Effect.try({
          try: () => {
            const meta = parseMeta(source.success);
            return Schema.decodeUnknownSync(FrameMeta)({
              ...DEFAULT_META,
              name: slug,
              ...meta,
              width: meta.width ?? 1440,
              height: meta.height ?? 900,
            });
          },
          catch: (cause) =>
            new InvalidInput({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        }).pipe(Effect.result);
  return {
    id: `${page}/${slug}`,
    kind: "tsx",
    page,
    slug,
    file,
    relFile: relative(p.root, file),
    content: source._tag === "Success" ? source.success : undefined,
    meta:
      result._tag === "Success"
        ? result.success
        : { ...DEFAULT_META, name: slug },
    parent: null,
    metaError:
      result._tag === "Failure"
        ? `Could not read \`export const meta\`: ${result.failure.message}`
        : undefined,
  } satisfies Frame;
});
const readImage = Effect.fn("Project.readImage")(function* (
  p: ProjectPaths,
  page: string,
  fileName: string,
): Effect.fn.Return<
  Frame,
  import("effect/PlatformError").PlatformError,
  FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const file = join(p.pages, page, fileName);
  const sidecar = yield* fs
    .readFileString(`${file}.json`)
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () =>
        Effect.succeed(null),
      ),
    );
  const result = yield* (
    sidecar === null
      ? Effect.succeed({})
      : Schema.decodeUnknownEffect(Schema.fromJsonString(ImageSidecar))(sidecar)
  ).pipe(Effect.result);
  const side: typeof ImageSidecar.Type =
    result._tag === "Success" ? result.success : {};
  let metaError =
    result._tag === "Failure"
      ? `Could not parse ${fileName}.json: ${result.failure.message}`
      : undefined;
  const imageContent = yield* fs.readFile(file);
  const detected = imageSize(
    imageContent,
    fileName.split(".").pop()!.toLowerCase(),
  );
  if (!detected)
    metaError ??= `Could not read dimensions of ${fileName}. Check the image format or file contents.`;
  const natural = detected ?? { width: 1440, height: 900 };
  const width = Math.max(
    1,
    Math.round(
      side.width ?? (natural.width >= 2400 ? natural.width / 2 : natural.width),
    ),
  );
  const height = Math.max(
    1,
    Math.round((natural.height * width) / natural.width),
  );
  return {
    id: `${page}/${fileName}`,
    kind: "image",
    page,
    slug: fileName,
    file,
    relFile: relative(p.root, file),
    meta: {
      name: side.name ?? fileName.replace(/\.[^.]+$/, ""),
      width,
      height,
      variationOf: side.variationOf,
    },
    imageContent,
    note: side.note,
    source: side.source,
    parent: null,
    metaError,
  } satisfies Frame;
});
export const scanProject = Effect.fn("Project.scan")(function* (
  p: ProjectPaths,
): Effect.fn.Return<
  Page[],
  import("effect/PlatformError").PlatformError,
  FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(p.pages))) return [];
  const dirs = (yield* fs.readDirectory(p.pages))
    .filter((dir) => !dir.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const pages: Page[] = [];
  for (const dir of dirs) {
    if ((yield* fs.stat(join(p.pages, dir))).type !== "Directory") continue;
    const files = (yield* fs.readDirectory(join(p.pages, dir)))
      .filter(
        (file) =>
          file.endsWith(".tsx") ||
          IMAGE_EXTENSIONS.includes(file.split(".").pop()!.toLowerCase()),
      )
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const frames = yield* Effect.forEach(
      files,
      (file) =>
        file.endsWith(".tsx")
          ? readFrame(p, dir, file)
          : readImage(p, dir, file),
      { concurrency: 8 },
    );
    const canvas = yield* fs
      .readFileString(join(p.pages, dir, "canvas.json"))
      .pipe(
        Effect.catchReason("PlatformError", "NotFound", () =>
          Effect.succeed("{}"),
        ),
      );
    const parsed = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(CanvasFile),
    )(canvas).pipe(Effect.result);
    pages.push({
      id: dir,
      name: prettyPageName(dir),
      frames,
      positions:
        parsed._tag === "Success" ? (parsed.success.positions ?? {}) : {},
    });
  }
  const byId = new Map(
    pages.flatMap((page) =>
      page.frames.map((frame) => [frame.id, frame] as const),
    ),
  );
  return pages.map((page) => ({
    ...page,
    frames: page.frames.map((frame) => {
      const ref = frame.meta.variationOf;
      if (!ref) return frame;
      const id = ref.includes("/") ? ref : `${frame.page}/${ref}`;
      return id !== frame.id && byId.has(id) ? { ...frame, parent: id } : frame;
    }),
  }));
});
/** Resolves "page/slug" or a bare "slug" (if unique across pages) to a frame. */
export function findFrame(
  pages: readonly Page[],
  ref: string,
): Frame | { error: string } {
  const all = pages.flatMap((pg) => pg.frames);
  const clean = ref.replace(/^\.framio\/pages\//, "").replace(/\.tsx$/, "");
  const exact = all.find((f) => f.id === clean);
  if (exact) return exact;
  const matches = all.filter((f) => f.slug === clean);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    return {
      error: `"${ref}" is ambiguous: ${matches.map((f) => f.id).join(", ")}`,
    };
  return {
    error: `No frame "${ref}". Frames: ${all.map((f) => f.id).join(", ") || "(none)"}`,
  };
}
