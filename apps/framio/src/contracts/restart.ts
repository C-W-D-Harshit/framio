import * as Schema from "effect/Schema";
export const RestartJournal = Schema.Struct({
  phase: Schema.Literals([
    "requested",
    "starting",
    "ready",
    "failed",
    "recovered",
  ]),
  port: Schema.Int,
  version: Schema.String,
  error: Schema.NullOr(Schema.String),
});
export type RestartJournal = typeof RestartJournal.Type;
