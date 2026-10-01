import * as Schema from "effect/Schema";
import { FrameMeta, Positions } from "../domain/project";

export const SnapshotFrame = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["tsx", "image"]),
  page: Schema.String,
  slug: Schema.String,
  relFile: Schema.String,
  meta: FrameMeta,
  parent: Schema.NullOr(Schema.String),
  note: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  version: Schema.Finite,
  error: Schema.NullOr(Schema.String),
});
export type SnapshotFrame = typeof SnapshotFrame.Type;
export const Snapshot = Schema.Struct({
  projectName: Schema.String,
  cssVersion: Schema.Finite,
  cssError: Schema.NullOr(Schema.String),
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
