import { readComments } from "./comments";
import type { Comment } from "../contracts/comments";
import { viewports, viewportId } from "../domain/viewports";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import { watchProject } from "../platform/project-watch";
import { basename, join } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import type { Page } from "../domain/project";
import type { Snapshot } from "../contracts/snapshot";
import {
  buildFrames,
  emptyArtifacts,
  type BuildArtifacts,
} from "../server/bundler";
import { scanProject } from "../server/project";
import { buildThemeCss } from "../server/tailwind";
import { Diagnostics, measure } from "./diagnostics";
import { makeBuildCoordinator } from "./build-coordinator";

type Assets = {
  generation: number;
  imageFiles: ReadonlyMap<string, string>;
  imageVersions: ReadonlyMap<string, number>;
  imageBytes: number;
  artifacts: BuildArtifacts;
  css: { text: string; error: string | null; version: number };
};
export type ProjectGeneration = {
  comments: readonly Comment[];
  commentsError: string | null;
  retained: readonly Assets[];
  generation: number;
  imageFiles: ReadonlyMap<string, string>;
  imageBytes: number;
  pages: readonly Page[];
  artifacts: BuildArtifacts;
  css: { text: string; error: string | null; version: number };
  imageVersions: ReadonlyMap<string, number>;
  runtimeErrors: ReadonlyMap<string, string>;
};
export function projectSnapshot(
  root: string,
  value: ProjectGeneration,
): Snapshot {
  return {
    projectName: basename(root),
    comments: value.comments,
    commentsError: value.commentsError,
    cssVersion: value.css.version,
    cssError: value.css.error,
    pages: value.pages.map((page) => ({
      ...page,
      frames: page.frames.map((frame) => ({
        id: frame.id,
        kind: frame.kind,
        page: frame.page,
        slug: frame.slug,
        relFile: frame.relFile,
        meta: frame.meta,
        parent: frame.parent,
        note: frame.note,
        source: frame.source,
        viewportErrors: Object.fromEntries(
          viewports(frame.meta).flatMap((v) => {
            const error = value.runtimeErrors.get(
              viewportId(frame.id, frame.meta, v.width),
            );
            return error ? [[String(v.width), error]] : [];
          }),
        ),
        version:
          frame.kind === "image"
            ? (value.imageVersions.get(frame.id) ?? 0)
            : (value.artifacts.frames.get(frame.id)?.version ?? 0),
        error:
          frame.metaError ??
          value.artifacts.frames.get(frame.id)?.error ??
          value.runtimeErrors.get(frame.id) ??
          null,
      })),
    })),
  };
}
const makeProjectState = Effect.fn("ProjectState.make")(function* (
  p: ProjectPaths,
) {
  const fs = yield* FileSystem.FileSystem;
  const imageDirectory = yield* Effect.acquireRelease(
    fs.makeTempDirectory({ directory: p.state, prefix: "image-generations-" }),
    (dir) =>
      fs
        .remove(dir, { recursive: true, force: true })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Image generation cleanup failed", error.message),
          ),
        ),
  );
  const initial: ProjectGeneration = {
    comments: [],
    commentsError: null,
    retained: [],
    generation: 0,
    imageFiles: new Map(),
    imageBytes: 0,
    pages: [],
    artifacts: emptyArtifacts,
    css: { text: "", error: null, version: 0 },
    imageVersions: new Map(),
    runtimeErrors: new Map(),
  };
  const build = Effect.fn("ProjectState.build")(
    function* (
      previous: ProjectGeneration,
      files: ReadonlySet<string>,
      full: boolean,
    ) {
      const commentResult = yield* fs
        .readFileString(join(p.framio, "comments.json"))
        .pipe(
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed(null),
          ),
          Effect.flatMap(readComments),
          Effect.result,
        );
      const pages = yield* scanProject(p);
      const frames = pages.flatMap((page) => page.frames);
      const previousFrames = new Map(
        previous.pages.flatMap((page) =>
          page.frames
            .filter((frame) => frame.kind === "tsx")
            .map((frame) => [frame.id, frame] as const),
        ),
      );
      const sourceChanged =
        frames.filter((frame) => frame.kind === "tsx").length !==
          previousFrames.size ||
        frames.some(
          (frame) =>
            frame.kind === "tsx" &&
            previousFrames.get(frame.id)?.content !== frame.content,
        );
      const code =
        full ||
        sourceChanged ||
        [...files].some(
          (file) =>
            /\.(tsx?|jsx?)$/.test(file) ||
            /^(package\.json|bun\.lockb?|tsconfig\.json)$/.test(file),
        );
      const cssChanged =
        full ||
        code ||
        [...files].some(
          (file) => file.endsWith(".css") || file === "DESIGN.md",
        );
      const [built, theme] = yield* Effect.all(
        [
          code
            ? buildFrames(
                p,
                frames.filter((frame) => frame.kind === "tsx"),
                previous.artifacts,
              )
            : Effect.succeed({ artifacts: previous.artifacts, changed: [] }),
          cssChanged
            ? buildThemeCss(p)
            : Effect.succeed({
                css: previous.css.text,
                error: previous.css.error,
              }),
        ],
        { concurrency: 2 },
      );
      const imageVersions = new Map<string, number>();
      const imageFiles = new Map<string, string>();
      let imageBytes = 0;
      yield* Effect.forEach(
        frames.filter((frame) => frame.kind === "image"),
        (frame) =>
          Effect.gen(function* () {
            const file = join(
              imageDirectory,
              String(previous.generation + 1),
              frame.page,
              frame.slug,
            );
            yield* fs.makeDirectory(
              join(imageDirectory, String(previous.generation + 1), frame.page),
              { recursive: true },
            );
            const bytes =
              frame.imageContent ?? (yield* fs.readFile(frame.file));
            yield* fs.writeFile(file, bytes);
            imageVersions.set(frame.id, Number(Bun.hash(bytes)));
            imageBytes += bytes.byteLength;
            imageFiles.set(frame.id, file);
          }),
        { concurrency: 8, discard: true },
      );
      const runtimeErrors = new Map(
        [...previous.runtimeErrors].filter(
          ([id]) =>
            frames.some((frame) =>
              viewports(frame.meta).some(
                (v) => viewportId(frame.id, frame.meta, v.width) === id,
              ),
            ) &&
            !frames.some(
              (frame) =>
                built.changed.includes(frame.id) &&
                viewports(frame.meta).some(
                  (v) => viewportId(frame.id, frame.meta, v.width) === id,
                ),
            ),
        ),
      );
      const retained: Assets[] = [];
      let retainedBytes = 0;
      for (const assets of [
        {
          generation: previous.generation,
          imageFiles: previous.imageFiles,
          imageVersions: previous.imageVersions,
          imageBytes: previous.imageBytes,
          artifacts: previous.artifacts,
          css: previous.css,
        },
        ...previous.retained,
      ]) {
        const bytes = [...assets.artifacts.files.values()].reduce(
          (sum, text) => sum + text.length * 2,
          assets.css.text.length * 2 + assets.imageBytes,
        );
        if (retained.length >= 2 || retainedBytes + bytes > 32 * 1024 * 1024)
          break;
        retained.push(assets);
        retainedBytes += bytes;
      }
      const next: ProjectGeneration = {
        comments:
          commentResult._tag === "Success"
            ? commentResult.success.comments
            : previous.comments,
        commentsError:
          commentResult._tag === "Failure"
            ? commentResult.failure.message
            : null,
        retained,
        imageFiles,
        imageBytes,
        generation: previous.generation + 1,
        pages,
        artifacts: built.artifacts,
        imageVersions,
        runtimeErrors,
        css: {
          text: theme.css,
          error: theme.error,
          version: previous.css.version + (cssChanged ? 1 : 0),
        },
      };
      for (const old of [previous, ...previous.retained]) {
        if (
          old.generation > 0 &&
          !retained.some((assets) => assets.generation === old.generation)
        )
          yield* fs.remove(join(imageDirectory, String(old.generation)), {
            recursive: true,
            force: true,
          });
      }
      yield* Metric.update(Diagnostics.builds, 1);
      yield* Effect.logInfo(
        `built ${frames.length} frames, generation ${next.generation}`,
      );
      return next;
    },
    (effect) => measure(Diagnostics.buildDuration, effect),
  );
  const coordinator = yield* makeBuildCoordinator({
    initial,
    build: (previous, files, full) =>
      build(previous, files, full).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
    onError: (error) => Effect.logError("Project rebuild failed", error),
  });
  yield* watchProject(p.framio).pipe(
    Stream.runForEach((file) => coordinator.notify(file)),
    Effect.tapError((error) =>
      Effect.logError("Project watcher failed; retrying", error),
    ),
    Effect.retry(Schedule.spaced("1 second")),
    Effect.forkScoped,
  );
  yield* Effect.yieldNow;
  yield* coordinator.notify();
  yield* coordinator.withStableState(Effect.succeed);
  yield* coordinator.changes.pipe(
    Stream.runForEach((value) =>
      Effect.gen(function* () {
        const errors = value.pages.flatMap((page) =>
          page.frames.flatMap((frame) => {
            const buildError =
              frame.metaError ?? value.artifacts.frames.get(frame.id)?.error;

            return buildError
              ? [
                  {
                    frame: frame.id,
                    file: frame.relFile,
                    kind: "build",
                    message: buildError,
                  },
                ]
              : viewports(frame.meta).flatMap((v) => {
                  const runtimeError = value.runtimeErrors.get(
                    viewportId(frame.id, frame.meta, v.width),
                  );
                  return runtimeError
                    ? [
                        {
                          frame: frame.id,
                          file: frame.relFile,
                          kind: "runtime",
                          message: runtimeError,
                          ...(frame.meta.widths ? { width: v.width } : {}),
                        },
                      ]
                    : [];
                });
          }),
        );
        if (value.commentsError)
          errors.push({
            frame: "",
            file: ".framio/comments.json",
            kind: "comments",
            message: value.commentsError,
          });
        if (value.css.error)
          errors.unshift({
            frame: "",
            file: value.css.error.startsWith("DESIGN.md")
              ? ".framio/DESIGN.md"
              : ".framio/theme.css",
            kind: "css",
            message: value.css.error,
          });
        yield* fs.writeFileString(
          p.errorsFile,
          JSON.stringify({ errors }, null, 2) + "\n",
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logError("Could not write project diagnostics", error),
        ),
      ),
    ),
    Effect.forkScoped,
  );
  return coordinator;
});
export class ProjectState extends Context.Service<
  ProjectState,
  Effect.Success<ReturnType<typeof makeProjectState>>
>()("framio/services/ProjectState") {
  static layer(p: ProjectPaths) {
    return Layer.effect(ProjectState, makeProjectState(p));
  }
}
