import { LayerSelection, LayerReport } from "./layers";
import * as Schema from "effect/Schema";
import { PositiveNumber, Positions } from "../domain/project";

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
});
export const ScreenshotResult = Schema.Struct({
  frame: Schema.String,
  report: Schema.optional(LayerReport),
  crops: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        layer: Schema.String,
        width: Schema.Finite,
        height: Schema.Finite,
        scale: Schema.Finite,
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
