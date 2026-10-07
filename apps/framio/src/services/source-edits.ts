import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseSourceRef,
  type EditOperation,
  type EditResponse,
  type SourcePatch,
  type PatchResponse,
  type EditFailure,
} from "../contracts/edits";
import {
  applySourcePatch,
  transformSource,
  editConflict,
  patchConflict,
} from "../server/source-edits";
import { publishIfUnchanged } from "../platform/atomic-file";
import { isSourceSymlink } from "../platform/source-file";
import {
  isWithinSourceDirectory,
  sourcePathSegments,
  type SourcePaths,
} from "../lib/source-paths";

class SourceEditFailed extends Schema.TaggedError<SourceEditFailed>()(
  "SourceEditFailed",
  {
    reason: Schema.Literals(["conflict", "locked", "invalid", "not-found"]),
    message: Schema.String,
  },
) {}
const failed = (reason: EditFailure, message: string) =>
  new SourceEditFailed({ reason, message });
export class SourceEdits extends Context.Service<
  SourceEdits,
  {
    edit: (op: EditOperation) => Effect.Effect<EditResponse>;
    patch: (patch: SourcePatch) => Effect.Effect<PatchResponse>;
  }
>()("framio/services/SourceEdits") {
  static readonly layer = (framio: string) =>
    Layer.effect(SourceEdits, makeSourceEdits(framio));
}
export const makeSourceEdits = Effect.fn("SourceEdits.make")(function* (
  framio: string,
  paths: SourcePaths = path,
) {
  const fs = yield* FileSystem.FileSystem;
  const locks = new Map<
    string,
    { semaphore: Semaphore.Semaphore; users: number }
  >();
  const safeFile = Effect.fn("SourceEdits.safeFile")(function* (file: string) {
    if (!sourcePathSegments(framio, file, paths))
      return yield* failed(
        "invalid",
        "Source edits must be inside .framio/pages and use .tsx or .jsx files.",
      );
    const notFound = () =>
      failed("not-found", "The source file could not be found.");
    const canonicalRoot = yield* fs
      .realPath(framio)
      .pipe(Effect.mapError(notFound));
    const segments = sourcePathSegments(canonicalRoot, file, paths)!;
    // Inspect every segment, including pages, without following links or junctions.
    for (const segment of segments) {
      if (yield* isSourceSymlink(segment).pipe(Effect.mapError(notFound)))
        return yield* failed("invalid", "Refusing to edit a symlinked source.");
    }
    const pages = yield* fs
      .realPath(segments[0]!)
      .pipe(Effect.mapError(notFound));
    const canonical = yield* fs
      .realPath(segments.at(-1)!)
      .pipe(Effect.mapError(notFound));
    if (
      !isWithinSourceDirectory(canonicalRoot, pages, paths) ||
      !isWithinSourceDirectory(pages, canonical, paths)
    )
      return yield* failed(
        "invalid",
        "Refusing to edit a source outside .framio/pages.",
      );
    return canonical;
  });
  const serialized = <A, E, R>(file: string, effect: Effect.Effect<A, E, R>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const entry = yield* Effect.sync(() => {
          let entry = locks.get(file);
          if (!entry) {
            entry = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
            locks.set(file, entry);
          }
          entry.users++;
          return entry;
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (--entry.users === 0) locks.delete(file);
          }),
        );
        return yield* entry.semaphore.withPermit(effect);
      }),
    );
  const write = Effect.fn("SourceEdits.write")(function* (
    source: string,
    file: string,
    text: string,
    next: string,
    conflict: string,
  ) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          fs
            .remove(temporary, { force: true })
            .pipe(Effect.catch(() => Effect.void)),
        );
        yield* fs.writeFileString(temporary, next);
        // Repeat containment and link checks after preparing the temporary file.
        if (paths.relative(file, yield* safeFile(source)) !== "")
          return yield* failed(
            "invalid",
            "Refusing to edit a symlinked source.",
          );
        if (!(yield* publishIfUnchanged(file, temporary, text)))
          return yield* failed("conflict", conflict);
      }),
    );
  });
  const recover = (error: { message: string; readonly _tag: string }) =>
    Effect.succeed({
      ok: false as const,
      reason:
        error._tag === "SourceEditFailed"
          ? (error as SourceEditFailed).reason
          : ("invalid" as const),
      message: error.message,
    });
  const edit = Effect.fn("SourceEdits.edit")(function* (
    op: EditOperation,
  ): Effect.fn.Return<EditResponse> {
    const location = parseSourceRef(op.ref);
    if (!location)
      return {
        ok: false,
        reason: "invalid",
        message: "Invalid source location.",
      };
    return yield* serialized(
      location.file,
      Effect.gen(function* () {
        const file = yield* safeFile(location.file);
        const text = yield* fs.readFileString(file);
        const result = transformSource(text, location.file, op);
        if (!result.ok) return result;
        yield* write(location.file, file, text, result.next, editConflict);
        return {
          ok: true as const,
          ref: result.ref,
          undo: result.undo,
          label: result.label,
        };
      }),
    ).pipe(Effect.catch(recover));
  });
  const patch = Effect.fn("SourceEdits.patch")(function* (
    patch: SourcePatch,
  ): Effect.fn.Return<PatchResponse> {
    return yield* serialized(
      patch.file,
      Effect.gen(function* () {
        const file = yield* safeFile(patch.file);
        const text = yield* fs.readFileString(file);
        const result = applySourcePatch(text, patch);
        if (!result.ok) return result;
        yield* write(patch.file, file, text, result.next, patchConflict);
        return { ok: true as const, inverse: result.inverse };
      }),
    ).pipe(Effect.catch(recover));
  });
  return SourceEdits.of({ edit, patch });
});
