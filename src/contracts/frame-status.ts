import * as Schema from "effect/Schema";

export const FrameStatus = Schema.Struct({
  id: Schema.String,
  error: Schema.NullOr(Schema.String),
  version: Schema.optional(Schema.Finite),
});
