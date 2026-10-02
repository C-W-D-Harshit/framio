import * as Schema from "effect/Schema";
import { ViewportDimension } from "../domain/project";

const Text = Schema.String.pipe(Schema.check(Schema.isPattern(/\S/)));
const Timestamp = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/),
    Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), {
      message: "Expected an ISO timestamp in UTC",
    }),
  ),
);
const uniqueIds = <T extends { readonly id: string }>(values: readonly T[]) =>
  new Set(values.map((value) => value.id)).size === values.length;
export const DesignBrief = Schema.Struct({
  audience: Text,
  difference: Text,
  conversion: Text,
  facts: Schema.Array(Schema.Struct({ text: Text, source: Text })),
  assumptions: Schema.Array(Text),
  constraints: Schema.optional(Schema.Array(Text)),
});
export const DesignReference = Schema.Struct({
  id: Text,
  name: Text,
  url: Schema.String.pipe(Schema.check(Schema.isPattern(/^https?:\/\//))),
  previewFrame: Schema.optional(Text),
  registryItem: Schema.optional(Text),
  borrow: Text,
  avoid: Schema.optional(Text),
});
export const DesignDirection = Schema.Struct({
  frame: Text,
  referenceIds: Schema.Array(Text),
  composition: Text,
  why: Text,
  alternatives: Schema.Array(Schema.Struct({ frame: Text, reason: Text })),
});
export const DesignReview = Schema.Struct({
  id: Text,
  frame: Text,
  captureId: Text,
  kind: Schema.Literals(["technical", "composition"]),
  verdict: Schema.Literals(["pass", "revise"]),
  findings: Schema.Array(Text),
  changes: Schema.Array(Text),
  createdAt: Timestamp,
});
export type DesignReview = typeof DesignReview.Type;
export const EvidenceFile = Schema.StructWithRest(
  Schema.Struct({
    version: Schema.Literal(1),
    brief: Schema.optional(DesignBrief),
    references: Schema.Array(DesignReference).pipe(
      Schema.check(
        Schema.makeFilter(uniqueIds, {
          message: "Reference IDs must be unique",
        }),
      ),
    ),
    direction: Schema.optional(DesignDirection),
    reviews: Schema.Array(DesignReview).pipe(
      Schema.check(
        Schema.makeFilter(uniqueIds, { message: "Review IDs must be unique" }),
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type EvidenceFile = typeof EvidenceFile.Type;
export const emptyEvidence: EvidenceFile = {
  version: 1,
  references: [],
  reviews: [],
};
export const CaptureEvidence = Schema.Struct({
  id: Text,
  frame: Text,
  path: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^history\/[a-z0-9-]+\.png$/)),
  ),
  revision: Schema.optional(Text),
  contextRevision: Text,
  generation: Schema.optional(Schema.Int),
  viewportWidth: ViewportDimension,
  width: ViewportDimension,
  height: ViewportDimension,
  layer: Schema.optional(Text),
  capturedAt: Timestamp,
});
export type CaptureEvidence = typeof CaptureEvidence.Type;
export const CapturesFile = Schema.Array(CaptureEvidence);
export const EvidenceUpdate = Schema.Struct({
  evidence: EvidenceFile,
  expectedRevision: Schema.NullOr(Schema.String),
});
export const EvidenceResponse = Schema.Struct({
  evidence: EvidenceFile,
  revision: Schema.NullOr(Schema.String),
  contextRevision: Schema.String,
  captures: Schema.Array(CaptureEvidence),
  error: Schema.NullOr(Schema.String),
});
export const EvidenceWriteResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
