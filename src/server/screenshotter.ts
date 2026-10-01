import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { ensureBrowser } from "../lib/browser";
import type { Frame } from "./project";

const IDLE_CLOSE_MS = 5 * 60_000;

/** Keeps one headless browser warm so repeated agent screenshots are fast. */
export class Screenshotter {
  private browser: Promise<Browser> | null = null;
  private idleTimer: Timer | null = null;

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

  async capture(frame: Frame, out: string, scale = 1) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
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
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    if (b) await (await b.catch(() => null))?.close().catch(() => {});
  }
}
