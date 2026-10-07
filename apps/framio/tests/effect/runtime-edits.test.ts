import { describe, expect, it } from "@effect/vitest";
import {
  changesOrder,
  dropPosition,
  frameScale,
  isQuickEditShortcut,
  selectionPayload,
  singleLineText,
  snapSize,
  sourceAtIndex,
  sourceSelector,
  type DropBox,
} from "../../src/runtime/edit-helpers";

const ref = "pages/home.tsx:10:30:abcdef012345";
const box = (ref: string, x = 0, y = 0): DropBox => ({
  ref,
  x,
  y,
  width: 100,
  height: 40,
});
const row = { display: "flex", direction: "row", wrap: "nowrap" };
const column = { display: "flex", direction: "column", wrap: "nowrap" };

describe("runtime quick-edit shortcuts", () => {
  it("matches native actions that the Studio owns for a stamped selection", () => {
    for (const key of ["Delete", "Backspace", "Enter"])
      expect(isQuickEditShortcut({ key, metaKey: false, ctrlKey: false })).toBe(
        true,
      );
    for (const key of ["d", "D", "z", "Z"]) {
      expect(isQuickEditShortcut({ key, metaKey: true, ctrlKey: false })).toBe(
        true,
      );
      expect(isQuickEditShortcut({ key, metaKey: false, ctrlKey: true })).toBe(
        true,
      );
    }
    expect(
      isQuickEditShortcut({ key: "y", metaKey: false, ctrlKey: true }),
    ).toBe(true);
    expect(
      isQuickEditShortcut({ key: "Y", metaKey: false, ctrlKey: true }),
    ).toBe(true);
  });
  it("leaves ordinary typing and other shortcuts alone", () => {
    for (const key of ["d", "z", "y", "a", "Tab", "Escape"])
      expect(isQuickEditShortcut({ key, metaKey: false, ctrlKey: false })).toBe(
        false,
      );
    expect(
      isQuickEditShortcut({ key: "y", metaKey: true, ctrlKey: false }),
    ).toBe(false);
    expect(
      isQuickEditShortcut({ key: "c", metaKey: true, ctrlKey: false }),
    ).toBe(false);
    expect(
      isQuickEditShortcut({ key: "Enter", metaKey: true, ctrlKey: false }),
    ).toBe(false);
    expect(
      isQuickEditShortcut({
        key: "Delete",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      isQuickEditShortcut({
        key: "D",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      isQuickEditShortcut({
        key: "Y",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe(false);
    expect(
      isQuickEditShortcut({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
      }),
    ).toBe(false);
  });
});

describe("runtime source selection", () => {
  it("keeps the legacy payload absent without a source stamp", () => {
    expect(
      selectionPayload({
        ref: null,
        element: 1,
        matches: [],
        edit: "text",
        lock: null,
        hasElementChildren: false,
      }),
    ).toBeUndefined();
  });
  it("reports the document-order instance and decoded capabilities and locks", () => {
    const element = {};
    expect(
      selectionPayload({
        ref,
        element,
        matches: [{}, element, {}],
        edit: "text,size,invalid",
        lock: "move:dynamic-siblings;remove:no-jsx-parent",
        hasElementChildren: false,
      }),
    ).toEqual({
      ref,
      index: 1,
      count: 3,
      allowed: ["text", "size"],
      locks: [
        { capability: "move", reason: "dynamic-siblings" },
        { capability: "remove", reason: "no-jsx-parent" },
      ],
    });
  });
  it("locks mixed DOM content even when the source allowed text", () => {
    const payload = selectionPayload({
      ref,
      element: 1,
      matches: [1],
      edit: "text,size",
      lock: "text:mixed-content",
      hasElementChildren: true,
    });
    expect(payload?.allowed).toEqual(["size"]);
    expect(payload?.locks).toEqual([
      { capability: "text", reason: "mixed-content" },
    ]);
  });
  it("does not introduce a text lock when text was already disallowed", () => {
    expect(
      selectionPayload({
        ref,
        element: 1,
        matches: [1],
        edit: "size",
        lock: null,
        hasElementChildren: true,
      })?.locks,
    ).toEqual([]);
  });
  it("selects the requested instance, then the first, then nothing", () => {
    expect(sourceAtIndex(["a", "b"], 1)).toBe("b");
    expect(sourceAtIndex(["a", "b"], 9)).toBe("a");
    expect(sourceAtIndex(["a", "b"], -1)).toBe("a");
    expect(sourceAtIndex([], 0)).toBeNull();
  });
  it("passes the complete ref through CSS.escape before querying", () => {
    const escaped: string[] = [];
    expect(
      sourceSelector('pages/"quote".tsx:1:2:abcdef012345', (value) => {
        escaped.push(value);
        return "escaped";
      }),
    ).toBe('[data-framio-src="escaped"]');
    expect(escaped).toEqual(['pages/"quote".tsx:1:2:abcdef012345']);
  });
});

describe("runtime resize geometry", () => {
  it("snaps to four CSS pixels and preserves free sizing with Shift", () => {
    expect(snapSize(101, false)).toBe(100);
    expect(snapSize(102, false)).toBe(104);
    expect(snapSize(101.5, true)).toBe(101.5);
    expect(snapSize(-20, false)).toBe(4);
    expect(snapSize(0, true)).toBe(1);
  });
  it("keeps handles eight screen pixels across zoom and guards invalid geometry", () => {
    expect((8 / frameScale(200, 400)) * 0.5).toBe(8);
    expect(frameScale(800, 400)).toBe(2);
    expect(frameScale(0, 400)).toBe(1);
    expect(frameScale(400, 0)).toBe(1);
    expect(frameScale(NaN, 400)).toBe(1);
  });
  it("normalizes pasted newlines to one line", () => {
    expect(singleLineText("hello\r\nworld\nagain")).toBe("hello world again");
    expect(singleLineText("  keep  spaces  ")).toBe("  keep  spaces  ");
  });
});

describe("runtime reorder drop geometry", () => {
  it("uses horizontal midpoints for row and inline flex", () => {
    const siblings = [box("a"), box("b", 120)];
    expect(dropPosition(siblings, { x: 160, y: 300 }, row)).toEqual({
      index: 1,
      ref: "b",
      position: "before",
      axis: "horizontal",
    });
    expect(
      dropPosition(
        siblings,
        { x: 190, y: 0 },
        { ...row, display: "inline-flex" },
      )?.position,
    ).toBe("after");
  });
  it("reverses source positions for row-reverse", () => {
    expect(
      dropPosition(
        [box("a")],
        { x: 30, y: 20 },
        { ...row, direction: "row-reverse" },
      )?.position,
    ).toBe("after");
    expect(
      dropPosition(
        [box("a")],
        { x: 70, y: 20 },
        { ...row, direction: "row-reverse" },
      )?.position,
    ).toBe("before");
  });
  it("uses vertical midpoints for columns and ordinary blocks", () => {
    const siblings = [box("a"), box("b", 0, 60)];
    expect(dropPosition(siblings, { x: 300, y: 65 }, column)).toEqual({
      index: 1,
      ref: "b",
      position: "before",
      axis: "vertical",
    });
    expect(
      dropPosition(siblings, { x: 0, y: 90 }, { ...column, display: "block" })
        ?.position,
    ).toBe("after");
    expect(
      dropPosition(
        siblings,
        { x: 0, y: 90 },
        { ...column, direction: "column-reverse" },
      )?.position,
    ).toBe("before");
  });
  it("uses the nearest grid center in two dimensions", () => {
    const siblings = [
      box("a"),
      box("b", 120),
      box("c", 0, 60),
      box("d", 120, 60),
    ];
    const grid = { ...row, display: "grid" };
    expect(dropPosition(siblings, { x: 130, y: 80 }, grid)).toEqual({
      index: 3,
      ref: "d",
      position: "before",
      axis: "horizontal",
    });
    expect(dropPosition(siblings, { x: 175, y: 110 }, grid)).toEqual({
      index: 3,
      ref: "d",
      position: "after",
      axis: "vertical",
    });
  });
  it("finds the correct row in wrapped flex", () => {
    const siblings = [
      box("a"),
      box("b", 120),
      box("c", 0, 60),
      box("d", 120, 60),
    ];
    expect(
      dropPosition(siblings, { x: 140, y: 80 }, { ...row, wrap: "wrap" }),
    ).toEqual({ index: 3, ref: "d", position: "before", axis: "horizontal" });
    expect(
      dropPosition(siblings, { x: 240, y: 20 }, { ...row, wrap: "wrap" })?.ref,
    ).toBe("b");
  });
  it("finds the correct column in wrapped column flex", () => {
    const siblings = [
      box("a"),
      box("b", 0, 60),
      box("c", 120),
      box("d", 120, 60),
    ];
    expect(
      dropPosition(siblings, { x: 150, y: 65 }, { ...column, wrap: "wrap" }),
    ).toEqual({ index: 3, ref: "d", position: "before", axis: "vertical" });
  });
  it("returns nothing for a lone movable child with no anchor", () => {
    expect(dropPosition([], { x: 0, y: 0 }, row)).toBeNull();
  });
  it("suppresses adjacent no-op drops and recognizes actual reorders", () => {
    const siblings = ["a", "b", "c"];
    expect(changesOrder(siblings, "b", "a", "after")).toBe(false);
    expect(changesOrder(siblings, "b", "c", "before")).toBe(false);
    expect(changesOrder(siblings, "b", "b", "after")).toBe(false);
    expect(changesOrder(siblings, "b", "c", "after")).toBe(true);
    expect(changesOrder(siblings, "b", "a", "before")).toBe(true);
    expect(changesOrder(siblings, "missing", "a", "before")).toBe(false);
  });
});
