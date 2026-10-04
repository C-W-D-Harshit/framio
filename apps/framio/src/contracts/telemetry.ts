import * as Schema from "effect/Schema";

/** Injected into the studio page by the server. Absent when telemetry is off. */
export const StudioTelemetry = Schema.Struct({
  key: Schema.NonEmptyString,
  host: Schema.NonEmptyString,
  distinctId: Schema.NonEmptyString,
  version: Schema.String,
  os: Schema.optionalKey(Schema.String),
  arch: Schema.optionalKey(Schema.String),
  compiled: Schema.optionalKey(Schema.Boolean),
});
export type StudioTelemetry = typeof StudioTelemetry.Type;
