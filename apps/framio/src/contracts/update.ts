import * as Schema from "effect/Schema";
export const Version = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(128)),
  Schema.check(
    Schema.isPattern(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/,
    ),
  ),
);
export const Release = Schema.Struct({
  version: Version,
  tag: Schema.String,
  description: Schema.String,
  notesUrl: Schema.String,
  assetId: Schema.Int,
  assetName: Schema.String,
  assetUrl: Schema.String,
  assetSize: Schema.Int,
  checksumUrl: Schema.String,
  requiresProjectUpdate: Schema.Boolean,
});
export type Release = typeof Release.Type;
export const UpdatePhase = Schema.Literals([
  "idle",
  "available",
  "downloading",
  "download-failed",
  "ready",
  "installing",
  "install-failed",
]);
export const UpdateRecord = Schema.Struct({
  phase: UpdatePhase,
  release: Schema.NullOr(Release),
  bytes: Schema.Int,
  total: Schema.NullOr(Schema.Int),
  error: Schema.NullOr(Schema.String),
  stagedHash: Schema.NullOr(Schema.String),
  previousVersion: Schema.NullOr(Schema.String),
  operation: Schema.NullOr(Schema.String),
});
export type UpdateRecord = typeof UpdateRecord.Type;
export const UpdateStatus = Schema.Struct({
  ...UpdateRecord.fields,
  runningVersion: Schema.String,
  installedVersion: Schema.NullOr(Schema.String),
  canInstall: Schema.Boolean,
  installationNotice: Schema.NullOr(Schema.String),
  restartNeeded: Schema.Boolean,
  restartPhase: Schema.Literals(["idle", "restarting", "failed", "recovered"]),
  restartError: Schema.NullOr(Schema.String),
});
export type UpdateStatus = typeof UpdateStatus.Type;
export const UpdateAction = Schema.Struct({
  action: Schema.Literals([
    "check",
    "download",
    "install",
    "rollback",
    "restart",
  ]),
});
export const UpdateResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export class UpdateFailure extends Schema.TaggedError<UpdateFailure>()(
  "UpdateFailure",
  { message: Schema.String },
) {}
export const emptyUpdate: UpdateRecord = {
  phase: "idle",
  release: null,
  bytes: 0,
  total: null,
  error: null,
  stagedHash: null,
  previousVersion: null,
  operation: null,
};
