import * as Schema from "effect/Schema";

export const DesignReference = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  provider: Schema.Literals(["Tailark", "StyleUI"]),
  kind: Schema.Literals(["page", "hero"]),
  description: Schema.NonEmptyString,
  sourceUrl: Schema.NonEmptyString,
  previewUrl: Schema.NonEmptyString,
  registryItem: Schema.NonEmptyString,
  registryUrl: Schema.NonEmptyString,
  tags: Schema.Array(Schema.NonEmptyString),
  borrow: Schema.NonEmptyString,
  avoid: Schema.NonEmptyString,
  registryStatus: Schema.Literals(["verified", "unavailable"]),
  registryCheckedAt: Schema.NonEmptyString,
  previewCheckedAt: Schema.NonEmptyString,
});
export type DesignReference = typeof DesignReference.Type;

export const ReferenceCapture = Schema.Struct({
  reference: DesignReference,
  frame: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
  sidecarPath: Schema.NonEmptyString,
  captureId: Schema.optional(Schema.NonEmptyString),
  width: Schema.Finite,
  height: Schema.Finite,
});
export type ReferenceCapture = typeof ReferenceCapture.Type;
