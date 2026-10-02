import * as Schema from "effect/Schema";

export const RegistryObservation = Schema.Struct({
  completed: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      before: Schema.NullOr(Schema.String),
      after: Schema.NullOr(Schema.String),
      issue: Schema.NullOr(Schema.String),
      preserve: Schema.Boolean,
    }),
  ),
});

export type RegistryFileReceipt = {
  path: string;
  status: "installed" | "skipped" | "failed";
  reason: string;
};

export function registryReceipt(
  observation: typeof RegistryObservation.Type,
  overwrite: boolean,
) {
  const files: RegistryFileReceipt[] = observation.files.map((file) => {
    if (file.issue)
      return { path: file.path, status: "failed", reason: file.issue };
    if (!file.after)
      return {
        path: file.path,
        status: "failed",
        reason: "Expected file was not installed.",
      };
    if (file.before === file.after)
      return {
        path: file.path,
        status: "skipped",
        reason:
          overwrite || !file.preserve
            ? "File is unchanged."
            : "Existing file preserved.",
      };
    if (file.before && !overwrite && file.preserve)
      return {
        path: file.path,
        status: "failed",
        reason:
          "Existing file changed during installation. Verify it before continuing.",
      };
    return {
      path: file.path,
      status: "installed",
      reason: file.before ? "Existing file updated." : "New file created.",
    };
  });
  return {
    files,
    installed: files.filter((file) => file.status === "installed").length,
    skipped: files.filter((file) => file.status === "skipped").length,
    failed: files.filter((file) => file.status === "failed").length,
    complete:
      observation.completed &&
      !observation.error &&
      files.every((file) => file.status !== "failed"),
    error: observation.error,
  };
}
