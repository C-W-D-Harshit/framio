import * as Schema from "effect/Schema";
const Scalar = Schema.Union([Schema.String, Schema.Number]);
const TokenName = Schema.String.pipe(Schema.check(Schema.isPattern(/[a-z0-9]/i)));
const TokenValue = Schema.NonEmptyString.pipe(Schema.check(Schema.isPattern(/\S/)));
export const Typography = Schema.StructWithRest(Schema.Struct({
  fontFamily: Schema.optional(Schema.String),
}), [Schema.Record(Schema.String, Scalar)]);
export const DesignTokens = Schema.Struct({
  colors: Schema.optional(Schema.Record(TokenName, TokenValue)),
  rounded: Schema.optional(Schema.Record(TokenName, TokenValue)),
  typography: Schema.optional(Schema.Record(TokenName, Typography)),
});
