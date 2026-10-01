import * as Schema from "effect/Schema";
export const LayerSelection = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
});
export const Box = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});
export const LayerWarning = Schema.Struct({
  path: Schema.String,
  message: Schema.String,
});
export type LayerNode = {
  name: string;
  path: string;
  box: typeof Box.Type;
  source?: string;
  styles: Record<string, string>;
  children: LayerNode[];
  spacing: number[];
};
export const LayerNode: Schema.Codec<LayerNode> = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  box: Box,
  source: Schema.optional(Schema.String),
  styles: Schema.Record(Schema.String, Schema.String),
  children: Schema.mutable(Schema.Array(Schema.suspend(() => LayerNode))),
  spacing: Schema.mutable(Schema.Array(Schema.Finite)),
});
export const LayerCheck = Schema.Struct({
  severity: Schema.Literals(["warning", "error"]),
  path: Schema.String,
  message: Schema.String,
});
export const LayerReport = Schema.Struct({
  tree: Schema.Array(LayerNode),
  warnings: Schema.Array(LayerWarning),
  checks: Schema.Array(LayerCheck),
  width: Schema.Finite,
});
export type LayerReport = typeof LayerReport.Type;
export const InspectRequest = Schema.Struct({
  frame: Schema.String,
  layer: Schema.optional(Schema.String),
  width: Schema.optional(Schema.Finite),
});
export const InspectResponse = Schema.Struct({
  report: Schema.optional(LayerReport),
  error: Schema.optional(Schema.String),
});
export const RenameRequest = Schema.Struct({
  source: Schema.String,
  name: Schema.String,
});
export const RenameResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
