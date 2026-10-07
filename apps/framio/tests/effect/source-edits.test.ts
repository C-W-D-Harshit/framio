import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import ts from "typescript";
import {
  formatSourceRef,
  parseSourceRef,
  lockMessages,
  type EditOperation,
} from "../../src/contracts/edits";
import {
  parseSource,
  elementCapabilities,
  sourceRevision,
  transformSource,
  applySourcePatch,
} from "../../src/server/source-edits";
import { injectLayerSources } from "../../src/server/layers/source";

const file = "pages/home/frame.tsx";
const refAt = (text: string, index = 1, sourceFile = file) => {
  const node = parseSource(text, sourceFile).elements[index]!;
  return formatSourceRef({
    file: sourceFile,
    start: node.getStart(),
    end: node.end,
    rev: sourceRevision(text),
  });
};
const policy = (text: string, index = 1, sourceFile = file) =>
  elementCapabilities(
    parseSource(text, sourceFile).elements[index]!,
    sourceFile,
  );
const fixtures = [
  [
    "<div><p>Hello</p></div>",
    ["text", "size", "move", "remove", "duplicate"],
    [],
  ],
  [
    '<div><p>{"Hello"}{` world`}{/* comment */}{}</p></div>',
    ["text", "size", "move", "remove", "duplicate"],
    [],
  ],
  ['<div><p>{" "} </p></div>', ["size", "move", "remove", "duplicate"], []],
  ["<div><p /></div>", ["size", "move", "remove", "duplicate"], []],
  [
    "<div><p><b />hello</p></div>",
    ["size", "move", "remove", "duplicate"],
    ["text:mixed-content"],
  ],
  [
    "<div><p><>hello</></p></div>",
    ["size", "move", "remove", "duplicate"],
    ["text:mixed-content"],
  ],
  [
    "<div><p>{value}</p></div>",
    ["size", "move", "remove", "duplicate"],
    ["text:dynamic-text"],
  ],
  [
    "<div><p>{`Hello ${name}`}</p></div>",
    ["size", "move", "remove", "duplicate"],
    ["text:dynamic-text"],
  ],
  [
    '<div><p className="h-10" /></div>',
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  [
    '<div><p className={"h-10"} /></div>',
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  [
    "<div><p className={`h-10`} /></div>",
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  [
    "<div><p className={cn(foo)} /></div>",
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  [
    '<div><p className={clsx("h-10", foo)} /></div>',
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  [
    "<div><p className={twMerge(foo)} /></div>",
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  [
    "<div><p className={foo} /></div>",
    ["move", "remove", "duplicate"],
    ["size:dynamic-class"],
  ],
  [
    "<div><p className={`h-${x}`} /></div>",
    ["move", "remove", "duplicate"],
    ["size:dynamic-class"],
  ],
  [
    '<div><p className="h-10" {...props} /></div>',
    ["move", "remove", "duplicate"],
    ["size:class-override"],
  ],
  [
    "<div><p {...props} /></div>",
    ["move", "remove", "duplicate"],
    ["size:class-override"],
  ],
  [
    '<div><p {...props} className="h-10" /></div>',
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  [
    "<div>text<p /></div>",
    ["size", "remove", "duplicate"],
    ["move:dynamic-siblings"],
  ],
  [
    "<div>{list.map(x => <i />)}<p /></div>",
    ["size", "remove", "duplicate"],
    ["move:no-jsx-parent"],
  ],
  [
    "<div>{condition && <i />}<p /></div>",
    ["size", "remove", "duplicate"],
    ["move:no-jsx-parent"],
  ],
  [
    "<div>{value}<p /></div>",
    ["size", "remove", "duplicate"],
    ["move:dynamic-siblings"],
  ],
  [
    "<div> \n{/* comment */}{}<p /> \n </div>",
    ["size", "move", "remove", "duplicate"],
    [],
  ],
  ["<><p /><b /></>", ["size", "move", "remove", "duplicate"], []],
] as const;

describe("source edit policy", () => {
  for (const [text, allowed, locks] of fixtures) {
    // The expression fixtures select their callback/conditional child explicitly below.
    const index = text.startsWith("<>")
      ? 0
      : text.includes("list.map") || text.includes("condition &&")
        ? 1
        : 1;
    it.effect(text, () =>
      Effect.sync(() => {
        const result = policy(text, index);
        if (text.includes("list.map") || text.includes("condition &&")) {
          expect(result.allowed).toEqual(["size"]);
          expect(result.locks).toEqual(
            ["move", "remove", "duplicate"].map((capability) => ({
              capability,
              reason:
                capability === "move" ? "dynamic-siblings" : "no-jsx-parent",
            })),
          );
          expect(policy(text, 2).locks).toContainEqual({
            capability: "move",
            reason: "dynamic-siblings",
          });
        } else {
          expect(result.allowed).toEqual([...allowed]);
          expect(
            result.locks.map((l) => `${l.capability}:${l.reason}`),
          ).toEqual([...locks]);
        }
      }),
    );
  }
  it.effect(
    "locks root elements in return, arrow, ternary, and JSX prop expressions",
    () =>
      Effect.sync(() => {
        for (const text of [
          "function F(){return <p>hi</p>}",
          "const F=()=> <p>hi</p>",
          "const F=()=> ok ? <p>hi</p> : null",
          "<div label={<p>hi</p>} />",
        ]) {
          const index = text.startsWith("<div") ? 1 : 0;
          expect(policy(text, index).locks).toEqual(
            ["move", "remove", "duplicate"].map((capability) => ({
              capability,
              reason: "no-jsx-parent",
            })),
          );
        }
      }),
  );
  it.effect("locks all shared-component capabilities", () =>
    Effect.sync(() => {
      const result = policy("<div><p>hi</p></div>", 1, "components/Button.tsx");
      expect(result.allowed).toEqual([]);
      expect(result.locks).toEqual(
        ["text", "size", "move", "remove", "duplicate"].map((capability) => ({
          capability,
          reason: "shared-component",
        })),
      );
    }),
  );
});

describe("source stamping", () => {
  it.effect(
    "stamps Windows drive and UNC paths with relative forward-slash refs",
    () =>
      Effect.sync(() => {
        const text = "<div><p>Hello</p></div>";
        for (const root of [
          "D:\\RUNNER~1\\project\\.framio\\",
          "d:/Runner Name/project/.FRAMIO/",
          "\\\\server\\share\\project\\.framio\\",
        ]) {
          const stamped = injectLayerSources(
            text,
            root + "pages\\home\\frame.tsx",
          );
          const refs = [...stamped.matchAll(/data-framio-src="([^"]+)"/g)].map(
            (match) => parseSourceRef(match[1]!)!,
          );
          expect(refs).toHaveLength(2);
          expect(refs.every((ref) => ref.file === file)).toBe(true);
          const sharedFile = root + "components\\Button.tsx";
          const shared = injectLayerSources(text, sharedFile);
          expect(shared).toContain('data-framio-edit=""');
          expect(policy(text, 1, sharedFile).allowed).toEqual([]);
          expect(policy(text, 1, sharedFile).locks).toHaveLength(5);
        }
      }),
  );
  it.effect(
    "inserts call site stamps before every attribute and keeps original spans and revision",
    () =>
      Effect.sync(() => {
        const text =
          'const F = () => <main><Button {...props} data-layer="Action">Hi</Button></main>';
        const stamped = injectLayerSources(text, "/project/.framio/" + file);
        expect(stamped).toMatch(
          /<Button data-framio-src="[^"]+" data-framio-edit="[^"]*" data-framio-lock="[^"]+" \{\.\.\.props\}/,
        );
        const refs = [...stamped.matchAll(/data-framio-src="([^"]+)"/g)].map(
          (m) => parseSourceRef(m[1]!)!,
        );
        expect(refs).toHaveLength(2);
        expect(refs.map((ref) => text.slice(ref.start, ref.end))).toEqual([
          '<main><Button {...props} data-layer="Action">Hi</Button></main>',
          '<Button {...props} data-layer="Action">Hi</Button>',
        ]);
        expect(
          refs.every(
            (ref) =>
              ref.file === file &&
              ref.rev === sourceRevision(text).slice(0, 12),
          ),
        ).toBe(true);
        expect(stamped).toContain("data-framio-layer-source=");
        expect(
          ts.transpileModule(stamped, {
            compilerOptions: { jsx: ts.JsxEmit.ReactJSX },
            reportDiagnostics: true,
          }).diagnostics,
        ).toEqual([]);
      }),
  );
  it.effect(
    "excludes all fragment spellings and stamps shared elements with all locks",
    () =>
      Effect.sync(() => {
        const text =
          "<><Fragment><React.Fragment><p>Hello</p></React.Fragment></Fragment></>";
        const stamped = injectLayerSources(
          text,
          "/project/.framio/components/Text.tsx",
        );
        expect([...stamped.matchAll(/data-framio-src=/g)]).toHaveLength(1);
        expect(stamped).toContain('data-framio-edit=""');
        for (const cap of ["text", "size", "move", "remove", "duplicate"])
          expect(stamped).toContain(`${cap}:shared-component`);
      }),
  );
});

function roundTrip(text: string, op: EditOperation) {
  const result = transformSource(text, file, op);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  const restored = applySourcePatch(result.next, result.undo);
  expect(restored.ok).toBe(true);
  if (!restored.ok) throw new Error(restored.message);
  expect(restored.next).toBe(text);
  const redone = applySourcePatch(restored.next, restored.inverse);
  expect(redone.ok).toBe(true);
  if (redone.ok) expect(redone.next).toBe(result.next);
  if (result.ref) {
    const location = parseSourceRef(result.ref)!;
    expect(location.rev).toBe(sourceRevision(result.next).slice(0, 12));
    expect(
      parseSource(result.next, file).elements.some(
        (n) => n.getStart() === location.start && n.end === location.end,
      ),
    ).toBe(true);
  } else expect(op.type).toBe("remove");
  return result;
}

describe("source transforms", () => {
  for (const [original, replacement, expected] of [
    ["<div><p>Hello</p></div>", "World", "<div><p>World</p></div>"],
    ["<div><p>Hello</p></div>", "A &copy;", "<div><p>A &amp;copy;</p></div>"],
    ["<div><p>Hello</p></div>", " <{x}> ", '<div><p>{" <{x}> "}</p></div>'],
    ["<div><p>Hello</p></div>", '"नमस्ते" 🌏', '<div><p>"नमस्ते" 🌏</p></div>'],
    [
      '<div><p>Hello{" "}{"world"}</p></div>',
      "Hi there",
      "<div><p>Hi there</p></div>",
    ],
    [
      "<div>\n  <p>\n    Hello\n  </p>\n</div>",
      "World",
      "<div>\n  <p>\n    World\n  </p>\n</div>",
    ],
    [
      "<div>\r\n  <p>\r\n    Héllo\r\n  </p>\r\n</div>",
      "नमस्ते",
      "<div>\r\n  <p>\r\n    नमस्ते\r\n  </p>\r\n</div>",
    ],
  ])
    it.effect(
      `text: ${JSON.stringify(replacement)} in ${JSON.stringify(original)}`,
      () =>
        Effect.sync(() => {
          const result = roundTrip(original!, {
            type: "text",
            ref: refAt(original!),
            text: replacement!,
          });
          expect(result.next).toBe(expected);
          expect(result.label).toBe("Edit text");
        }),
    );
  for (const [attribute, expected] of [
    ['className="h-10 px-2"', 'className="px-2 w-60 h-[243px]"'],
    ["className='h-10'", "className='w-60 h-[243px]'"],
    ["className={'h-10'}", "className={'w-60 h-[243px]'}"],
    ["className={`h-10`}", "className={`w-60 h-[243px]`}"],
    [
      'className={cn("h-10", active)}',
      'className={cn("w-60 h-[243px]", active)}',
    ],
    [
      'className={cn(active, "h-10", "px-2")}',
      'className={cn(active, "h-10", "px-2 w-60 h-[243px]")}',
    ],
    ["className={cn(active)}", 'className={cn(active, "w-60 h-[243px]")}'],
    ["className={cn()}", 'className={cn("w-60 h-[243px]")}'],
    ["className={cn(active,)}", 'className={cn(active, "w-60 h-[243px]")}'],
    ['className={clsx("h-10")}', 'className={clsx("w-60 h-[243px]")}'],
    [
      "className={twMerge(active)}",
      'className={twMerge(active, "w-60 h-[243px]")}',
    ],
    ["", 'className="w-60 h-[243px]"'],
    ['id="x"', 'id="x" className="w-60 h-[243px]"'],
  ])
    it.effect(`size: ${attribute || "absent className"}`, () =>
      Effect.sync(() => {
        const text = `<div><p${attribute ? " " + attribute : ""} /></div>`;
        const result = roundTrip(text, {
          type: "size",
          ref: refAt(text),
          width: 239.8,
          height: 243.2,
        });
        expect(result.next).toBe(`<div><p ${expected} /></div>`);
        expect(result.label).toBe("Resize");
      }),
    );
  it.effect(
    "resizes one axis while retaining the other and merges size utilities",
    () =>
      Effect.sync(() => {
        for (const [initial, expected] of [
          ["w-10 h-10", "w-10 h-2"],
          ["size-10", "size-10 h-2"],
        ]) {
          const text = `<div><p className="${initial}" /></div>`;
          expect(
            roundTrip(text, {
              type: "size",
              ref: refAt(text),
              width: null,
              height: 8,
            }).next,
          ).toContain(`className="${expected}"`);
        }
      }),
  );
  for (const eol of ["\n", "\r\n"]) {
    const text = `<div>${eol}  <p>Één</p>${eol}    <p>二</p>${eol}  <p>Three</p>${eol}</div>`;
    it.effect(`whole-line move and reindent: ${JSON.stringify(eol)}`, () =>
      Effect.sync(() => {
        expect(
          roundTrip(text, {
            type: "move",
            ref: refAt(text, 1),
            anchor: refAt(text, 2),
            position: "after",
          }).next,
        ).toBe(
          `<div>${eol}    <p>二</p>${eol}    <p>Één</p>${eol}  <p>Three</p>${eol}</div>`,
        );
        expect(
          roundTrip(text, {
            type: "move",
            ref: refAt(text, 3),
            anchor: refAt(text, 1),
            position: "before",
          }).next,
        ).toBe(
          `<div>${eol}  <p>Three</p>${eol}  <p>Één</p>${eol}    <p>二</p>${eol}</div>`,
        );
      }),
    );
    it.effect(
      `whole-line deletion and duplication: ${JSON.stringify(eol)}`,
      () =>
        Effect.sync(() => {
          const removed = roundTrip(text, {
            type: "remove",
            ref: refAt(text, 2),
          });
          expect(removed.next).toBe(
            `<div>${eol}  <p>Één</p>${eol}  <p>Three</p>${eol}</div>`,
          );
          const duplicate = roundTrip(text, {
            type: "duplicate",
            ref: refAt(text, 2),
          });
          expect(duplicate.next).toBe(
            `<div>${eol}  <p>Één</p>${eol}    <p>二</p>${eol}    <p>二</p>${eol}  <p>Three</p>${eol}</div>`,
          );
          expect(parseSourceRef(duplicate.ref!)!.start).toBe(
            duplicate.next.lastIndexOf("<p>二"),
          );
        }),
    );
  }
  it.effect(
    "moves before and after inline siblings and removes and duplicates exact spans",
    () =>
      Effect.sync(() => {
        const text = "<div><p>one</p><p>two</p><p>three</p></div>";
        expect(
          roundTrip(text, {
            type: "move",
            ref: refAt(text, 1),
            anchor: refAt(text, 2),
            position: "after",
          }).next,
        ).toBe("<div><p>two</p><p>one</p><p>three</p></div>");
        expect(
          roundTrip(text, {
            type: "move",
            ref: refAt(text, 3),
            anchor: refAt(text, 1),
            position: "before",
          }).next,
        ).toBe("<div><p>three</p><p>one</p><p>two</p></div>");
        expect(roundTrip(text, { type: "remove", ref: refAt(text) }).next).toBe(
          "<div><p>two</p><p>three</p></div>",
        );
        expect(
          roundTrip(text, { type: "duplicate", ref: refAt(text) }).next,
        ).toBe("<div><p>one</p><p>one</p><p>two</p><p>three</p></div>");
      }),
  );
  it.effect(
    "round trips every operation over nested, inline, CRLF and non-ASCII fixtures",
    () =>
      Effect.sync(() => {
        for (const eol of ["", "\n", "\r\n"]) {
          for (const word of ["Hello", "ありがとう", "🦊"]) {
            const text = `const F = () => <div>${eol}  <p className="h-10">${word}</p>${eol}  <p>Anchor</p>${eol}</div>;`;
            const ref = refAt(text);
            for (const op of [
              { type: "text", ref, text: " Grüße {x} " },
              { type: "size", ref, width: 8, height: 243 },
              { type: "move", ref, anchor: refAt(text, 2), position: "after" },
              { type: "remove", ref },
              { type: "duplicate", ref },
            ] as EditOperation[])
              roundTrip(text, op);
          }
        }
      }),
  );
});

describe("source edit failures", () => {
  it.effect(
    "rejects stale revisions, nonexistent spans, locked and inapplicable capabilities",
    () =>
      Effect.sync(() => {
        const text = "<div><p>{value}</p><p /></div>";
        expect(
          transformSource(text + " ", file, {
            type: "remove",
            ref: refAt(text),
          }),
        ).toMatchObject({ ok: false, reason: "conflict" });
        expect(
          transformSource(text, file, {
            type: "remove",
            ref: formatSourceRef({
              file,
              start: 1,
              end: 2,
              rev: sourceRevision(text),
            }),
          }),
        ).toMatchObject({ ok: false, reason: "not-found" });
        expect(
          transformSource(text, file, {
            type: "text",
            ref: refAt(text),
            text: "Hi",
          }),
        ).toEqual({
          ok: false,
          reason: "locked",
          message: lockMessages["dynamic-text"],
        });
        expect(
          transformSource(text, file, {
            type: "text",
            ref: refAt(text, 2),
            text: "Hi",
          }),
        ).toMatchObject({ ok: false, reason: "invalid" });
        expect(
          transformSource(text, file, { type: "remove", ref: "bad" }),
        ).toMatchObject({ ok: false, reason: "invalid" });
        expect(
          transformSource(text, file + "x", {
            type: "remove",
            ref: refAt(text),
          }),
        ).toMatchObject({ ok: false, reason: "invalid" });
      }),
  );
  it.effect("rejects invalid sizes and anchors, and locks root edits", () =>
    Effect.sync(() => {
      const text = "<div><p>Hello</p><section><b /></section></div>";
      for (const width of [0, -1, NaN, Infinity])
        expect(
          transformSource(text, file, {
            type: "size",
            ref: refAt(text),
            width,
            height: null,
          }),
        ).toMatchObject({ ok: false, reason: "invalid" });
      expect(
        transformSource(text, file, {
          type: "size",
          ref: refAt(text),
          width: null,
          height: null,
        }),
      ).toMatchObject({ ok: false, reason: "invalid" });
      for (const anchor of [
        refAt(text),
        refAt(text, 3),
        refAt(text, 2, "pages/other.tsx"),
      ])
        expect(
          transformSource(text, file, {
            type: "move",
            ref: refAt(text),
            anchor,
            position: "after",
          }),
        ).toMatchObject({ ok: false, reason: "invalid" });
      expect(
        transformSource(text, file, { type: "remove", ref: refAt(text, 0) }),
      ).toMatchObject({ ok: false, reason: "locked" });
    }),
  );
  it.effect("validates full patch revision and bounds", () =>
    Effect.sync(() => {
      const text = "abc";
      const base = {
        file,
        revision: sourceRevision(text),
        start: 0,
        end: 1,
        text: "x",
      };
      expect(
        applySourcePatch(text, {
          ...base,
          revision: base.revision.slice(0, 12),
        }),
      ).toMatchObject({ ok: false, reason: "conflict" });
      for (const [start, end] of [
        [-1, 1],
        [2, 1],
        [0, 4],
        [0.1, 1],
      ])
        expect(
          applySourcePatch(text, { ...base, start: start!, end: end! }),
        ).toMatchObject({ ok: false, reason: "invalid" });
    }),
  );
});

it.effect(
  "duplicate drops only the copied root key and undo restores bytes",
  () =>
    Effect.sync(() => {
      for (const key of ['key="row"', "key={id}", "key={`row`}"]) {
        const text = `<div>\n  <p ${key} className="h-10"><span key="child">Hello</span></p>\n</div>`;
        const result = transformSource(text, file, {
          type: "duplicate",
          ref: refAt(text),
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.next).toBe(
          `<div>\n  <p ${key} className="h-10"><span key="child">Hello</span></p>\n  <p className="h-10"><span key="child">Hello</span></p>\n</div>`,
        );
        const undo = applySourcePatch(result.next, result.undo);
        expect(undo.ok && undo.next).toBe(text);
        expect(parseSourceRef(result.ref!)!.start).toBe(
          result.next.lastIndexOf("<p"),
        );
      }
    }),
);

it.effect(
  "unlocked call sites stamp an empty lock to override shared component locks",
  () =>
    Effect.sync(() => {
      const stamped = injectLayerSources(
        "<div><Button>Hello</Button></div>",
        "pages/home/frame.tsx",
      );
      expect(stamped).toMatch(
        /<Button data-framio-src="[^"]+" data-framio-edit="text,size,move,remove,duplicate" data-framio-lock=""/,
      );
    }),
);
