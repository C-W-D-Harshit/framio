import type { SnapshotFrame } from "../contracts/snapshot";

type Pos = { x: number; y: number };

const GAP_X = 160;
const GAP_Y = 200;

/**
 * Variations grow to the right of their parent; independent screens stack downward.
 * Saved positions win. A frame without a saved position keeps its auto offset relative
 * to its parent, so a new variation of a moved frame still lands next to it.
 */
export function layoutFrames(
  frames: readonly SnapshotFrame[],
  heights: Record<string, number>,
  saved: Record<string, Pos>,
): Record<string, Pos> {
  const byId = new Map(frames.map((f) => [f.id, f]));
  const children = new Map<string, SnapshotFrame[]>();
  const roots: SnapshotFrame[] = [];
  for (const f of frames) {
    if (f.parent && byId.has(f.parent)) {
      const list = children.get(f.parent) ?? [];
      list.push(f);
      children.set(f.parent, list);
    } else roots.push(f);
  }

  const h = (f: SnapshotFrame) => heights[f.id] ?? f.meta.height;
  const subtreeHeight = new Map<string, number>();
  const measure = (f: SnapshotFrame): number => {
    const kids = children.get(f.id) ?? [];
    const kidsHeight = kids.reduce(
      (sum, k, i) => sum + measure(k) + (i ? GAP_Y : 0),
      0,
    );
    const total = Math.max(h(f), kidsHeight);
    subtreeHeight.set(f.id, total);
    return total;
  };

  const auto: Record<string, Pos> = {};
  const place = (f: SnapshotFrame, x: number, y: number) => {
    auto[f.id] = { x, y };
    let cy = y;
    for (const k of children.get(f.id) ?? []) {
      place(k, x + f.meta.width + GAP_X, cy);
      cy += subtreeHeight.get(k.id)! + GAP_Y;
    }
  };
  if (children.size === 0 && roots.length > 3) {
    // No variations at all (e.g. a moodboard): a grid reads better than one tall column.
    const cols = Math.min(4, Math.ceil(Math.sqrt(roots.length)));
    const colWidth = Math.max(...roots.map((r) => r.meta.width)) + GAP_X;
    let y = 0;
    for (let i = 0; i < roots.length; i += cols) {
      const row = roots.slice(i, i + cols);
      row.forEach((r, c) => {
        measure(r);
        place(r, c * colWidth, y);
      });
      y += Math.max(...row.map(h)) + GAP_Y;
    }
  } else {
    let y = 0;
    for (const r of roots) {
      measure(r);
      place(r, 0, y);
      y += subtreeHeight.get(r.id)! + GAP_Y;
    }
  }

  const final: Record<string, Pos> = {};
  const resolve = (f: SnapshotFrame) => {
    const own = saved[f.slug];
    const parent = f.parent ? byId.get(f.parent) : undefined;
    if (own) final[f.id] = own;
    else if (parent && final[parent.id]) {
      const pa = auto[parent.id]!;
      const pf = final[parent.id]!;
      final[f.id] = {
        x: pf.x + auto[f.id]!.x - pa.x,
        y: pf.y + auto[f.id]!.y - pa.y,
      };
    } else final[f.id] = auto[f.id]!;
    for (const k of children.get(f.id) ?? []) resolve(k);
  };
  roots.forEach(resolve);
  return final;
}
