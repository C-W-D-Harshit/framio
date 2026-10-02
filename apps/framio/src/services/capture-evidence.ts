import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CaptureEvidence } from "../contracts/evidence";
import type {
  ScreenshotResponse,
  ScreenshotResult,
} from "../contracts/requests";
import { InvalidInput } from "../domain/errors";
import type { ProjectPaths } from "../lib/paths";
import { imageSize } from "../server/image-size";
import type { ProjectState } from "./project-state";

export const makeCaptureEvidence = Effect.fn("CaptureEvidence.make")(function* (
  p: ProjectPaths,
  project: ProjectState["Service"],
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = join(p.screenshots, "history");
  yield* fs.makeDirectory(directory, { recursive: true });
  return Effect.fn("CaptureEvidence.record")(function* (
    response: typeof ScreenshotResponse.Type,
  ) {
    const state = yield* project.get;
    const capturedAt = new Date().toISOString();
    const records: CaptureEvidence[] = [];
    const archive = Effect.fnUntraced(function* (
      path: string,
      result: typeof ScreenshotResult.Type,
      layer?: string,
    ) {
      const bytes = yield* fs.readFile(path);
      const size = imageSize(bytes, "png");
      if (!size)
        return yield* new InvalidInput({
          message: "The screenshot is not a valid PNG.",
        });
      const id = randomUUID();
      const relative = `history/${id}.png`;
      const archivePath = join(p.screenshots, relative);
      yield* fs.writeFile(archivePath, bytes);
      records.push({
        id,
        frame: result.frame,
        path: relative,
        revision: result.revision,
        contextRevision:
          result.contextRevision ?? state.evidenceContextRevision ?? "",
        generation: result.generation,
        viewportWidth: result.viewportWidth ?? result.width ?? size.width,
        ...size,
        layer,
        capturedAt,
      });
      return { captureId: id, archivePath };
    });
    const results: (typeof ScreenshotResult.Type)[] = [];
    for (const result of response.results) {
      if (result.error) {
        results.push(result);
        continue;
      }
      const archived = yield* Effect.gen(function* () {
        const full = result.path ? yield* archive(result.path, result) : {};
        const crops = [];
        for (const crop of result.crops ?? [])
          crops.push({
            ...crop,
            ...(yield* archive(crop.path, result, crop.layer)),
          });
        return { ...result, ...full, ...(result.crops ? { crops } : {}) };
      }).pipe(Effect.result);
      results.push(
        archived._tag === "Success"
          ? archived.success
          : {
              ...result,
              error: `Screenshot saved, but its review record could not be archived: ${archived.failure.message}`,
            },
      );
    }
    if (records.length) {
      const saved = yield* project.recordCaptures(records).pipe(Effect.result);
      if (saved._tag === "Failure")
        return {
          results: results.map((result) => ({
            ...result,
            captureId: undefined,
            crops: result.crops?.map((crop) => ({
              ...crop,
              captureId: undefined,
            })),
            error:
              result.error ??
              `Screenshot saved, but review records could not be persisted: ${saved.failure.message}`,
          })),
        };
    }
    return { results };
  });
});
