import * as Semaphore from "effect/Semaphore";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  ScreenshotRequest,
  ScreenshotResponse,
  ScreenshotResult,
} from "../contracts/requests";
import type { Frame } from "../domain/project";
import { Policies } from "../domain/policies";
import { frameViewports, viewportId } from "../domain/viewports";
import { validateScreenshot } from "../domain/screenshot";
import type { ProjectPaths } from "../lib/paths";
import { ProjectState, projectSnapshot } from "./project-state";
import { Screenshots } from "./screenshots";
import { layoutViewports } from "../ui/layout";
import { findFrame } from "../server/project";

export const makeScreenshotHandler = Effect.fn("Screenshots.handler")(
  function* (
    root: string,
    p: ProjectPaths,
    project: ProjectState["Service"],
    shots: Screenshots["Service"],
    fs: FileSystem.FileSystem,
  ) {
    const serial = yield* Semaphore.make(1);
    return Effect.fn("Server.screenshot")(function* (
      body: typeof ScreenshotRequest.Type,
    ): Effect.fn.Return<typeof ScreenshotResponse.Type> {
      const valid = yield* validateScreenshot(
        body,
        !body.url && !body.page && !body.frames?.length,
      ).pipe(Effect.result);
      if (valid._tag === "Failure")
        return {
          results: [
            { frame: body.url ?? "screenshot", error: valid.failure.message },
          ],
        };
      return yield* project.withStableState((state) =>
        Effect.gen(function* () {
          const capture = (
            frame: Frame,
            scale = 1,
          ): Effect.Effect<typeof ScreenshotResult.Type> =>
            shots
              .capture(
                frame,
                join(
                  p.screenshots,
                  frame.page,
                  `${frame.slug}${frame.meta.widths || body.width ? `@${frame.meta.width}` : ""}.png`,
                ),
                scale,
              )
              .pipe(
                Effect.map((shot) => ({
                  frame: frame.id,
                  file: frame.relFile,
                  ...shot,
                })),
                Effect.catch((error) =>
                  Effect.succeed({
                    frame: frame.id,
                    file: frame.relFile,
                    error: `Screenshot failed: ${error.message}`,
                  }),
                ),
              );
          if (body.url) {
            const slug = `${new URL(body.url).hostname.replace(/[^a-z0-9-]/gi, "-")}-${createHash("sha256").update(body.url).digest("hex").slice(0, 12)}`;
            const width = body.width ?? 1440,
              height = body.height ?? 900,
              scale = body.scale ?? 1;
            let design: Frame | undefined;
            if (body.compare) {
              const found = findFrame(state.pages, body.compare);
              if ("error" in found)
                return {
                  results: [{ frame: body.compare, error: found.error }],
                };
              design = {
                ...found,
                meta: {
                  ...found.meta,
                  width,
                  height: frameViewports(found, width)[0]!.height,
                },
              };
            }
            const out = join(p.screenshots, "urls", `${slug}.png`);
            const implementation = yield* shots
              .captureUrl(body.url, out, width, height, scale)
              .pipe(Effect.result);
            if (implementation._tag === "Failure")
              return {
                results: [
                  { frame: body.url, error: implementation.failure.message },
                ],
              };
            const results: (typeof ScreenshotResult.Type)[] = [
              { frame: body.url, ...implementation.success },
            ];
            if (design) {
              const shot = yield* capture(design, scale);
              results.push(shot);
              if (shot.path && !shot.error) {
                const compared = yield* shots
                  .compare(
                    {
                      path: shot.path,
                      width: width,
                      height: shot.height!,
                      error: null,
                    },
                    implementation.success,
                    join(p.screenshots, "urls", `${slug}-compare.png`),
                    scale,
                  )
                  .pipe(Effect.result);
                results.push(
                  compared._tag === "Success"
                    ? {
                        frame: `${design.id} vs ${body.url}`,
                        ...compared.success,
                      }
                    : { frame: "comparison", error: compared.failure.message },
                );
              }
            }
            if (body.into) {
              const page = state.pages.find(
                (page) =>
                  page.id === body.into ||
                  page.name.toLowerCase() === body.into!.toLowerCase(),
              );
              const dir = join(p.pages, page?.id ?? body.into);
              const file = join(dir, `${slug}-${randomUUID().slice(0, 8)}.png`);
              const imported = yield* Effect.gen(function* () {
                yield* fs.makeDirectory(dir, { recursive: true });
                // Publish the sidecar before the image, so discovery sees a complete frame.
                yield* fs.writeFileString(
                  `${file}.json`,
                  JSON.stringify(
                    {
                      name: `Before: ${new URL(body.url!).hostname}`,
                      source: body.url,
                      note: "Current app captured before redesign",
                      width,
                    },
                    null,
                    2,
                  ) + "\n",
                );
                yield* fs.copyFile(out, file);
                return {
                  frame: `${page?.id ?? body.into}/${file.slice(dir.length + 1)}`,
                  path: file,
                  width,
                  height: implementation.success.height,
                };
              }).pipe(Effect.result);
              results.push(
                imported._tag === "Success"
                  ? imported.success
                  : { frame: body.into, error: imported.failure.message },
              );
            }
            return { results };
          }
          const page = body.page
            ? state.pages.find(
                (page) =>
                  page.id === body.page ||
                  page.name.toLowerCase() === body.page!.toLowerCase(),
              )
            : undefined;
          if (body.page && !page)
            return {
              results: [
                {
                  frame: body.page,
                  error: `No page "${body.page}". Pages: ${state.pages.map((page) => page.id).join(", ")}`,
                },
              ],
            };
          if (page && !page.frames.length)
            return {
              results: [
                { frame: page.id, error: `Page "${page.name}" has no frames.` },
              ],
            };
          const found = page
            ? page.frames
            : (body.frames?.length
                ? body.frames
                : state.pages.flatMap((page) =>
                    page.frames.map((frame) => frame.id),
                  )
              ).map((ref) => findFrame(state.pages, ref));
          const failures = found.flatMap((frame) =>
            "error" in frame
              ? [{ frame: "screenshot", error: frame.error }]
              : [],
          );
          const frames = found.flatMap((frame) =>
            "error" in frame
              ? []
              : frameViewports(frame, body.width).map((v) => ({
                  ...frame,
                  meta: { ...frame.meta, ...v },
                })),
          );
          const captures = yield* Effect.forEach(
            frames,
            (frame) => capture(frame, page ? 1 : body.scale),
            { concurrency: Policies.captureConcurrency },
          );
          if (!page) return { results: [...failures, ...captures] };
          const heights = Object.fromEntries(
            frames.map((frame, i) => [
              viewportId(frame.id, frame.meta, frame.meta.width),
              captures[i]!.height ?? frame.meta.height,
            ]),
          );
          const layout = layoutViewports(
            projectSnapshot(root, {
              ...state,
              pages: [page],
            }).pages[0]!.frames.map((frame) =>
              body.width === undefined
                ? frame
                : {
                    ...frame,
                    meta: {
                      ...frame.meta,
                      ...frameViewports(frame, body.width)[0]!,
                      ...(frame.meta.widths
                        ? {
                            widths: [body.width],
                            heights: [
                              frameViewports(frame, body.width)[0]!.height,
                            ],
                          }
                        : {}),
                    },
                  },
            ),
            heights,
            page.positions,
          );
          const overview = yield* shots
            .compose(
              layout.map(({ frame }) => {
                const index = frames.findIndex(
                  (f) =>
                    f.id === frame.frameId && f.meta.width === frame.meta.width,
                );
                const shot = captures[index];
                const first =
                  layout.find((v) => v.frame.frameId === frame.frameId)?.frame
                    .id === frame.id;
                return {
                  id: frame.id,
                  name: `${frame.meta.widths ? `${first ? `${frame.meta.name} · ` : ""}${frame.meta.width}px` : frame.meta.name}`,
                  parent:
                    frame.parent && first
                      ? (layout
                          .filter((v) => v.frame.frameId === frame.parent)
                          .at(-1)?.frame.id ?? null)
                      : null,
                  width: frame.meta.width,
                  height: heights[frame.id] ?? frame.meta.height,
                  note: frame.note,
                  src: shot?.path
                    ? `/shots/${encodeURIComponent(frame.page)}/${encodeURIComponent(shot.path.split("/").pop()!)}?g=${state.generation}`
                    : null,
                };
              }),
              Object.fromEntries(layout.map((v) => [v.frame.id, v.position])),
              join(p.screenshots, `${page.id}.png`),
              body.scale,
            )
            .pipe(Effect.result);
          return {
            results: [
              overview._tag === "Success"
                ? {
                    frame: page.id,
                    file: `.framio/pages/${page.id}`,
                    ...overview.success,
                  }
                : { frame: page.id, error: overview.failure.message },
              ...captures.filter((shot) => shot.error),
            ],
          };
        }),
      );
    }, serial.withPermit);
  },
);
