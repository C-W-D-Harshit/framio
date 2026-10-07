import type { EditCapability } from "../contracts/edits";

export const shortcutsAllowed = (textEditing: boolean, inputFocused: boolean) =>
  !textEditing && !inputFocused;

export const isStudioInput = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  !!target.closest(
    'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
  );

type Key = {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
};
export type EditShortcut =
  | { type: "history"; direction: "undo" | "redo" }
  | {
      type: "command";
      command: "remove" | "duplicate" | "edit-text";
      capability: EditCapability;
    };
export const editShortcut = (
  key: Key,
  sourceSelected: boolean,
): EditShortcut | null => {
  if (key.altKey) return null;
  const mod = key.metaKey || key.ctrlKey;
  const lower = key.key.toLowerCase();
  if (mod && lower === "z")
    return { type: "history", direction: key.shiftKey ? "redo" : "undo" };
  if (key.ctrlKey && !key.metaKey && !key.shiftKey && lower === "y")
    return { type: "history", direction: "redo" };
  if (!sourceSelected) return null;
  if (
    !mod &&
    !key.shiftKey &&
    (key.key === "Delete" || key.key === "Backspace")
  )
    return { type: "command", command: "remove", capability: "remove" };
  if (mod && !key.shiftKey && lower === "d")
    return { type: "command", command: "duplicate", capability: "duplicate" };
  if (!mod && !key.shiftKey && key.key === "Enter")
    return { type: "command", command: "edit-text", capability: "text" };
  return null;
};
