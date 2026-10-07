import * as Schema from "effect/Schema";

// DOM attributes stamped on every JSX element at build time.
export const SOURCE_ATTRIBUTE = "data-framio-src"; // SourceRef.
export const EDIT_ATTRIBUTE = "data-framio-edit"; // Comma-separated capabilities.
export const LOCK_ATTRIBUTE = "data-framio-lock"; // Semicolon-separated capability:reason pairs.

type SourceLocation = {
  file: string;
  start: number;
  end: number;
  rev: string;
};

/** File relative to .framio, original UTF-16 JSX span, and SHA-256 prefix. */
export const formatSourceRef = ({
  file,
  start,
  end,
  rev,
}: SourceLocation): string =>
  `${file.replace(/\\/g, "/")}:${start}:${end}:${rev.slice(0, 12)}`;

export const parseSourceRef = (ref: string): SourceLocation | null => {
  // The greedy file match parses the three trailing fields from the right.
  const match = /^(.+):(\d+):(\d+):([a-fA-F0-9]{12})$/.exec(ref);
  if (!match || match[0] !== ref) return null;
  const [, file, startText, endText, rev] = match;
  const start = Number(startText);
  const end = Number(endText);
  if (
    !file ||
    file.startsWith("/") ||
    file.includes("\\") ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end < start
  )
    return null;
  return { file, start, end, rev: rev! };
};

export const SourceRef = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((ref) => parseSourceRef(ref) !== null, {
      message:
        "Expected a source file, JSX span, and 12-character SHA-256 prefix",
    }),
  ),
);
export type SourceRef = typeof SourceRef.Type;

export const EditCapability = Schema.Literals([
  "text",
  "size",
  "move",
  "remove",
  "duplicate",
]);
export type EditCapability = typeof EditCapability.Type;
export const LockReason = Schema.Literals([
  "dynamic-text",
  "mixed-content",
  "dynamic-class",
  "class-override",
  "dynamic-siblings",
  "no-jsx-parent",
  "shared-component",
]);
export type LockReason = typeof LockReason.Type;
export const ElementLock = Schema.Struct({
  capability: EditCapability,
  reason: LockReason,
});
export type ElementLock = typeof ElementLock.Type;

export const lockMessages: Record<LockReason, string> = {
  "dynamic-text": "Text comes from code. Ask the agent to change it.",
  "mixed-content":
    "This element mixes text with other elements. Select the text itself.",
  "dynamic-class":
    "Classes are computed in code, so size can't be edited here.",
  "class-override":
    "Props spread after className can override it, so size can't be edited here.",
  "dynamic-siblings":
    "Siblings come from code, like a list or a condition, so order can't be changed here.",
  "no-jsx-parent":
    "This is the root of a component, so it can't be moved or removed here.",
  "shared-component":
    "This is part of a shared component. Editing it would change every use.",
};

const isCapability = Schema.is(EditCapability);
const isLock = Schema.is(ElementLock);

export const encodeCapabilities = (list: readonly EditCapability[]): string =>
  list.join(",");
export const decodeCapabilities = (attr: string | null): EditCapability[] =>
  (attr ?? "").split(",").filter(isCapability);

export const encodeLocks = (list: readonly ElementLock[]): string =>
  list.map(({ capability, reason }) => `${capability}:${reason}`).join(";");
export const decodeLocks = (attr: string | null): ElementLock[] =>
  (attr ?? "").split(";").flatMap((token) => {
    const parts = token.split(":");
    const lock = { capability: parts[0], reason: parts[1] };
    return parts.length === 2 && isLock(lock) ? [lock] : [];
  });

export const SourceSelection = Schema.Struct({
  ref: SourceRef,
  // Document-order index among elements carrying this ref in the frame.
  index: Schema.Int,
  // Total instances, including elements rendered by .map().
  count: Schema.Int,
  allowed: Schema.Array(EditCapability),
  locks: Schema.Array(ElementLock),
});
export type SourceSelection = typeof SourceSelection.Type;

export const EditOperation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    ref: SourceRef,
    text: Schema.String.pipe(
      Schema.check(
        Schema.makeFilter((text) => !/[\r\n]/.test(text), {
          message: "Text edits must not contain newlines",
        }),
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("size"),
    ref: SourceRef,
    // CSS pixels. Null keeps the current dimension.
    width: Schema.NullOr(Schema.Finite),
    height: Schema.NullOr(Schema.Finite),
  }),
  Schema.Struct({
    type: Schema.Literal("move"),
    ref: SourceRef,
    // A sibling under the same JSX parent.
    anchor: SourceRef,
    position: Schema.Literals(["before", "after"]),
  }),
  Schema.Struct({ type: Schema.Literal("remove"), ref: SourceRef }),
  Schema.Struct({ type: Schema.Literal("duplicate"), ref: SourceRef }),
]);
export type EditOperation = typeof EditOperation.Type;

/** Replaces [start, end) in a file relative to .framio at its full SHA-256 revision. */
export const SourcePatch = Schema.Struct({
  file: Schema.String,
  revision: Schema.String,
  start: Schema.Int,
  end: Schema.Int,
  text: Schema.String,
});
export type SourcePatch = typeof SourcePatch.Type;
export const EditFailure = Schema.Literals([
  "conflict",
  "locked",
  "invalid",
  "not-found",
]);
export type EditFailure = typeof EditFailure.Type;

export const EditResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    // Ref after writing the edited, moved, or duplicated element. Null for remove.
    ref: Schema.NullOr(SourceRef),
    undo: SourcePatch,
    label: Schema.String,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: EditFailure,
    message: Schema.String,
  }),
]);
export type EditResponse = typeof EditResponse.Type;
export const PatchResponse = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), inverse: SourcePatch }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: EditFailure,
    message: Schema.String,
  }),
]);
export type PatchResponse = typeof PatchResponse.Type;
