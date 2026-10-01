import { LayerWarning } from "./layers";
import * as Schema from "effect/Schema";

export const FrameStatus = Schema.Struct({
  id: Schema.String,
  warnings: Schema.optional(Schema.Array(LayerWarning)),
  error: Schema.NullOr(Schema.String),
  version: Schema.optional(Schema.Finite),
});
