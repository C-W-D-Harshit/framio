import { LayerSelection, LayerReport } from "./layers";
import * as Schema from "effect/Schema";
import { PositiveNumber } from "../domain/project";
import { ElementInfo } from "./requests";
import { EditOperation, SourceRef, SourceSelection } from "./edits";
const base = { source: Schema.Literal("framio"), frame: Schema.String };
export const FrameMessage = Schema.Union([
  Schema.Struct({
    ...base,
    type: Schema.Literal("layers"),
    report: LayerReport,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literals(["ready", "size"]),
    height: PositiveNumber,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("error"),
    error: Schema.String,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("select"),
    element: Schema.NullOr(ElementInfo),
    layer: Schema.optional(LayerSelection),
    sourceSelection: Schema.optional(SourceSelection),
    x: Schema.optional(Schema.Finite),
    y: Schema.optional(Schema.Finite),
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("edit"),
    id: Schema.String,
    edit: EditOperation,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("text-editing"),
    active: Schema.Boolean,
  }),
  Schema.Struct({ ...base, type: Schema.Literals(["dblclick", "pan-end"]) }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("contextmenu"),
    clientX: Schema.Finite,
    clientY: Schema.Finite,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literals(["pan-start", "pan-move"]),
    screenX: Schema.Finite,
    screenY: Schema.Finite,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("key"),
    phase: Schema.Literals(["keydown", "keyup"]),
    key: Schema.String,
    code: Schema.String,
    repeat: Schema.Boolean,
    shiftKey: Schema.Boolean,
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    altKey: Schema.Boolean,
  }),
]);
export const CanvasMessage = Schema.Union([
  Schema.Struct({
    source: Schema.Literal("framio-canvas"),
    type: Schema.Literal("select-source"),
    ref: SourceRef,
    index: Schema.Int,
  }),
  Schema.Struct({
    source: Schema.Literal("framio-canvas"),
    type: Schema.Literal("command"),
    command: Schema.Literals(["remove", "duplicate", "edit-text"]),
  }),
  Schema.Struct({
    source: Schema.Literal("framio-canvas"),
    type: Schema.Literal("edit-result"),
    id: Schema.String,
    ok: Schema.Boolean,
  }),
  Schema.Struct({
    source: Schema.Literal("framio-canvas"),
    type: Schema.Literal("layer-select"),
    path: Schema.String,
  }),
  Schema.Struct({
    source: Schema.Literal("framio-canvas"),
    type: Schema.Literal("layer-hover"),
    path: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    source: Schema.Literal("framio-canvas"),
    type: Schema.Literal("clear-selection"),
  }),
  Schema.Struct({
    source: Schema.Literal("framio-canvas"),
    type: Schema.Literal("css"),
    version: Schema.Finite,
  }),
]);
export const Viewport = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  zoom: PositiveNumber,
});
