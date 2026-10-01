import * as Schema from "effect/Schema";

export const FrameStatus = Schema.Struct({
  id: Schema.String,
  error: Schema.NullOr(Schema.String),
  width: Schema.optional(Schema.Finite),
  version: Schema.optional(Schema.Finite),
});
