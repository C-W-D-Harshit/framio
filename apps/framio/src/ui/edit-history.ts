import type { SourcePatch, SourceRef } from "../contracts/edits";

export type EditEntry = {
  readonly frameId: string;
  readonly label: string;
  readonly undo: SourcePatch;
  readonly beforeRef: SourceRef;
  readonly beforeIndex: number;
  readonly afterRef: SourceRef | null;
  readonly afterIndex: number;
};
export type RedoEntry = EditEntry & { readonly redo: SourcePatch };
export type EditHistory = {
  readonly undo: readonly EditEntry[];
  readonly redo: readonly RedoEntry[];
};
export const emptyHistory: EditHistory = { undo: [], redo: [] };
const bounded = <A>(entries: readonly A[]) => entries.slice(-100);
export const pushEdit = (
  history: EditHistory,
  entry: EditEntry,
): EditHistory => ({
  undo: bounded([...history.undo, entry]),
  redo: [],
});
export const finishUndo = (
  history: EditHistory,
  inverse: SourcePatch,
): EditHistory => {
  const entry = history.undo.at(-1);
  return entry
    ? {
        undo: history.undo.slice(0, -1),
        redo: bounded([...history.redo, { ...entry, redo: inverse }]),
      }
    : history;
};
export const finishRedo = (
  history: EditHistory,
  inverse: SourcePatch,
): EditHistory => {
  const entry = history.redo.at(-1);
  if (!entry) return history;
  const { redo: _, ...original } = entry;
  return {
    undo: bounded([...history.undo, { ...original, undo: inverse }]),
    redo: history.redo.slice(0, -1),
  };
};
export const dropConflict = (
  history: EditHistory,
  direction: "undo" | "redo",
): EditHistory => ({
  ...history,
  [direction]: history[direction].slice(0, -1),
});
