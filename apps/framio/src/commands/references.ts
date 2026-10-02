import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/cli";
import { HttpApiClient } from "effect/http-api";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Api } from "../contracts/api";
import type {
  DesignReference,
  ReferenceCapture,
} from "../contracts/references";
import type { ScreenshotResponse } from "../contracts/requests";
import { CaptureFailed, InvalidInput } from "../domain/errors";
import { ViewportDimension } from "../domain/project";
import { referenceById, searchReferences } from "../domain/references";
import { projectPaths, type ProjectPaths } from "../lib/paths";
import { ServerLauncher } from "../services/server-launcher";
import { requireProject } from "./shared";

export const saveReferenceCapture = Effect.fn("saveReferenceCapture")(
  function* (
    paths: ProjectPaths,
    reference: DesignReference,
    response: typeof ScreenshotResponse.Type,
  ) {
    const shot = response.results.find(
      (result) => result.frame === reference.previewUrl,
    );
    if (!shot?.path || !shot.width || !shot.height || shot.error)
      return yield* new CaptureFailed({
        message: `Could not capture ${reference.name}: ${shot?.error ?? response.results.find((result) => result.error)?.error ?? "the screenshot service returned no complete image"}`,
      });
    const fs = yield* FileSystem.FileSystem;
    const filename = `${reference.id}-${yield* Effect.sync(randomUUID)}.png`;
    const path = join(paths.pages, "01-moodboard", filename);
    const sidecarPath = `${path}.json`;
    const temporary = `${path}.tmp`;
    yield* fs.makeDirectory(join(paths.pages, "01-moodboard"), {
      recursive: true,
    });
    yield* Effect.scoped(
      Effect.gen(function* () {
        let published = false;
        yield* Effect.addFinalizer(() =>
          Effect.all([
            fs.remove(temporary, { force: true }),
            published ? Effect.void : fs.remove(sidecarPath, { force: true }),
          ]).pipe(
            Effect.catch((error) =>
              Effect.logWarning(
                "Reference temporary file cleanup failed",
                error.message,
              ),
            ),
          ),
        );
        yield* fs.copyFile(shot.archivePath ?? shot.path!, temporary);
        yield* fs.writeFileString(
          sidecarPath,
          JSON.stringify(
            {
              name: reference.name,
              source: reference.previewUrl,
              note: `Borrow: ${reference.borrow}\nAdapt: ${reference.avoid}`,
              width: shot.width,
            },
            null,
            2,
          ) + "\n",
        );
        yield* fs.rename(temporary, path).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              published = true;
            }),
          ),
          Effect.uninterruptible,
        );
      }),
    );
    return {
      reference,
      frame: `01-moodboard/${filename}`,
      path,
      sidecarPath,
      ...(shot.captureId ? { captureId: shot.captureId } : {}),
      width: shot.width,
      height: shot.height,
    } satisfies ReferenceCapture;
  },
);

export const references = Effect.fn("references")(function* (options: {
  query: Option.Option<string>;
  capture: Option.Option<string>;
  json: boolean;
  width: number;
  height: number;
}) {
  if (Option.isSome(options.capture)) {
    if (Option.isSome(options.query))
      return yield* new InvalidInput({
        message: "Use a search query or --capture <id>, not both.",
      });
    const reference = yield* referenceById(options.capture.value);
    const paths = projectPaths(yield* requireProject);
    const { info } = yield* (yield* ServerLauncher).ensure(paths, true);
    const client = yield* HttpApiClient.make(Api, { baseUrl: info.url });
    const response = yield* client.project.screenshot({
      payload: {
        url: reference.previewUrl,
        width: options.width,
        height: options.height,
        scale: 1,
        viewportOnly: true,
      },
    });
    const captured = yield* saveReferenceCapture(paths, reference, response);
    if (options.json) {
      yield* Console.log(JSON.stringify(captured, null, 2));
      return;
    }
    yield* Console.log(
      `${reference.name}\nImage: ${captured.path}\nNotes: ${captured.sidecarPath}\nFrame: ${captured.frame}\nSize: ${captured.width}x${captured.height}${captured.captureId ? `\nCapture: ${captured.captureId}` : ""}\nBorrow: ${reference.borrow}\nInspect the saved image before using this reference.`,
    );
    return;
  }
  const query = Option.getOrElse(options.query, () => "");
  const results = searchReferences(query);
  if (options.json) {
    yield* Console.log(JSON.stringify({ query, references: results }, null, 2));
    return;
  }
  if (!results.length) {
    yield* Console.log(
      `No curated references match "${query}". Run framio references to list all candidates.`,
    );
    return;
  }
  for (const reference of results)
    yield* Console.log(
      `${reference.id}: ${reference.name}\n${reference.description}\nPreview: ${reference.previewUrl}\nSource: ${reference.sourceUrl}\nBorrow: ${reference.borrow}\nAdapt: ${reference.avoid}\nRegistry: ${reference.registryItem}\nRegistry check: ${reference.registryStatus}, ${reference.registryCheckedAt}\nPreview checked: ${reference.previewCheckedAt}\nCapture: framio references --capture ${reference.id}\n`,
    );
});

export const referencesCommand = Command.make(
  "references",
  {
    query: Argument.String("query").pipe(Argument.optional),
    capture: Flag.String("capture").pipe(Flag.optional),
    json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
    width: Flag.Finite("width").pipe(
      Flag.withSchema(ViewportDimension),
      Flag.withDefault(1440),
    ),
    height: Flag.Finite("height").pipe(
      Flag.withSchema(ViewportDimension),
      Flag.withDefault(900),
    ),
  },
  references,
).pipe(
  Command.withDescription(
    "Find curated visual references and capture one into the moodboard",
  ),
);
