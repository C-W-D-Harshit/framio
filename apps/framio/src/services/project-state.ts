import { makeGenerationLeases } from "./generation-leases";
import type { LayerWarning } from "../contracts/layers";
import { readComments } from "./comments";
import type { Comment } from "../contracts/comments";
import { viewports, viewportId } from "../domain/viewports";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
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
import { buildThemeCss, type ThemeSession } from "../server/tailwind";
import { Diagnostics, measure } from "./diagnostics";
import { makeBuildCoordinator } from "./build-coordinator";
import { createHash, randomUUID } from "node:crypto";
import {
  CapturesFile,
  emptyEvidence,
  type CaptureEvidence,
  type EvidenceFile,
} from "../contracts/evidence";
import * as Schema from "effect/Schema";
import {
  evidenceContextRevision,
  evidenceRevision,
  readEvidence,
} from "./evidence";
import { frameRevision } from "./frame-revision";

type Assets = {
  generation: number;
  imageFiles: ReadonlyMap<string, string>;
  imageVersions: ReadonlyMap<string, number>;
  imageBytes: number;
  artifacts: BuildArtifacts;
  css: { text: string; error: string | null; version: number };
};
export type ProjectGeneration = {
  evidence?: EvidenceFile;
  evidenceRevision?: string | null;
  evidenceContextRevision?: string;
  evidenceError?: string | null;
  captures?: readonly CaptureEvidence[];
  assetRevision?: string;
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
  layerWarnings?: ReadonlyMap<string, readonly (typeof LayerWarning.Type)[]>;
};
export function projectSnapshot(
  root: string,
  value: ProjectGeneration,
): Snapshot {
  const cssHash = Bun.hash(value.css.text).toString(16);
  return {
    projectName: basename(root),
    evidence: value.evidence ?? emptyEvidence,
    evidenceRevision: value.evidenceRevision ?? null,
    evidenceContextRevision:
      value.evidenceContextRevision ?? evidenceContextRevision(emptyEvidence),
    evidenceError: value.evidenceError ?? null,
    captures: value.captures ?? [],
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
        geometryVersion: `${frame.kind === "image" ? value.imageVersions.get(frame.id) : value.artifacts.frames.get(frame.id)?.hash}-${cssHash}`,
        revision: frameRevision(value, frame),
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
  const capturePermits = yield* Semaphore.make(8);
  const evidenceWrites = yield* Semaphore.make(1);
  const leases = yield* makeGenerationLeases<ProjectGeneration>();
  const storedCaptures = yield* fs
    .readFileString(join(p.state, "captures.json"))
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () =>
        Effect.succeed("[]"),
      ),
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(CapturesFile)),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Capture history unavailable", error.message).pipe(
          Effect.as([] as readonly CaptureEvidence[]),
        ),
      ),
    );
  const initial: ProjectGeneration = {
    evidence: emptyEvidence,
    evidenceRevision: null,
    evidenceContextRevision: evidenceContextRevision(emptyEvidence),
    evidenceError: null,
    captures: storedCaptures,
    assetRevision: "",
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
  const themeSession: ThemeSession = { builds: 0 };
  const build = Effect.fn("ProjectState.build")(
    function* (
      previous: ProjectGeneration,
      files: ReadonlySet<string>,
      full: boolean,
    ) {
      const evidenceText = yield* fs
        .readFileString(join(p.framio, "evidence.json"))
        .pipe(
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed(null),
          ),
          Effect.result,
        );
      const evidenceResult =
        evidenceText._tag === "Success"
          ? yield* readEvidence(evidenceText.success).pipe(Effect.result)
          : evidenceText;
      const evidence =
        evidenceResult._tag === "Success"
          ? evidenceResult.success
          : (previous.evidence ?? emptyEvidence);
      let assetRevision = previous.assetRevision ?? "";
      if (full || [...files].some((file) => /^(assets)([/\\]|$)/.test(file))) {
        const hash = createHash("sha256");
        const paths = yield* fs
          .readDirectory(p.assets, { recursive: true })
          .pipe(
            Effect.catchReason("PlatformError", "NotFound", () =>
              Effect.succeed([] as string[]),
            ),
          );
        for (const name of paths.sort()) {
          const file = join(p.assets, name);
          const info = yield* fs.stat(file);
          if (info.type !== "File") continue;
          hash.update(name).update(yield* fs.readFile(file));
        }
        assetRevision = hash.digest("hex");
      }
      const commentResult = yield* fs
        .readFileString(join(p.framio, "comments.json"))
        .pipe(
          Effect.catchReason("PlatformError", "NotFound", () =>
            Effect.succeed(null),
          ),
          Effect.flatMap(readComments),
          Effect.result,
        );
      const pages =
        !full &&
        files.size > 0 &&
        [...files].every(
          (file) => file === "comments.json" || file === "evidence.json",
        )
          ? previous.pages
          : yield* scanProject(p, previous.pages, full ? undefined : files);
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
      if (
        full ||
        [...files].some(
          (file) =>
            file.endsWith(".css") || /^(package\.json|bun\.lockb?)$/.test(file),
        )
      ) {
        themeSession.source = undefined;
      }
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
            ? buildThemeCss(p, themeSession)
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
            const bytes =
              frame.imageContent ?? (yield* fs.readFile(frame.file));
            const file = join(
              imageDirectory,
              `${Bun.hash(bytes).toString(16)}-${frame.slug}`,
            );
            if (!(yield* fs.exists(file))) yield* fs.writeFile(file, bytes);
            imageVersions.set(frame.id, Number(Bun.hash(bytes)));
            imageBytes += bytes.byteLength;
            imageFiles.set(frame.id, file);
          }),
        { concurrency: 8, discard: true },
      );
      const currentViewportIds = new Set(
        frames.flatMap((frame) =>
          viewports(frame.meta).map((v) =>
            viewportId(frame.id, frame.meta, v.width),
          ),
        ),
      );
      const changedFrames = new Set(built.changed);
      const changedViewportIds = new Set(
        frames
          .filter((frame) => changedFrames.has(frame.id))
          .flatMap((frame) =>
            viewports(frame.meta).map((v) =>
              viewportId(frame.id, frame.meta, v.width),
            ),
          ),
      );
      const runtimeErrors = new Map(
        [...previous.runtimeErrors].filter(
          ([id]) => currentViewportIds.has(id) && !changedViewportIds.has(id),
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
        evidence,
        evidenceRevision:
          evidenceText._tag === "Success"
            ? evidenceRevision(evidenceText.success)
            : previous.evidenceRevision,
        evidenceContextRevision: evidenceContextRevision(evidence),
        evidenceError:
          evidenceResult._tag === "Failure"
            ? evidenceResult.failure.message
            : null,
        captures: previous.captures,
        assetRevision,
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
        layerWarnings: new Map(
          [...(previous.layerWarnings ?? [])].filter(
            ([id]) => currentViewportIds.has(id) && !changedViewportIds.has(id),
          ),
        ),
        css: {
          text: theme.css,
          error: theme.error,
          version:
            previous.css.version +
            (theme.css !== previous.css.text ||
            theme.error !== previous.css.error
              ? 1
              : 0),
        },
      };
      const framesById = new Map(frames.map((frame) => [frame.id, frame]));
      next.evidenceContextRevision = evidenceContextRevision(
        evidence,
        evidence.references.flatMap((reference) => {
          if (!reference.previewFrame) return [];
          const preview = framesById.get(reference.previewFrame);
          return [
            {
              frame: reference.previewFrame,
              revision: preview ? frameRevision(next, preview) : "missing",
            },
          ];
        }),
      );
      const active = yield* leases.values;
      const referencedImages = new Set(
        [next, ...retained, ...active].flatMap((assets) => [
          ...assets.imageFiles.values(),
        ]),
      );
      for (const name of yield* fs.readDirectory(imageDirectory)) {
        const file = join(imageDirectory, name);
        if (!referencedImages.has(file))
          yield* fs.remove(file, { force: true });
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
        if (value.evidenceError)
          errors.push({
            frame: "",
            file: ".framio/evidence.json",
            kind: "evidence",
            message: value.evidenceError,
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
          JSON.stringify(
            {
              errors,
              warnings: value.pages.flatMap((page) =>
                page.frames.flatMap((frame) =>
                  viewports(frame.meta).flatMap((v) =>
                    (
                      value.layerWarnings?.get(
                        viewportId(frame.id, frame.meta, v.width),
                      ) ?? []
                    ).map((w) => ({
                      frame: frame.id,
                      ...(frame.meta.widths ? { width: v.width } : {}),
                      ...w,
                    })),
                  ),
                ),
              ),
            },
            null,
            2,
          ) + "\n",
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logError("Could not write project diagnostics", error),
        ),
      ),
    ),
    Effect.forkScoped,
  );
  const withGeneration = <A, E, R>(
    use: (state: ProjectGeneration, token: string) => Effect.Effect<A, E, R>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const lease = yield* Effect.acquireRelease(
          coordinator.withStableState(leases.acquire),
          leases.release,
        );
        return yield* use(lease.state, lease.token);
      }),
    ).pipe(Semaphore.withPermits(capturePermits, 1));
  const recordCaptures = Effect.fn("ProjectState.recordCaptures")(function* (
    records: readonly CaptureEvidence[],
  ) {
    yield* coordinator
      .withStableState((state) =>
        Effect.gen(function* () {
          const reviewed = new Set(
            state.evidence?.reviews.map((review) => review.captureId) ?? [],
          );
          const incoming = new Set(records.map((record) => record.id));
          const all = [...records, ...(state.captures ?? [])];
          const captures = all.filter(
            (capture, index) =>
              index < 48 ||
              incoming.has(capture.id) ||
              reviewed.has(capture.id),
          );
          const file = join(p.state, "captures.json");
          const temporary = `${file}.${randomUUID()}.tmp`;
          yield* Effect.acquireUseRelease(
            Effect.succeed(temporary),
            () =>
              fs
                .writeFileString(
                  temporary,
                  JSON.stringify(captures, null, 2) + "\n",
                )
                .pipe(Effect.andThen(fs.rename(temporary, file))),
            () =>
              fs
                .remove(temporary, { force: true })
                .pipe(
                  Effect.catch((error) => Effect.logWarning(error.message)),
                ),
          );
          const kept = new Set(captures.map((capture) => capture.id));
          for (const capture of all)
            if (!kept.has(capture.id))
              yield* fs
                .remove(join(p.screenshots, capture.path), { force: true })
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning(
                      "Old capture cleanup failed",
                      error.message,
                    ),
                  ),
                );
          return captures;
        }),
      )
      .pipe(
        Effect.flatMap((captures) =>
          coordinator.update((state) => ({ ...state, captures })),
        ),
      );
  }, evidenceWrites.withPermit);
  const withEvidenceWrite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    evidenceWrites.withPermit(effect);
  return {
    ...coordinator,
    withGeneration,
    pinned: leases.get,
    pinnedValues: leases.values,
    recordCaptures,
    withEvidenceWrite,
  };
});
export class ProjectState extends Context.Service<
  ProjectState,
  Effect.Success<ReturnType<typeof makeProjectState>>
>()("framio/services/ProjectState") {
  static layer(p: ProjectPaths) {
    return Layer.effect(ProjectState, makeProjectState(p));
  }
}
