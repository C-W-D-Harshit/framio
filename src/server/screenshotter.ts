import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { ensureBrowser } from "../lib/browser";
import type { Frame } from "./project";

const IDLE_CLOSE_MS = 5 * 60_000;
const MAX_PARALLEL = 4;
/** Whole-page screenshots are scaled down to stay readable for agents without huge images. */
const PAGE_MAX_WIDTH = 3200;

export type PageShotFrame = {
  id: string;
  name: string;
  parent: string | null;
  width: number;
  height: number;
  src: string | null;
};

/** Keeps one headless browser warm so repeated agent screenshots and thumbnails are fast. */
export class Screenshotter {
  private browser: Promise<Browser> | null = null;
  private idleTimer: Timer | null = null;
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private baseUrl: string) {}

  private async getBrowser() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
    this.browser ??= ensureBrowser().then((executablePath) =>
      puppeteer.launch({ executablePath, headless: true, args: ["--hide-scrollbars"] }),
    );
    try {
      return await this.browser;
    } catch (err) {
      this.browser = null;
      throw err;
    }
  }

  private async withPage<T>(fn: (page: Awaited<ReturnType<Browser["newPage"]>>) => Promise<T>) {
    if (this.active >= MAX_PARALLEL) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      const page = await (await this.getBrowser()).newPage();
      try {
        return await fn(page);
      } finally {
        await page.close().catch(() => {});
      }
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  capture(frame: Frame, out: string, scale = 1) {
    return this.withPage(async (page) => {
      const { width, height } = frame.meta;
      await page.setViewport({ width, height, deviceScaleFactor: scale });
      await page.goto(`${this.baseUrl}/f/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}`);
      await page.waitForFunction("window.__framio && (window.__framio.ready || window.__framio.error)", {
        timeout: 20_000,
      });
      const state = (await page.evaluate(
        "({ error: window.__framio.error, height: window.__framio.contentHeight() })",
      )) as { error: string | null; height: number };
      const fullHeight = Math.max(1, Math.ceil(state.height || height));
      await page.setViewport({ width, height: fullHeight, deviceScaleFactor: scale });
      await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      mkdirSync(dirname(out), { recursive: true });
      await page.screenshot({ path: out as `${string}.png` });
      return { path: out, width, height: fullHeight, error: state.error };
    });
  }

  /** Renders already-captured frame screenshots at their canvas positions, with labels and variation lines. */
  composePage(frames: PageShotFrame[], positions: Record<string, { x: number; y: number }>, out: string, scale = 1) {
    return this.withPage(async (page) => {
      const PAD = 80;
      const LABEL = 56;
      const boxes = frames.map((f) => ({ ...f, ...positions[f.id]! }));
      const minX = Math.min(...boxes.map((b) => b.x));
      const minY = Math.min(...boxes.map((b) => b.y));
      const width = Math.ceil(Math.max(...boxes.map((b) => b.x + b.width)) - minX + PAD * 2);
      const height = Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)) - minY + PAD * 2 + LABEL);
      const s = Math.min(scale, PAGE_MAX_WIDTH / width);
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
            ? `<img src="${this.baseUrl}${b.src}" style="display:block;width:${px(b.width)};height:${px(b.height)}">`
            : `<div style="width:${px(b.width)};height:${px(b.height)};background:#3a1d1d"></div>`;
          return `<div style="position:absolute;left:${px(x)};top:${px(y)}">
            <div style="position:absolute;bottom:100%;left:0;padding-bottom:${px(font * 0.5)};font:500 ${px(font)} system-ui,sans-serif;color:#d4d4d4;white-space:nowrap">${esc(b.name)}</div>
            ${body}</div>`;
        })
        .join("");

      await page.setViewport({ width, height, deviceScaleFactor: s });
      await page.setContent(
        `<!doctype html><html><body style="margin:0;width:${px(width)};height:${px(height)};background:#262626;position:relative">
        <svg width="${width}" height="${height}" style="position:absolute;inset:0">${lines}</svg>${items}</body></html>`,
        { waitUntil: "load" },
      );
      mkdirSync(dirname(out), { recursive: true });
      await page.screenshot({ path: out as `${string}.png` });
      return { path: out, width: Math.round(width * s), height: Math.round(height * s) };
    });
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    if (b) await (await b.catch(() => null))?.close().catch(() => {});
  }
}
