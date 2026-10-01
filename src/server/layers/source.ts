import ts from "typescript";
import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Semaphore from "effect/Semaphore";
import { resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
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
  const { ast, found } = attributes(text, file);
  let result = text;
  for (const attr of found.reverse()) {
    const peers = (attr.parent as ts.JsxAttributes).properties;
    if (
      peers.filter(
        (p) => ts.isJsxAttribute(p) && p.name.getText(ast) === "data-layer",
      ).length !== 1 ||
      peers.some(
        (p) =>
          ts.isJsxAttribute(p) &&
          p.name.getText(ast) === "data-framio-layer-source",
      )
    )
      continue;
    if (peers.some((p) => ts.isJsxSpreadAttribute(p) && p.pos > attr.pos))
      continue;
    const init = attr.initializer;
    const value = init && ts.isStringLiteral(init) ? init.text : null;
    const source = JSON.stringify({
      file,
      start: init?.getStart(ast) ?? attr.end,
      end: init?.end ?? attr.end,
      revision: revision(text),
      value,
    });
    result =
      result.slice(0, attr.end) +
      ` data-framio-layer-source={${JSON.stringify(source)}}` +
      result.slice(attr.end);
  }
  return result;
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
        if ((yield* fs.readFileString(file)) !== text)
          return yield* new RenameFailed({
            message: "Source changed during rename. Try again after rebuild.",
          });
        yield* fs.rename(temporary, file);
      }),
    );
  }, lock.withPermit);
});
