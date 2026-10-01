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
  width: Schema.optional(ViewportDimension),
  height: Schema.optional(ViewportDimension),
  url: Schema.optional(Schema.String),
  compare: Schema.optional(Schema.String),
  into: Schema.optional(Schema.String),
});
export const ScreenshotResult = Schema.Struct({
  frame: Schema.String,
  file: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  width: Schema.optional(PositiveNumber),
  height: Schema.optional(PositiveNumber),
  error: Schema.optional(Schema.NullOr(Schema.String)),
});
export const ScreenshotResponse = Schema.Struct({
  results: Schema.Array(ScreenshotResult),
});
