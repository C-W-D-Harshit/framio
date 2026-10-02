import { Comment } from "./comments";
import * as Schema from "effect/Schema";
import { FrameMeta, Positions } from "../domain/project";
import { CaptureEvidence, EvidenceFile } from "./evidence";

export const SnapshotFrame = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["tsx", "image"]),
  page: Schema.String,
  slug: Schema.String,
  relFile: Schema.String,
  meta: FrameMeta,
  parent: Schema.NullOr(Schema.String),
  frameId: Schema.optional(Schema.String),
  viewportErrors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  note: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  version: Schema.Finite,
  geometryVersion: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type SnapshotFrame = typeof SnapshotFrame.Type;
export const Snapshot = Schema.Struct({
  projectName: Schema.String,
  cssVersion: Schema.Finite,
  cssError: Schema.NullOr(Schema.String),
  comments: Schema.optional(Schema.Array(Comment)),
  commentsError: Schema.optional(Schema.NullOr(Schema.String)),
  evidence: Schema.optional(EvidenceFile),
  evidenceRevision: Schema.optional(Schema.NullOr(Schema.String)),
  evidenceContextRevision: Schema.optional(Schema.String),
  evidenceError: Schema.optional(Schema.NullOr(Schema.String)),
  captures: Schema.optional(Schema.Array(CaptureEvidence)),
  pages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      frames: Schema.Array(SnapshotFrame),
      positions: Positions,
    }),
  ),
});
export type Snapshot = typeof Snapshot.Type;
export const SnapshotMessage = Schema.Struct({
  type: Schema.Literal("snapshot"),
  snapshot: Snapshot,
});
