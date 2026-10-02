import { LayerSelection, LayerReport } from "./layers";
import * as Schema from "effect/Schema";
import {
  PositiveNumber,
  Positions,
  ViewportDimension,
} from "../domain/project";

export const ElementInfo = Schema.Struct({
  tag: Schema.String,
  text: Schema.String,
  selector: Schema.String,
  className: Schema.optional(Schema.String),
  dataSlot: Schema.optional(Schema.String),
  html: Schema.optional(Schema.String),
  rect: Schema.optional(
    Schema.Struct({
      x: Schema.Finite,
      y: Schema.Finite,
      width: Schema.Finite,
      height: Schema.Finite,
    }),
  ),
});
export const SelectionRequest = Schema.Struct({
  frames: Schema.Array(Schema.String),
  layer: Schema.optional(LayerSelection),
  element: Schema.NullOr(ElementInfo),
  width: Schema.optional(ViewportDimension),
});
export const CanvasRequest = Schema.Struct({
  page: Schema.String,
  positions: Positions,
});
export const ScreenshotRequest = Schema.Struct({
  frames: Schema.optional(Schema.Array(Schema.String)),
  page: Schema.optional(Schema.String),
  scale: Schema.optional(PositiveNumber),
  layers: Schema.optional(Schema.Array(Schema.String)),
  width: Schema.optional(ViewportDimension),
  height: Schema.optional(ViewportDimension),
  url: Schema.optional(Schema.String),
  viewportOnly: Schema.optional(Schema.Boolean),
  compare: Schema.optional(Schema.String),
  into: Schema.optional(Schema.String),
});
export const ScreenshotResult = Schema.Struct({
  frame: Schema.String,
  generation: Schema.optional(Schema.Int),
  revision: Schema.optional(Schema.String),
  contextRevision: Schema.optional(Schema.String),
  captureId: Schema.optional(Schema.String),
  archivePath: Schema.optional(Schema.String),
  viewportWidth: Schema.optional(ViewportDimension),
  report: Schema.optional(LayerReport),
  crops: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        layer: Schema.String,
        width: Schema.Finite,
        height: Schema.Finite,
        scale: Schema.Finite,
        captureId: Schema.optional(Schema.String),
        archivePath: Schema.optional(Schema.String),
        viewportWidth: Schema.optional(ViewportDimension),
      }),
    ),
  ),
  file: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  width: Schema.optional(PositiveNumber),
  height: Schema.optional(PositiveNumber),
  error: Schema.optional(Schema.NullOr(Schema.String)),
});
export const ScreenshotResponse = Schema.Struct({
  results: Schema.Array(ScreenshotResult),
});
