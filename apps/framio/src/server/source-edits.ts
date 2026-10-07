import ts from "typescript";
import { createHash } from "node:crypto";
import { twMerge } from "tailwind-merge";
import {
  formatSourceRef,
  parseSourceRef,
  lockMessages,
  type EditCapability,
  type ElementLock,
  type EditOperation,
  type EditResponse,
  type SourcePatch,
  type PatchResponse,
} from "../contracts/edits";

export type SourceElement = ts.JsxElement | ts.JsxSelfClosingElement;
export const sourceRevision = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const isSourceElement = (node: ts.Node): node is SourceElement =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
export const openingOf = (node: SourceElement) =>
  ts.isJsxElement(node) ? node.openingElement : node;
export const isFragmentElement = (node: SourceElement) =>
  ["Fragment", "React.Fragment"].includes(openingOf(node).tagName.getText());
export function parseSource(text: string, file: string) {
  const ast = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TSX,
  );
  const elements: SourceElement[] = [];
  const layerAttributes: ts.JsxAttribute[] = [];
  const visit = (node: ts.Node) => {
    if (isSourceElement(node) && !isFragmentElement(node)) elements.push(node);
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "data-layer")
      layerAttributes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { ast, elements, layerAttributes };
}
const staticString = (
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
const ignoredChild = (child: ts.JsxChild) =>
  (ts.isJsxText(child) && !child.text.trim()) ||
  (ts.isJsxExpression(child) && !child.expression);

function classTarget(node: SourceElement) {
  const props = openingOf(node).attributes.properties;
  const attrs = props.filter(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === "className",
  );
  const attr = attrs[0];
  const init = attr?.initializer;
  const expression =
    init && ts.isJsxExpression(init) ? init.expression : undefined;
  const call =
    expression &&
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ["cn", "clsx", "twMerge"].includes(expression.expression.text)
      ? expression
      : undefined;
  const literal =
    init && ts.isStringLiteral(init)
      ? init
      : expression && staticString(expression)
        ? expression
        : call
          ? [...call.arguments].reverse().find(ts.isStringLiteral)
          : undefined;
  const override = props.some(
    (p) => ts.isJsxSpreadAttribute(p) && (!attr || p.pos > attr.pos),
  );
  const dynamic = attrs.length > 1 || (!!attr && !literal && !call);
  return { attr, literal, call, override, dynamic };
}

/** The same source-derived policy drives DOM stamps and write authorization. */
export function elementCapabilities(
  node: SourceElement,
  file: string,
): {
  allowed: EditCapability[];
  locks: ElementLock[];
} {
  const capabilities: EditCapability[] = [
    "text",
    "size",
    "move",
    "remove",
    "duplicate",
  ];
  if (
    file
      .replace(/\\/g, "/")
      .replace(/^.*\/\.framio\//, "")
      .startsWith("components/")
  )
    return {
      allowed: [],
      locks: capabilities.map((capability) => ({
        capability,
        reason: "shared-component",
      })),
    };
  const allowed: EditCapability[] = [];
  const locks: ElementLock[] = [];
  if (ts.isJsxElement(node)) {
    const children = node.children;
    const mixed = children.some(
      (c) => isSourceElement(c) || ts.isJsxFragment(c),
    );
    const dynamic = children.some(
      (c) =>
        ts.isJsxExpression(c) && !!c.expression && !staticString(c.expression),
    );
    const text = children.some((c) =>
      ts.isJsxText(c)
        ? !!c.text.trim()
        : ts.isJsxExpression(c) &&
          !!c.expression &&
          staticString(c.expression) &&
          !!c.expression.text.trim(),
    );
    if (mixed) locks.push({ capability: "text", reason: "mixed-content" });
    else if (dynamic)
      locks.push({ capability: "text", reason: "dynamic-text" });
    else if (text) allowed.push("text");
  }
  const target = classTarget(node);
  if (target.dynamic)
    locks.push({ capability: "size", reason: "dynamic-class" });
  if (target.override)
    locks.push({ capability: "size", reason: "class-override" });
  if (!target.dynamic && !target.override) allowed.push("size");
  const parent = node.parent;
  if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
    if (parent.children.every((c) => ignoredChild(c) || isSourceElement(c)))
      allowed.push("move");
    else locks.push({ capability: "move", reason: "dynamic-siblings" });
    allowed.push("remove", "duplicate");
  } else {
    let ancestor: ts.Node | undefined = parent;
    while (ancestor && !ts.isJsxExpression(ancestor))
      ancestor = ancestor.parent;
    const dynamicChild =
      ancestor &&
      (ts.isJsxElement(ancestor.parent) || ts.isJsxFragment(ancestor.parent));
    for (const capability of ["move", "remove", "duplicate"] as const)
      locks.push({
        capability,
        reason:
          capability === "move" && dynamicChild
            ? "dynamic-siblings"
            : "no-jsx-parent",
      });
  }
  return { allowed, locks };
}

type Failure = Extract<EditResponse, { ok: false }>;
const failure = (reason: Failure["reason"], message: string): Failure => ({
  ok: false,
  reason,
  message,
});
export const editConflict =
  "This frame changed since you selected it. Try again on the updated frame.";
export const patchConflict =
  "The file changed since this edit, so it can't be undone here.";
export function applySourcePatch(
  text: string,
  patch: SourcePatch,
): (Extract<PatchResponse, { ok: true }> & { next: string }) | Failure {
  if (sourceRevision(text) !== patch.revision)
    return failure("conflict", patchConflict);
  if (
    !Number.isSafeInteger(patch.start) ||
    !Number.isSafeInteger(patch.end) ||
    patch.start < 0 ||
    patch.end < patch.start ||
    patch.end > text.length
  )
    return failure("invalid", "The patch range is invalid.");
  const next = text.slice(0, patch.start) + patch.text + text.slice(patch.end);
  return {
    ok: true,
    next,
    inverse: {
      file: patch.file,
      revision: sourceRevision(next),
      start: patch.start,
      end: patch.start + patch.text.length,
      text: text.slice(patch.start, patch.end),
    },
  };
}

function undoPatch(text: string, next: string, file: string): SourcePatch {
  let start = 0;
  while (
    start < text.length &&
    start < next.length &&
    text[start] === next[start]
  )
    start++;
  let end = text.length;
  let nextEnd = next.length;
  while (
    end > start &&
    nextEnd > start &&
    text[end - 1] === next[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  return {
    file,
    revision: sourceRevision(next),
    start,
    end: nextEnd,
    text: text.slice(start, end),
  };
}
function lineRange(text: string, node: SourceElement) {
  const start = node.getStart();
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const indent = text.slice(lineStart, start);
  const newline = text.indexOf("\n", node.end);
  const end = newline === -1 ? text.length : newline + 1;
  const ownStart = /^[\t ]*$/.test(indent);
  const whole =
    ownStart &&
    /^[\t \r]*$/.test(text.slice(node.end, newline === -1 ? end : newline));
  return {
    start: whole ? lineStart : start,
    end: whole ? end : node.end,
    indent,
    ownStart,
    whole,
  };
}
const splice = (text: string, start: number, end: number, value: string) =>
  text.slice(0, start) + value + text.slice(end);
function literalContents(value: string, quote: string, jsx: boolean) {
  if (jsx)
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? "&quot;" : "&#39;");
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(new RegExp(quote, "g"), `\\${quote}`)
    .replace(quote === "`" ? /\$\{/g : /$^/g, "\\${");
}
export type SourceEditResult =
  (Extract<EditResponse, { ok: true }> & { next: string }) | Failure;
export function transformSource(
  text: string,
  file: string,
  op: EditOperation,
): SourceEditResult {
  const location = parseSourceRef(op.ref);
  if (!location || location.file !== file)
    return failure("invalid", "Invalid source location.");
  if (location.rev.toLowerCase() !== sourceRevision(text).slice(0, 12))
    return failure("conflict", editConflict);
  const parsed = parseSource(text, file);
  const node = parsed.elements.find(
    (n) => n.getStart(parsed.ast) === location.start && n.end === location.end,
  );
  if (!node)
    return failure(
      "not-found",
      "The selected source element could not be found.",
    );
  const capabilities = elementCapabilities(node, file);
  const lock = capabilities.locks.find((l) => l.capability === op.type);
  if (lock) return failure("locked", lockMessages[lock.reason]);
  if (!capabilities.allowed.includes(op.type))
    return failure(
      "invalid",
      "This edit does not apply to the selected element.",
    );
  let next = text;
  let movedRegion: { start: number; end: number } | undefined;
  let start = node.getStart();
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const labels = {
    text: "Edit text",
    size: "Resize",
    move: "Move",
    remove: "Delete",
    duplicate: "Duplicate",
  };
  if (op.type === "text" && ts.isJsxElement(node)) {
    if (/[\r\n]/.test(op.text))
      return failure("invalid", "Text edits must not contain newlines.");
    let value = /[{}<>]|^\s|\s$/.test(op.text)
      ? `{${JSON.stringify(op.text)}}`
      : op.text.replace(/&/g, "&amp;");
    const original = text.slice(
      node.openingElement.end,
      node.closingElement.getStart(),
    );
    if (/[\r\n]/.test(original)) {
      const parentIndent = /^[\t ]*/.exec(
        text.slice(text.lastIndexOf("\n", start - 1) + 1),
      )![0];
      const childIndent =
        /\r?\n([\t ]*)\S/.exec(original)?.[1] ?? parentIndent + "  ";
      value = eol + childIndent + value + eol + parentIndent;
    }
    next = splice(
      text,
      node.openingElement.end,
      node.closingElement.getStart(),
      value,
    );
  } else if (op.type === "size") {
    const classes: string[] = [];
    for (const [axis, px] of [
      ["w", op.width],
      ["h", op.height],
    ] as const) {
      if (px === null) continue;
      if (!Number.isFinite(px) || px <= 0)
        return failure("invalid", "Dimensions must be greater than zero.");
      const rounded = Math.round(px);
      classes.push(
        rounded % 4 === 0 ? `${axis}-${rounded / 4}` : `${axis}-[${rounded}px]`,
      );
    }
    if (!classes.length)
      return failure("invalid", "Choose a width or height to resize.");
    const target = classTarget(node);
    if (target.literal) {
      const literal = target.literal;
      const pos = literal.getStart();
      const quote = text[pos]!;
      const value = literalContents(
        twMerge(literal.text, ...classes),
        quote,
        ts.isJsxAttribute(literal.parent),
      );
      next = splice(text, pos + 1, literal.end - 1, value);
    } else if (target.call) {
      const call = target.call;
      const position = call.arguments.end;
      const hasTrailingComma = call.arguments.hasTrailingComma;
      const value = `${call.arguments.length && !hasTrailingComma ? ", " : hasTrailingComma ? " " : ""}${JSON.stringify(twMerge(...classes))}`;
      next = splice(text, position, position, value);
    } else {
      const opening = openingOf(node);
      const props = opening.attributes.properties;
      const pos = props.length
        ? props[props.length - 1]!.end
        : opening.tagName.end;
      next = splice(text, pos, pos, ` className="${twMerge(...classes)}"`);
    }
  } else if (op.type === "remove") {
    const range = lineRange(text, node);
    next = splice(text, range.start, range.end, "");
  } else if (op.type === "duplicate") {
    const range = lineRange(text, node);
    let copy = text.slice(start, node.end);
    const key = openingOf(node).attributes.properties.find(
      (attribute) =>
        ts.isJsxAttribute(attribute) && attribute.name.getText() === "key",
    );
    if (key) copy = splice(copy, key.pos - start, key.end - start, "");
    const pos = range.whole ? range.end : node.end;
    const value = range.whole
      ? range.indent +
        copy +
        (text.slice(node.end, range.end).endsWith("\n") ? eol : "")
      : range.ownStart
        ? eol + range.indent + copy
        : copy;
    // A last line without a newline still needs a separator before the copy.
    const prefix =
      range.whole && pos === text.length && !text.endsWith("\n") ? eol : "";
    next = splice(text, pos, pos, prefix + value);
    start =
      pos +
      prefix.length +
      (range.whole
        ? range.indent.length
        : range.ownStart
          ? eol.length + range.indent.length
          : 0);
  } else if (op.type === "move") {
    const anchorRef = parseSourceRef(op.anchor);
    if (!anchorRef || anchorRef.file !== file)
      return failure(
        "invalid",
        "Choose a different sibling as the move anchor.",
      );
    if (anchorRef.rev.toLowerCase() !== location.rev.toLowerCase())
      return failure("conflict", editConflict);
    const anchor = parsed.elements.find(
      (n) => n.getStart() === anchorRef.start && n.end === anchorRef.end,
    );
    if (!anchor || anchor === node || anchor.parent !== node.parent)
      return failure(
        "invalid",
        "Choose a different sibling as the move anchor.",
      );
    const source = lineRange(text, node);
    const destination = lineRange(text, anchor);
    const whole = source.whole && destination.whole;
    const from = whole ? source.start : node.getStart();
    const until = whole ? source.end : node.end;
    let value = text.slice(from, until);
    if (whole) {
      value = value
        .split("\n")
        .map((line, i, all) =>
          i === all.length - 1 && !line
            ? line
            : line.startsWith(source.indent)
              ? destination.indent + line.slice(source.indent.length)
              : line,
        )
        .join("\n");
    }
    let pos =
      op.position === "before"
        ? whole
          ? destination.start
          : anchor.getStart()
        : whole
          ? destination.end
          : anchor.end;
    movedRegion = { start: Math.min(from, pos), end: Math.max(until, pos) };
    if (pos > from) pos -= until - from;
    const remaining = splice(text, from, until, "");
    const prefix =
      whole && pos === remaining.length && !remaining.endsWith("\n") ? eol : "";
    if (whole && !value.endsWith("\n") && pos < remaining.length) value += eol;
    next = splice(remaining, pos, pos, prefix + value);
    start = pos + prefix.length + (whole ? destination.indent.length : 0);
  }
  let ref: string | null = null;
  if (op.type !== "remove") {
    const confirmed = parseSource(next, file).elements.find(
      (n) =>
        n.getStart() === start &&
        openingOf(n).tagName.getText() === openingOf(node).tagName.getText(),
    );
    if (!confirmed)
      return failure(
        "invalid",
        "The edit could not preserve the selected source element.",
      );
    ref = formatSourceRef({
      file,
      start,
      end: confirmed.end,
      rev: sourceRevision(next),
    });
  }
  return {
    ok: true,
    next,
    ref,
    undo: movedRegion
      ? {
          file,
          revision: sourceRevision(next),
          start: movedRegion.start,
          end: movedRegion.end + next.length - text.length,
          text: text.slice(movedRegion.start, movedRegion.end),
        }
      : undoPatch(text, next, file),
    label: labels[op.type],
  };
}
