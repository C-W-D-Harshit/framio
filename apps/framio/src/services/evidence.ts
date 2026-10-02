import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { createHash } from "node:crypto";
import {
  emptyEvidence,
  EvidenceFile,
  type CaptureEvidence,
  type EvidenceUpdate,
} from "../contracts/evidence";
import { evidenceLinkErrors } from "../domain/evidence";
import { InvalidInput } from "../domain/errors";

export const evidenceRevision = (text: string | null) =>
  text === null ? null : createHash("sha256").update(text).digest("hex");

export const evidenceContextRevision = (
  file: EvidenceFile,
  previews: readonly {
    readonly frame: string;
    readonly revision: string;
  }[] = [],
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        brief: file.brief,
        references: file.references,
        direction: file.direction,
        previews,
      }),
    )
    .digest("hex")
    .slice(0, 24);

export const readEvidence = (text: string | null) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(EvidenceFile))(
    text ?? JSON.stringify(emptyEvidence),
  ).pipe(
    Effect.mapError(
      (error) =>
        new InvalidInput({
          message: `evidence.json: ${error.message}. Its contents have been preserved.`,
        }),
    ),
  );

export const makeEvidence = <E>(adapter: {
  read: Effect.Effect<string | null, E>;
  commit: (expected: string | null, next: string) => Effect.Effect<boolean, E>;
  captures: Effect.Effect<readonly CaptureEvidence[]>;
  frames: Effect.Effect<readonly string[]>;
}) =>
  Effect.gen(function* () {
    const mutex = yield* Semaphore.make(1);
    const write = Effect.fn("Evidence.write")(function* (
      payload: typeof EvidenceUpdate.Type,
    ) {
      const previous = yield* adapter.read;
      const current = yield* readEvidence(previous);
      if (evidenceRevision(previous) !== payload.expectedRevision)
        return yield* new InvalidInput({
          message: "evidence.json changed. Read it again before saving.",
        });
      const next = yield* Schema.decodeUnknownEffect(EvidenceFile)(
        payload.evidence,
      ).pipe(
        Effect.mapError(
          (error) => new InvalidInput({ message: error.message }),
        ),
      );
      const linkErrors = evidenceLinkErrors(next);
      const frames = new Set(yield* adapter.frames);
      for (const frame of next.direction
        ? [
            next.direction.frame,
            ...next.direction.alternatives.map((v) => v.frame),
          ]
        : [])
        if (!frames.has(frame))
          linkErrors.push(
            `Direction frame ${frame} does not exist. Render the composition before selecting it.`,
          );
      const captures = new Map(
        (yield* adapter.captures).map((capture) => [capture.id, capture]),
      );
      const previousReviews = new Map(
        current.reviews.map((review) => [review.id, JSON.stringify(review)]),
      );
      for (const review of next.reviews) {
        const unchanged =
          previousReviews.get(review.id) === JSON.stringify(review);
        if (unchanged) continue;
        const capture = captures.get(review.captureId);
        if (!capture || capture.frame !== review.frame || !capture.revision)
          linkErrors.push(
            `Review ${review.id} must reference a captured screenshot of ${review.frame}.`,
          );
        if (!frames.has(review.frame))
          linkErrors.push(`Reviewed frame ${review.frame} does not exist.`);
      }
      if (linkErrors.length)
        return yield* new InvalidInput({ message: linkErrors.join("\n") });
      if (
        !(yield* adapter.commit(previous, JSON.stringify(next, null, 2) + "\n"))
      )
        return yield* new InvalidInput({
          message:
            "evidence.json changed during the save. Read it again before saving.",
        });
    }, mutex.withPermit);
    return { write };
  });
