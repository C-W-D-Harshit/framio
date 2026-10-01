import { afterAll, beforeAll, expect, test } from "bun:test";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { ensureBrowser } from "../src/lib/browser";
import { FRAME_CSS } from "../src/runtime/frame-style";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(async () => {
  const runtime = await Bun.build({ entrypoints: [new URL("../src/runtime/runtime.ts", import.meta.url).pathname], target: "browser", format: "iife" });
  if (!runtime.success) throw new Error(runtime.logs.map(String).join("\n"));
  const script = await runtime.outputs[0]!.text();
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/_runtime.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/api/frame-status") return Response.json({ ok: true });
      if (url.pathname === "/") return new Response('<iframe src="/frame?canvas=1" style="width:390px;height:844px;border:0"></iframe>', { headers: { "content-type": "text/html" } });
      return new Response(`<!doctype html><html><head><style>
        html { overflow-y: scroll; scrollbar-gutter: stable; }
        body { margin: 0; }
        #root { height: 100px; }
        .content { height: 900px; }
        .scroll-box { box-sizing: border-box; width: 240px; height: 120px; border: 4px solid; overflow: auto; scrollbar-gutter: stable; }
        .long { width: 400px; height: 400px; }
        </style><style>${FRAME_CSS}</style>
        <script>window.__FRAMIO_BOOT__={id:'test/overflow',canvas:${url.searchParams.has("canvas")},error:null}</script>
        <script src="/_runtime.js"></script></head>
        <body><div id="root"><div class="content"><div class="scroll-box"><div class="long">Scrollable content</div></div></div></div></body></html>`, { headers: { "content-type": "text/html" } });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
  // Do not use Chromium's --hide-scrollbars: the frame stylesheet must handle this itself.
  browser = await puppeteer.launch({ executablePath: await ensureBrowser(), headless: true });
}, 120_000);

afterAll(async () => { await browser?.close(); server?.stop(true); });

async function withCanvas(check: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl);
    await page.waitForFunction("document.querySelector('iframe').contentWindow.__framio?.ready");
    await check(page);
  } finally { await page.close(); }
}

test("canvas frames remove document and nested scrollbar gutters without disabling scrolling", () => withCanvas(async page => {
  const result = await page.evaluate(() => {
    const iframe = document.querySelector("iframe")!;
    const doc = iframe.contentDocument!;
    const win = iframe.contentWindow!;
    const box = doc.querySelector<HTMLElement>(".scroll-box")!;
    box.scrollTop = 40;
    box.scrollLeft = 30;
    let forwarded = 0;
    iframe.addEventListener("wheel", () => forwarded++);
    const wheel = new (win as Window & typeof globalThis).WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 });
    box.dispatchEvent(wheel);
    return {
      viewport: win.innerWidth, contentWidth: doc.documentElement.clientWidth,
      boxWidth: box.clientWidth, boxHeight: box.clientHeight,
      scrollTop: box.scrollTop, scrollLeft: box.scrollLeft,
      forwarded, prevented: wheel.defaultPrevented,
    };
  });
  expect(result).toEqual({ viewport: 390, contentWidth: 390, boxWidth: 232, boxHeight: 112, scrollTop: 40, scrollLeft: 30, forwarded: 1, prevented: true });
}), 30_000);

test("frame measurement includes content overflowing a fixed-height root", () => withCanvas(async page => {
  const height = await page.evaluate(() => (document.querySelector("iframe")!.contentWindow as Window & { __framio: { contentHeight(): number } }).__framio.contentHeight());
  expect(height).toBe(900);
}), 30_000);
