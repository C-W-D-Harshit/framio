import { describe, expect, it } from "vitest";
import {
  emptyHistory,
  pushEdit,
  finishUndo,
  finishRedo,
  dropConflict,
  type EditEntry,
} from "../../src/ui/edit-history";
import {
  matchesRestore,
  type RestoreDocument,
  type SelectionRestore,
} from "../../src/ui/edit-restore";
import { editShortcut, shortcutsAllowed } from "../../src/ui/edit-shortcuts";

const patch = (revision: string) => ({
  file: "frame.tsx",
  revision,
  start: 0,
  end: 4,
  text: "old",
});
const entry: EditEntry = {
  frameId: "frame",
  label: "Change text",
  undo: patch("edited"),
  beforeRef: "frame.tsx:0:4:aaaaaaaaaaaa",
  beforeIndex: 2,
  afterRef: "frame.tsx:0:4:bbbbbbbbbbbb",
  afterIndex: 2,
};

describe("Studio edit history", () => {
  it("pushes an edit and clears redo", () => {
    const undone = finishUndo(pushEdit(emptyHistory, entry), patch("old"));
    expect(undone.redo).toHaveLength(1);
    const pushed = pushEdit(undone, { ...entry, label: "Resize" });
    expect(pushed.undo.map((edit) => edit.label)).toEqual(["Resize"]);
    expect(pushed.redo).toEqual([]);
  });
  it("round trips undo and redo with new inverse patches and the original selection", () => {
    const undone = finishUndo(pushEdit(emptyHistory, entry), patch("old"));
    expect(undone.undo).toEqual([]);
    expect(undone.redo).toEqual([{ ...entry, redo: patch("old") }]);
    const redone = finishRedo(undone, patch("edited-again"));
    expect(redone.redo).toEqual([]);
    expect(redone.undo).toEqual([{ ...entry, undo: patch("edited-again") }]);
    expect("redo" in redone.undo[0]!).toBe(false);
  });
  it("drops only the conflicting entry on either side", () => {
    const history = pushEdit(pushEdit(emptyHistory, entry), {
      ...entry,
      label: "Second",
    });
    expect(dropConflict(history, "undo").undo).toEqual([entry]);
    const undone = finishUndo(
      finishUndo(history, patch("first")),
      patch("second"),
    );
    expect(dropConflict(undone, "redo").redo.map((edit) => edit.label)).toEqual(
      ["Second"],
    );
  });
  it("keeps the latest 100 entries across undo and redo", () => {
    let history = emptyHistory;
    for (let i = 0; i < 105; i++)
      history = pushEdit(history, { ...entry, label: String(i) });
    expect(history.undo).toHaveLength(100);
    expect(history.undo[0]!.label).toBe("5");
    for (let i = 0; i < 100; i++)
      history = finishUndo(history, patch(String(i)));
    expect(history.undo).toHaveLength(0);
    expect(history.redo).toHaveLength(100);
    for (let i = 0; i < 100; i++)
      history = finishRedo(history, patch(String(i)));
    expect(history.undo).toHaveLength(100);
    expect(history.redo).toHaveLength(0);
  });
  it("retains the null after selection for a removed element", () => {
    const removed = { ...entry, afterRef: null };
    expect(
      finishUndo(pushEdit(emptyHistory, removed), patch("old")).redo[0]!
        .afterRef,
    ).toBeNull();
  });
});

describe("Studio selection restore", () => {
  const restore: SelectionRestore = {
    frameId: "frame",
    ref: entry.afterRef!,
    index: 2,
    afterVersion: 7,
  };
  const document: RestoreDocument = {
    frameId: "frame",
    version: 8,
    currentVersion: 8,
    shown: true,
    ready: true,
    containsRef: true,
  };
  it("matches a new displayed ready version, including a response received after it is showing", () => {
    expect(matchesRestore(restore, document)).toBe(true);
  });
  it.each([
    { version: 7 },
    { version: 9 },
    { currentVersion: 9 },
    { frameId: "other" },
    { shown: false },
    { ready: false },
    { containsRef: false },
  ])("ignores a stale, hidden, unready or unrelated document: %j", (change) => {
    expect(matchesRestore(restore, { ...document, ...change })).toBe(false);
  });
});

describe("Studio shortcut gating", () => {
  const key = {
    key: "z",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  it("suspends shortcuts during frame text editing and while an input has focus", () => {
    expect(shortcutsAllowed(false, false)).toBe(true);
    expect(shortcutsAllowed(true, false)).toBe(false);
    expect(shortcutsAllowed(false, true)).toBe(false);
    expect(shortcutsAllowed(true, true)).toBe(false);
  });
  it("accepts all history shortcuts without needing a source selection", () => {
    expect(editShortcut(key, false)).toEqual({
      type: "history",
      direction: "undo",
    });
    expect(editShortcut({ ...key, shiftKey: true }, false)).toEqual({
      type: "history",
      direction: "redo",
    });
    expect(
      editShortcut({ ...key, key: "y", metaKey: false, ctrlKey: true }, false),
    ).toEqual({ type: "history", direction: "redo" });
  });
  it.each(["Delete", "Backspace", "Enter", "d"])(
    "gives element commands priority only for a source selection: %s",
    (name) => {
      const event = { ...key, key: name, metaKey: name === "d" };
      expect(editShortcut(event, false)).toBeNull();
      expect(editShortcut(event, true)?.type).toBe("command");
    },
  );
  it("preserves modified Enter and ignores Alt combinations", () => {
    expect(editShortcut({ ...key, key: "Enter" }, true)).toBeNull();
    expect(editShortcut({ ...key, altKey: true }, true)).toBeNull();
  });
});
