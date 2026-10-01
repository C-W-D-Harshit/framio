import { Policies } from "../domain/policies";

export type PageShotFrame = {
  id: string;
  name: string;
  parent: string | null;
  width: number;
  height: number;
  src: string | null;
  note?: string;
};

export function composePageHtml(baseUrl: string, frames: readonly PageShotFrame[], positions: Record<string, { x: number; y: number }>, scale: number) {
      const PAD = 80;
      const LABEL = 56;
      const NOTE = 160;
      const boxes = frames.map((f) => ({ ...f, ...positions[f.id]! }));
      const minX = Math.min(...boxes.map((b) => b.x));
      const minY = Math.min(...boxes.map((b) => b.y));
      const width = Math.ceil(Math.max(...boxes.map((b) => b.x + b.width)) - minX + PAD * 2);
      const hasNotes = boxes.some((b) => b.note);
      const height = Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)) - minY + PAD * 2 + LABEL + (hasNotes ? NOTE : 0));
      const s = Math.min(scale, Policies.pageMaxWidth / width);
      const px = (n: number) => `${Math.round(n)}px`;
      const at = (b: (typeof boxes)[number]) => ({ x: b.x - minX + PAD, y: b.y - minY + PAD + LABEL });
      const byId = new Map(boxes.map((b) => [b.id, b]));
      const font = Math.max(28, 15 / s);
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

      const lines = boxes
        .filter((b) => b.parent && byId.has(b.parent))
        .map((b) => {
          const pa = byId.get(b.parent!)!;
          const a = at(pa);
          const c = at(b);
          const [x1, y1, x2, y2] = [a.x + pa.width, a.y + Math.min(pa.height, 900) / 2, c.x, c.y + Math.min(b.height, 900) / 2];
          const mx = (x1 + x2) / 2;
          return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#7a7a7a" stroke-width="${2 / s}" stroke-dasharray="${8 / s} ${6 / s}"/>`;
        })
        .join("");

      const items = boxes
        .map((b) => {
          const { x, y } = at(b);
          const body = b.src
            ? `<img src="${baseUrl}${b.src}" style="display:block;width:${px(b.width)};height:${px(b.height)}">`
            : `<div style="width:${px(b.width)};height:${px(b.height)};background:#3a1d1d"></div>`;
          return `<div style="position:absolute;left:${px(x)};top:${px(y)}">
            <div style="position:absolute;bottom:100%;left:0;padding-bottom:${px(font * 0.5)};font:500 ${px(font)} system-ui,sans-serif;color:#d4d4d4;white-space:nowrap">${esc(b.name)}</div>
            ${body}
            ${b.note ? `<div style="position:absolute;top:100%;left:0;width:${px(b.width)};padding-top:${px(font * 0.5)};font:400 ${px(font * 0.85)}/1.4 system-ui,sans-serif;color:#a3a3a3">${esc(b.note)}</div>` : ""}
            </div>`;
        })
        .join("");

  return { width, height, scale: s, html: `<!doctype html><html><body style="margin:0;width:${px(width)};height:${px(height)};background:#262626;position:relative"><svg width="${width}" height="${height}" style="position:absolute;inset:0">${lines}</svg>${items}</body></html>` };
}
