import { publishIfUnchanged } from "../../platform/atomic-file";
import ts from "typescript";
import {
  parseSource,
  openingOf,
  elementCapabilities,
  sourceRevision,
} from "../source-edits";
import {
  SOURCE_ATTRIBUTE,
  EDIT_ATTRIBUTE,
  LOCK_ATTRIBUTE,
  formatSourceRef,
  encodeCapabilities,
  encodeLocks,
} from "../../contracts/edits";
import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Semaphore from "effect/Semaphore";
import { resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { relativeSourceFile } from "../../lib/source-paths";
const Location = Schema.Struct({
  file: Schema.String,
  start: Schema.Int,
  end: Schema.Int,
  revision: Schema.String,
  value: Schema.NullOr(Schema.String),
});
const revision = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export class RenameFailed extends Schema.TaggedError<RenameFailed>()(
  "RenameFailed",
  { message: Schema.String },
) {}
function attributes(text: string, file: string) {
  const ast = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TSX,
  );
  const found: ts.JsxAttribute[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "data-layer")
      found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { ast, found };
}
export function injectLayerSources(text: string, file: string) {
  const { ast, elements, layerAttributes } = parseSource(text, file);
  const revision = sourceRevision(text);
  const edits: { offset: number; text: string }[] = [];
  const relativeFile = relativeSourceFile(file);
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  if (/^(pages|components)\//.test(relativeFile)) {
    for (const node of elements) {
      const { allowed, locks } = elementCapabilities(node, relativeFile);
      const ref = formatSourceRef({
        file: relativeFile,
        start: node.getStart(ast),
        end: node.end,
        rev: revision,
      });
      edits.push({
        offset: openingOf(node).tagName.end,
        text: ` ${SOURCE_ATTRIBUTE}="${escape(ref)}" ${EDIT_ATTRIBUTE}="${encodeCapabilities(allowed)}" ${LOCK_ATTRIBUTE}="${encodeLocks(locks)}"`,
      });
    }
  }
  for (const attr of layerAttributes) {
    const peers = (attr.parent as ts.JsxAttributes).properties;
    if (
      peers.filter(
        (p) => ts.isJsxAttribute(p) && p.name.getText(ast) === "data-layer",
      ).length !== 1 ||
      peers.some(
        (p) =>
          ts.isJsxAttribute(p) &&
          p.name.getText(ast) === "data-framio-layer-source",
      ) ||
      peers.some((p) => ts.isJsxSpreadAttribute(p) && p.pos > attr.pos)
    )
      continue;
    const init = attr.initializer;
    const source = JSON.stringify({
      file,
      start: init?.getStart(ast) ?? attr.end,
      end: init?.end ?? attr.end,
      revision,
      value: init && ts.isStringLiteral(init) ? init.text : null,
    });
    edits.push({
      offset: attr.end,
      text: ` data-framio-layer-source={${JSON.stringify(source)}}`,
    });
  }
  // Descending offsets keep every location tied to the unmodified input.
  const chunks: string[] = [];
  let cursor = text.length;
  for (const edit of edits.sort((a, b) => b.offset - a.offset)) {
    chunks.push(text.slice(edit.offset, cursor), edit.text);
    cursor = edit.offset;
  }
  chunks.push(text.slice(0, cursor));
  return chunks.reverse().join("");
}
export const editLayerSource = Effect.fn("Layers.editSource")(function* (
  text: string,
  source: string,
  name: string,
) {
  const location = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Location),
  )(source).pipe(
    Effect.mapError(
      () =>
        new RenameFailed({
          message: "Layer source location is invalid or ambiguous.",
        }),
    ),
  );
  if (!name.trim() || /[\/\[\]]/.test(name))
    return yield* new RenameFailed({
      message: "Use a non-empty layer name without /, [ or ].",
    });
  if (location.revision !== revision(text))
    return yield* new RenameFailed({
      message: "Source changed. Wait for the frame to rebuild and try again.",
    });
  const matches = attributes(text, location.file).found.filter(
    (attr) =>
      attr.initializer?.getStart() === location.start &&
      attr.initializer.end === location.end,
  );
  if (matches.length !== 1)
    return yield* new RenameFailed({
      message: "Layer source location is ambiguous.",
    });
  const attribute = matches[0]!;
  const peers = (attribute.parent as ts.JsxAttributes).properties;
  if (
    peers.filter(
      (p) => ts.isJsxAttribute(p) && p.name.getText() === "data-layer",
    ).length !== 1 ||
    peers.some((p) => ts.isJsxSpreadAttribute(p) && p.pos > attribute.pos)
  )
    return yield* new RenameFailed({
      message:
        "Layer source is ambiguous because attributes can override its name.",
    });
  const init = attribute.initializer!;
  if (
    !ts.isStringLiteral(init) ||
    location.value === null ||
    init.text !== location.value
  )
    return yield* new RenameFailed({
      message: "Only JSX string literal layer names can be renamed.",
    });
  const literal =
    '"' +
    name
      .trim()
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r/g, "&#13;")
      .replace(/\n/g, "&#10;") +
    '"';
  return text.slice(0, location.start) + literal + text.slice(location.end);
});
export const makeLayerRenamer = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const lock = yield* Semaphore.make(1);
  return Effect.fn("Layers.rename")(function* (
    framio: string,
    source: string,
    name: string,
  ) {
    const location = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Location),
    )(source).pipe(
      Effect.mapError(
        () => new RenameFailed({ message: "Invalid source location." }),
      ),
    );
    const file = resolve(location.file);
    const rel = relative(framio, file);
    if (
      !(rel.startsWith(`pages${sep}`) || rel.startsWith(`components${sep}`)) ||
      !/\.[jt]sx$/.test(file)
    )
      return yield* new RenameFailed({
        message:
          "Layer source must be inside .framio/pages or .framio/components.",
      });
    const canonical = yield* fs.realPath(file);
    if (canonical !== file)
      return yield* new RenameFailed({
        message: "Refusing to rename a symlinked source.",
      });
    const text = yield* fs.readFileString(file);
    const next = yield* editLayerSource(text, source, name);
    const temporary = `${file}.${randomUUID()}.tmp`;
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          fs
            .remove(temporary, { force: true })
            .pipe(Effect.catch(() => Effect.void)),
        );
        yield* fs.writeFileString(temporary, next);
        if (
          !(yield* publishIfUnchanged(file, temporary, text).pipe(
            Effect.mapError(
              (error) => new RenameFailed({ message: error.message }),
            ),
          ))
        )
          return yield* new RenameFailed({
            message: "Source changed during rename. Try again after rebuild.",
          });
      }),
    );
  }, lock.withPermit);
});
