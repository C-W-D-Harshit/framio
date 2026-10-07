import {
  decodeCapabilities,
  decodeLocks,
  SOURCE_ATTRIBUTE,
  type SourceSelection,
} from "../contracts/edits";

export const snapSize = (value: number, shift: boolean): number =>
  shift ? Math.max(1, value) : Math.max(4, Math.round(value / 4) * 4);

export const frameScale = (
  frameWidth: number,
  viewportWidth: number,
): number => {
  const scale = frameWidth / viewportWidth;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

export const sourceSelector = (
  ref: string,
  escape: (value: string) => string,
) => `[${SOURCE_ATTRIBUTE}="${escape(ref)}"]`;

export const sourceAtIndex = <T>(
  matches: readonly T[],
  index: number,
): T | null => matches[index] ?? matches[0] ?? null;

export const selectionPayload = <T>(input: {
  ref: string | null;
  element: T;
  matches: readonly T[];
  edit: string | null;
  lock: string | null;
  hasElementChildren: boolean;
}): SourceSelection | undefined => {
  if (!input.ref) return undefined;
  const allowed = decodeCapabilities(input.edit);
  const locks = decodeLocks(input.lock);
  if (allowed.includes("text") && input.hasElementChildren) {
    allowed.splice(allowed.indexOf("text"), 1);
    if (
      !locks.some(
        (l) => l.capability === "text" && l.reason === "mixed-content",
      )
    )
      locks.push({ capability: "text", reason: "mixed-content" });
  }
  return {
    ref: input.ref,
    index: Math.max(0, input.matches.indexOf(input.element)),
    count: input.matches.length,
    allowed,
    locks,
  };
};

export const singleLineText = (text: string): string =>
  text.replace(/[\r\n]+/g, " ");

export const isQuickEditShortcut = (event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): boolean => {
  if (event.altKey) return false;
  const key = event.key.toLowerCase();
  const mod = event.metaKey || event.ctrlKey;
  return (
    (mod && key === "z") ||
    (event.ctrlKey && !event.metaKey && !event.shiftKey && key === "y") ||
    (mod && !event.shiftKey && key === "d") ||
    (!mod && !event.shiftKey && ["delete", "backspace", "enter"].includes(key))
  );
};

export type DropBox = {
  ref: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type DropLayout = {
  display: string;
  direction: string;
  wrap: string;
};
export type DropTarget = {
  index: number;
  ref: string;
  position: "before" | "after";
  axis: "horizontal" | "vertical";
};

export function dropPosition(
  siblings: readonly DropBox[],
  point: { x: number; y: number },
  layout: DropLayout,
): DropTarget | null {
  if (!siblings.length) return null;
  const flex = layout.display === "flex" || layout.display === "inline-flex";
  const grid = layout.display === "grid" || layout.display === "inline-grid";
  const horizontal = flex && layout.direction.startsWith("row");
  const wrapped = flex && layout.wrap !== "nowrap";
  let index = 0;
  let distance = Infinity;
  let laneDistance = Infinity;
  siblings.forEach((box, i) => {
    const dx = point.x - (box.x + box.width / 2);
    const dy = point.y - (box.y + box.height / 2);
    // Wrapping uses the nearest lane, then the midpoint in that lane.
    const cross = horizontal
      ? Math.max(box.y - point.y, point.y - box.y - box.height, 0)
      : Math.max(box.x - point.x, point.x - box.x - box.width, 0);
    const lane = wrapped && !grid ? cross : 0;
    const next = grid ? dx * dx + dy * dy : Math.abs(horizontal ? dx : dy);
    if (lane < laneDistance || (lane === laneDistance && next < distance)) {
      index = i;
      distance = next;
      laneDistance = lane;
    }
  });
  const anchor = siblings[index]!;
  const axis = grid
    ? point.y < anchor.y || point.y > anchor.y + anchor.height
      ? "vertical"
      : "horizontal"
    : horizontal
      ? "horizontal"
      : "vertical";
  const coordinate = axis === "horizontal" ? point.x : point.y;
  const midpoint =
    axis === "horizontal"
      ? anchor.x + anchor.width / 2
      : anchor.y + anchor.height / 2;
  const reverse = flex && layout.direction.endsWith("reverse");
  const before = reverse ? coordinate > midpoint : coordinate < midpoint;
  return {
    index,
    ref: anchor.ref,
    position: before ? "before" : "after",
    axis,
  };
}

export function changesOrder<T>(
  siblings: readonly T[],
  element: T,
  anchor: T,
  position: "before" | "after",
): boolean {
  if (
    element === anchor ||
    !siblings.includes(element) ||
    !siblings.includes(anchor)
  )
    return false;
  const next = siblings.filter((sibling) => sibling !== element);
  next.splice(
    next.indexOf(anchor) + (position === "after" ? 1 : 0),
    0,
    element,
  );
  return next.some((sibling, index) => sibling !== siblings[index]);
}
