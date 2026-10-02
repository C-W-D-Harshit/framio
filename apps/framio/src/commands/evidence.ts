import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpApiClient } from "effect/http-api";
import { Api } from "../contracts/api";
import { EvidenceFile } from "../contracts/evidence";
import { reviewStatus } from "../domain/evidence";
import { InvalidInput } from "../domain/errors";
import { projectPaths } from "../lib/paths";
import { ServerLauncher } from "../services/server-launcher";
import { requireProject } from "./shared";

export const evidence = Effect.fn("evidence")(function* (options: {
  write: Option.Option<string>;
  expect: Option.Option<string>;
}) {
  const p = projectPaths(yield* requireProject);
  const { info } = yield* (yield* ServerLauncher).ensure(p, false);
  const client = yield* HttpApiClient.make(Api, { baseUrl: info.url });
  const current = yield* client.project.evidence();
  if (current.error) return yield* new InvalidInput({ message: current.error });
  if (Option.isSome(options.write)) {
    if (Option.isNone(options.expect) && current.revision !== null)
      return yield* new InvalidInput({
        message:
          "An evidence record already exists. Use --expect with the revision from framio evidence so newer edits stay protected.",
      });
    const expectedRevision =
      Option.isSome(options.expect) && options.expect.value !== "new"
        ? options.expect.value
        : null;
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(options.write.value);
    const next = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(EvidenceFile),
    )(text).pipe(
      Effect.mapError(
        (error) =>
          new InvalidInput({ message: `Evidence input: ${error.message}` }),
      ),
    );
    const result = yield* client.project.writeEvidence({
      payload: { evidence: next, expectedRevision },
    });
    if (!result.ok)
      return yield* new InvalidInput({
        message: result.error ?? "Evidence was not saved.",
      });
    yield* Console.log(`Saved ${p.framio}/evidence.json`);
    return;
  }
  const snapshot = yield* client.project.snapshot();
  const frames = snapshot.pages.flatMap((page) => page.frames);
  yield* Console.log(
    JSON.stringify(
      {
        ...current,
        reviews: current.evidence.reviews.map((review) => ({
          ...review,
          ...reviewStatus(
            review,
            current.captures,
            frames,
            current.contextRevision,
          ),
        })),
      },
      null,
      2,
    ),
  );
});
