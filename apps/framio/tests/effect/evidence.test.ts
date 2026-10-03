import { assert, describe, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import {
  emptyEvidence,
  type CaptureEvidence,
  type EvidenceFile,
} from "../../src/contracts/evidence";
import type { SnapshotFrame } from "../../src/contracts/snapshot";
import { reviewStatus } from "../../src/domain/evidence";
import { reconcileSnapshot } from "../../src/ui/snapshot-reconciliation";
import type { Snapshot } from "../../src/contracts/snapshot";
import {
  evidenceContextRevision,
  evidenceRevision,
  makeEvidence,
  readEvidence,
} from "../../src/services/evidence";

const capture: CaptureEvidence = {
  id: "capture-1",
  frame: "01-test/hero",
  path: "history/capture-1.png",
  revision: "design-1",
  contextRevision: evidenceContextRevision(emptyEvidence),
  generation: 1,
  viewportWidth: 390,
  width: 390,
  height: 844,
  capturedAt: "2026-10-02T12:00:00Z",
};
const frame: SnapshotFrame = {
  id: capture.frame,
  kind: "tsx",
  page: "01-test",
  slug: "hero",
  relFile: ".framio/pages/01-test/hero.tsx",
  meta: { name: "Hero", width: 1440, height: 900, widths: [1440, 390] },
  parent: null,
  version: 1,
  error: null,
  revision: capture.revision,
};
const review = {
  id: "review-1",
  frame: capture.frame,
  captureId: capture.id,
  kind: "composition" as const,
  verdict: "pass" as const,
  findings: ["The product task remains readable at 390px."],
  changes: [],
  createdAt: "2026-10-02T12:01:00Z",
};

describe("capture-linked evidence", () => {
  it.effect(
    "publishes evidence-only and capture-only updates without replacing unchanged canvas frames",
    () =>
      Effect.gen(function* () {
        const initial: Snapshot = {
          projectName: "Fixture",
          cssVersion: 1,
          cssError: null,
          evidence: emptyEvidence,
          captures: [],
          pages: [
            { id: "01-test", name: "Test", positions: {}, frames: [frame] },
          ],
        };
        const captured = reconcileSnapshot(initial, {
          ...initial,
          captures: [capture],
        });
        assert.notStrictEqual(captured, initial);
        assert.deepStrictEqual(captured.captures, [capture]);
        assert.strictEqual(captured.pages, initial.pages);
        const reviewed = reconcileSnapshot(captured, {
          ...captured,
          evidence: { ...emptyEvidence, reviews: [review] },
        });
        assert.notStrictEqual(reviewed, captured);
        assert.deepStrictEqual(reviewed.evidence?.reviews, [review]);
        assert.strictEqual(reviewed.pages[0]?.frames[0], frame);
        const errored = reconcileSnapshot(reviewed, {
          ...reviewed,
          evidenceError: "Malformed evidence file",
        });
        assert.notStrictEqual(errored, reviewed);
        assert.strictEqual(errored.evidenceError, "Malformed evidence file");
        assert.strictEqual(
          reconcileSnapshot(errored, structuredClone(errored)),
          errored,
        );
      }),
  );
  it.effect(
    "protects a newer evidence edit and keeps project-specific metadata",
    () =>
      Effect.gen(function* () {
        const initial = JSON.stringify({
          ...emptyEvidence,
          projectNotes: "Preserve this",
        });
        const disk = yield* Ref.make<string | null>(initial);
        const store = yield* makeEvidence({
          read: Ref.get(disk),
          captures: Effect.succeed([capture]),
          frames: Effect.succeed([frame.id]),
          commit: (expected, next) =>
            Ref.modify(disk, (current) =>
              current === expected ? [true, next] : [false, current],
            ),
        });
        const newer = JSON.stringify({
          ...emptyEvidence,
          projectNotes: "Edited by the user",
        });
        yield* Ref.set(disk, newer);
        const stale = yield* store
          .write({
            evidence: { ...emptyEvidence, reviews: [review] },
            expectedRevision: evidenceRevision(initial),
          })
          .pipe(Effect.result);
        assert.strictEqual(stale._tag, "Failure");
        assert.strictEqual(yield* Ref.get(disk), newer);
        const next = yield* readEvidence(newer);
        yield* store.write({
          evidence: { ...next, reviews: [review] },
          expectedRevision: evidenceRevision(newer),
        });
        const saved = yield* readEvidence(yield* Ref.get(disk));
        assert.strictEqual(saved.projectNotes, "Edited by the user");
        assert.deepStrictEqual(saved.reviews, [review]);
      }),
  );

  it.effect(
    "round-trips legacy reference metadata without requiring it for new records",
    () =>
      Effect.gen(function* () {
        const direction = {
          frame: frame.id,
          composition: "A split hero",
          why: "Product clarity",
          alternatives: [],
        };
        const legacy = {
          ...emptyEvidence,
          references: [
            {
              id: "saved-image",
              name: "Saved image",
              url: "https://example.com/image",
              previewFrame: "01-moodboard/saved.png",
              registryItem: "legacy-item",
              borrow: "Product scale",
            },
          ],
          direction: { ...direction, referenceIds: ["saved-image"] },
          projectNotes: "Keep user notes",
        };
        const disk = yield* Ref.make<string | null>(JSON.stringify(legacy));
        const store = yield* makeEvidence({
          read: Ref.get(disk),
          captures: Effect.succeed([]),
          frames: Effect.succeed([frame.id]),
          commit: (expected, next) =>
            Ref.modify(disk, (current) =>
              current === expected ? [true, next] : [false, current],
            ),
        });
        const loaded = yield* readEvidence(yield* Ref.get(disk));
        assert.deepStrictEqual(loaded, legacy);
        const current = yield* Ref.get(disk);
        yield* store.write({
          evidence: loaded,
          expectedRevision: evidenceRevision(current),
        });
        assert.deepStrictEqual(
          yield* readEvidence(yield* Ref.get(disk)),
          legacy,
        );
        const fresh = yield* readEvidence(
          JSON.stringify({ ...emptyEvidence, direction }),
        );
        assert.deepStrictEqual(fresh, { ...emptyEvidence, direction });
        assert.strictEqual(
          evidenceContextRevision(loaded),
          evidenceContextRevision(fresh),
        );
        assert.strictEqual(
          evidenceContextRevision({ ...loaded, references: [] }),
          evidenceContextRevision(fresh),
        );
      }),
  );

  it.effect(
    "refuses fabricated capture evidence and nonexistent selected compositions",
    () =>
      Effect.gen(function* () {
        const disk = yield* Ref.make<string | null>(null);
        const store = yield* makeEvidence({
          read: Ref.get(disk),
          captures: Effect.succeed([capture]),
          frames: Effect.succeed([frame.id]),
          commit: (_expected, next) =>
            Ref.set(disk, next).pipe(Effect.as(true)),
        });
        for (const evidence of [
          { ...emptyEvidence, reviews: [{ ...review, captureId: "imagined" }] },
          {
            ...emptyEvidence,
            reviews: [{ ...review, frame: "01-test/other" }],
          },
          {
            ...emptyEvidence,
            direction: {
              frame: "unbuilt",
              composition: "A split hero",
              why: "Product clarity",
              alternatives: [],
            },
          },
        ]) {
          assert.strictEqual(
            (yield* store
              .write({ evidence, expectedRevision: null })
              .pipe(Effect.result))._tag,
            "Failure",
          );
          assert.strictEqual(yield* Ref.get(disk), null);
        }
      }),
  );

  it.effect(
    "does not replace malformed evidence or overwrite an intervening editor",
    () =>
      Effect.gen(function* () {
        const disk = yield* Ref.make<string | null>("{broken");
        const store = yield* makeEvidence({
          read: Ref.get(disk),
          captures: Effect.succeed([]),
          frames: Effect.succeed([frame.id]),
          commit: () =>
            Ref.set(disk, "newer external text").pipe(Effect.as(false)),
        });
        assert.strictEqual(
          (yield* store
            .write({
              evidence: emptyEvidence,
              expectedRevision: evidenceRevision("{broken"),
            })
            .pipe(Effect.result))._tag,
          "Failure",
        );
        assert.strictEqual(yield* Ref.get(disk), "{broken");
        const valid = JSON.stringify(emptyEvidence);
        yield* Ref.set(disk, valid);
        assert.strictEqual(
          (yield* store
            .write({
              evidence: emptyEvidence,
              expectedRevision: evidenceRevision(valid),
            })
            .pipe(Effect.result))._tag,
          "Failure",
        );
        assert.strictEqual(yield* Ref.get(disk), "newer external text");
      }),
  );

  it.effect(
    "expires reviews when the design or decision changes, while review logging keeps them current",
    () =>
      Effect.gen(function* () {
        const withReview: EvidenceFile = {
          ...emptyEvidence,
          reviews: [review],
        };
        assert.strictEqual(
          evidenceContextRevision(withReview),
          capture.contextRevision,
        );
        assert.strictEqual(
          reviewStatus(review, [capture], [frame], capture.contextRevision)
            .status,
          "current",
        );
        assert.strictEqual(
          reviewStatus(
            review,
            [capture],
            [{ ...frame, revision: "design-2" }],
            capture.contextRevision,
          ).status,
          "outdated",
        );
        const changedBrief: EvidenceFile = {
          ...withReview,
          brief: {
            audience: "Finance operators",
            difference: "Approval context",
            conversion: "Book a demo",
            facts: [],
            assumptions: [],
          },
        };
        assert.strictEqual(
          reviewStatus(
            review,
            [capture],
            [frame],
            evidenceContextRevision(changedBrief),
          ).status,
          "outdated",
        );
        assert.strictEqual(
          reviewStatus(review, [], [frame], capture.contextRevision).status,
          "unavailable",
        );
        assert.strictEqual(
          reviewStatus(
            review,
            [{ ...capture, frame: "other" }],
            [frame],
            capture.contextRevision,
          ).status,
          "unavailable",
        );
      }),
  );
});
