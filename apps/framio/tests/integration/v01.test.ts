import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import puppeteer from "puppeteer-core";
import { ensureBrowser } from "../../src/lib/browser";
import { runServer } from "../../src/server/server";
import type { LayerReport } from "../../src/contracts/layers";
import { imageSize } from "../../src/server/image-size";

const source = (title = "Invoice overview", margin = 40) =>
  `export const meta={name:"Invoices",widths:[1440,768,390],height:900};export default function Frame(){return <main data-layer="Content" style={{padding:${margin}, minHeight:"100vh",background:"#f7f5f2"}}><h1 data-layer="Heading" style={{fontSize:32}}>${title}</h1><p>Responsive test fixture</p></main>}`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "framio-v01-"));
  mkdirSync(join(root, ".framio/pages/01-test"), { recursive: true });
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(root, ".framio/node_modules"),
  );
  writeFileSync(
    join(root, ".framio/theme.css"),
    "* { box-sizing: border-box; } body { margin: 0; }",
  );
  writeFileSync(join(root, ".framio/pages/01-test/invoices.tsx"), source());
  return root;
}
const json = (root: string, file = "comments.json") =>
  JSON.parse(readFileSync(join(root, ".framio", file), "utf8"));
async function waitUntil(check: () => boolean | Promise<boolean>) {
  const until = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > until)
      throw new Error("Timed out waiting for observable state");
    await Bun.sleep(40);
  }
}
const post = async (url: string, path: string, payload: unknown) => {
  const response = await fetch(`${url}/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(payload),
  });
  expect(response.status).toBe(200);
  return response.json();
};

test("URL handoff, compare, imports, and responsive captures render actual PNGs", async () => {
  const root = fixture();
  const app = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      if (new URL(request.url).pathname.endsWith(".png"))
        return new Response("Missing image", { status: 404 });
      return new Response(
        '<html><body style="margin:0;height:1300px;background:#336699"><h1>Real implementation</h1><img src="/missing.png" width="10" height="10"><img loading="lazy" src="/lazy.png" width="10" height="10" style="position:absolute;top:1200px"></body></html>',
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            const url = `http://127.0.0.1:${app.port}`;
            const result = await post(info.url, "screenshot", {
              url,
              width: 390,
              height: 844,
              scale: 2,
              compare: "01-test/invoices",
              into: "02-before",
            });
            expect(result.results).toHaveLength(4);
            for (const shot of result.results) {
              expect(shot.error ?? null).toBeNull();
              expect(existsSync(shot.path)).toBe(true);
            }
            expect(
              imageSize(
                new Uint8Array(readFileSync(result.results[0].path)),
                "png",
              ),
            ).toEqual({ width: 780, height: 2600 });
            expect(
              imageSize(
                new Uint8Array(readFileSync(result.results[2].path)),
                "png",
              ),
            ).toEqual({ width: 1656, height: 2728 });
            expect(
              json(
                root,
                `pages/02-before/${result.results[3].path.split("/").pop()}.json`,
              ),
            ).toMatchObject({
              source: url,
              note: "Current app captured before redesign",
              width: 390,
            });
            const responsive = await post(info.url, "screenshot", {
              frames: ["01-test/invoices"],
            });
            expect(
              responsive.results.map((shot: { path: string }) =>
                shot.path.split("/").pop(),
              ),
            ).toEqual([
              "invoices@1440.png",
              "invoices@768.png",
              "invoices@390.png",
            ]);
            expect(
              responsive.results.map(
                (shot: { report: LayerReport }) => shot.report.width,
              ),
            ).toEqual([1440, 768, 390]);
            for (const [i, width] of [1440, 768, 390].entries())
              expect(
                imageSize(
                  new Uint8Array(readFileSync(responsive.results[i].path)),
                  "png",
                ),
              ).toEqual({ width, height: [900, 1024, 844][i]! });
            const single = await post(info.url, "screenshot", {
              frames: ["01-test/invoices"],
              width: 600,
            });
            expect(single.results).toHaveLength(1);
            expect(single.results[0].path).toEndWith("invoices@600.png");
            expect(
              imageSize(
                new Uint8Array(readFileSync(single.results[0].path)),
                "png",
              ),
            ).toEqual({ width: 600, height: 1024 });
            const page = await post(info.url, "screenshot", {
              page: "01-test",
            });
            expect(page.results[0].error ?? null).toBeNull();
            expect(
              imageSize(
                new Uint8Array(readFileSync(page.results[0].path)),
                "png",
              )!.width,
            ).toBe(2918);
            for (const width of [1440, 390]) {
              const response = await fetch(
                `${info.url}/thumb/01-test/invoices.png?width=${width}`,
              );
              expect(response.status).toBe(200);
              expect(
                imageSize(new Uint8Array(await response.arrayBuffer()), "png")!
                  .width,
              ).toBe(width / 2);
            }
            const snapshot = await fetch(`${info.url}/api/project`).then(
              (response) => response.json(),
            );
            await post(info.url, "frame-status", {
              id: "01-test/invoices",
              width: 390,
              version: snapshot.pages[0].frames[0].version,
              error: "Mobile-only diagnostic",
            });
            await waitUntil(() =>
              json(root, ".state/errors.json").errors.some(
                (error: { width: number; message: string }) =>
                  error.width === 390 &&
                  error.message === "Mobile-only diagnostic",
              ),
            );
            const updated = await fetch(`${info.url}/api/project`).then(
              (response) => response.json(),
            );
            expect(updated.pages[0].frames[0].viewportErrors).toEqual({
              "390": "Mobile-only diagnostic",
            });
            expect(updated.pages[0].frames[0].error).toBeNull();
            for (const width of [1440, 390])
              await post(info.url, "frame-status", {
                id: "01-test/invoices",
                width,
                version: snapshot.pages[0].frames[0].version,
                error: null,
                warnings: [{ path: "Content", message: `Warning at ${width}` }],
              });
            await waitUntil(() =>
              [1440, 390].every((width) =>
                json(root, ".state/errors.json").warnings.some(
                  (warning: {
                    frame: string;
                    width: number;
                    message: string;
                  }) =>
                    warning.frame === "01-test/invoices" &&
                    warning.width === width &&
                    warning.message === `Warning at ${width}`,
                ),
              ),
            );
            await post(info.url, "frame-status", {
              id: "01-test/invoices",
              width: 390,
              version: snapshot.pages[0].frames[0].version - 1,
              error: null,
              warnings: [{ path: "", message: "Stale warning" }],
            });
            expect(
              json(root, ".state/errors.json").warnings.some(
                (warning: { message: string }) =>
                  warning.message === "Stale warning",
              ),
            ).toBe(false);

            expect(
              (await fetch(`${info.url}/f/01-test/invoices?width=0`)).status,
            ).toBe(400);
            app.stop(true);
            const unreachable = await post(info.url, "screenshot", { url });
            expect(unreachable.results[0].error).toContain("Could not capture");
            expect(unreachable.results[0].error).toContain(url);
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    app.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);

test("image width captures and thumbnails preserve the source aspect ratio", async () => {
  const root = fixture();
  writeFileSync(
    join(root, ".framio/pages/01-test/portrait.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="400"><rect width="200" height="400" fill="red"/></svg>',
  );
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            const result = await post(info.url, "screenshot", {
              frames: ["01-test/portrait.svg"],
              width: 100,
            });
            expect(result.results[0].error).toBeNull();
            expect(
              imageSize(
                new Uint8Array(readFileSync(result.results[0].path)),
                "png",
              ),
            ).toEqual({ width: 100, height: 200 });
            const thumbnail = await fetch(
              `${info.url}/thumb/01-test/portrait.svg.png?width=100`,
            );
            expect(thumbnail.status).toBe(200);
            expect(
              imageSize(new Uint8Array(await thumbnail.arrayBuffer()), "png"),
            ).toEqual({ width: 50, height: 100 });
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("comments round trip UI and agent edits, pins follow layout, viewport groups move and select", async () => {
  const root = fixture();
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const executablePath = yield* ensureBrowser();
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            const browser = await puppeteer.launch({
              executablePath,
              headless: true,
            });
            try {
              const page = await browser.newPage();
              await page.setViewport({ width: 1600, height: 1000 });
              await page.goto(info.url);
              await page.waitForSelector(
                'iframe[data-frame="__viewport__/01-test/invoices/390"]',
              );
              await page.waitForFunction(() =>
                [
                  ...document.querySelectorAll<HTMLIFrameElement>("iframe"),
                ].every((f) => f.contentWindow?.__framio?.ready),
              );
              expect(
                await page.$$eval(".react-flow__node", (nodes) => nodes.length),
              ).toBe(3);
              // Studio chrome keeps the canvas unobstructed and persists its own theme.
              expect(await page.$("main > header")).toBeNull();
              expect(
                await page.$eval(
                  '[data-slot="sidebar-footer"]',
                  (element) => element.textContent,
                ),
              ).toContain("Powered by Framio");
              await page.click('[role="switch"][aria-label="Dark theme"]');
              await page.waitForFunction(
                () => document.documentElement.dataset.theme === "light",
              );
              expect(
                await page.$eval(
                  '[aria-label="Project navigation"] [data-slot="sidebar-inner"]',
                  (element) => getComputedStyle(element).backgroundColor,
                ),
              ).toBe("rgb(255, 255, 255)");
              await page.reload();
              await page.waitForFunction(
                () => document.documentElement.dataset.theme === "light",
              );
              await page.click('[role="switch"][aria-label="Dark theme"]');
              await page.waitForFunction(
                () => document.documentElement.dataset.theme === "dark",
              );
              await page.waitForFunction(() =>
                [
                  ...document.querySelectorAll<HTMLIFrameElement>(
                    "iframe[data-frame]",
                  ),
                ].every((frame) => frame.contentWindow?.__framio?.ready),
              );
              // Studio chrome uses flat tool controls and a keyboard-accessible frame finder.
              expect(
                await page.$eval(
                  'button[aria-label="Hand"]',
                  (button) => getComputedStyle(button).borderTopWidth,
                ),
              ).toBe("0px");
              await page.click('button[aria-label="Find a frame"]');
              await page.waitForSelector('[role="dialog"] [cmdk-input]');
              await page.type("[cmdk-input]", "Invoices");
              await page.keyboard.press("Enter");
              await page.waitForFunction(
                () => !document.querySelector('[role="dialog"]'),
              );
              await waitUntil(
                () =>
                  existsSync(join(root, ".framio/.state/selection.json")) &&
                  json(root, ".state/selection.json").frames.some(
                    (frame: { frame: string }) =>
                      frame.frame === "01-test/invoices",
                  ),
              );
              const frame = page
                .frames()
                .find((f) => f.url().includes("width=390"))!;
              const clickHeading = async (offset = 20) => {
                await page.waitForFunction(() => {
                  const iframe = document.querySelector<HTMLIFrameElement>(
                    'iframe[data-frame="__viewport__/01-test/invoices/390"]',
                  );
                  return (
                    !document.documentElement.classList.contains(
                      "is-navigating",
                    ) && iframe?.contentWindow?.__framio?.ready
                  );
                });
                // Panel resizing and finder navigation animate the viewport. Click only
                // after its geometry settles, so this reaches the intended element.
                await page.evaluate(
                  () =>
                    new Promise<void>((resolve) => {
                      let previous = "",
                        stable = 0;
                      const sample = () => {
                        const rect = document
                          .querySelector(
                            'iframe[data-frame="__viewport__/01-test/invoices/390"]',
                          )!
                          .getBoundingClientRect();
                        const next = [
                          rect.x,
                          rect.y,
                          rect.width,
                          rect.height,
                        ].join(",");
                        stable = next === previous ? stable + 1 : 0;
                        previous = next;
                        if (stable >= 20) resolve();
                        else requestAnimationFrame(sample);
                      };
                      requestAnimationFrame(sample);
                    }),
                );
                const at = await page.evaluate((offset) => {
                  const iframe = document.querySelector<HTMLIFrameElement>(
                    'iframe[data-frame="__viewport__/01-test/invoices/390"]',
                  )!;
                  const box = iframe.getBoundingClientRect(),
                    rect = iframe
                      .contentDocument!.querySelector("h1")!
                      .getBoundingClientRect();
                  const z = box.width / iframe.offsetWidth;
                  return {
                    x: box.x + (rect.x + offset) * z,
                    y: box.y + (rect.y + 12) * z,
                  };
                }, offset);
                await page.mouse.click(at.x, at.y);
              };
              await page.click('button[aria-label="Select"]');
              await clickHeading();
              await page.waitForSelector(
                '[role="treeitem"][aria-selected="true"]',
              );
              expect(await page.$('[aria-label="Agent selection"]')).toBeNull();
              // Layer inspection and feedback share one right-side panel slot.
              await page.waitForSelector(
                '[role="treeitem"][aria-selected="true"]',
              );
              const readViewport = () =>
                page.$eval(".react-flow__viewport", (element) => {
                  const matrix = new DOMMatrix(
                    getComputedStyle(element).transform,
                  );
                  return { x: matrix.e, y: matrix.f, zoom: matrix.a };
                });
              const beforeInspect = await readViewport();
              await page.click(
                '[role="treeitem"][aria-selected="true"] button:last-child',
              );
              await page.waitForSelector('[aria-label="Layer inspection"]');
              await page.evaluate(
                () =>
                  new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve()),
                    ),
                  ),
              );
              expect(await readViewport()).toEqual(beforeInspect);
              expect(await page.$('[aria-label="Comments"]')).toBeNull();
              await page.click('button[aria-label="Close layer inspection"]');
              await page.waitForSelector('[aria-label="Layer inspection"]', {
                hidden: true,
              });
              await page.evaluate(
                () =>
                  new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve()),
                    ),
                  ),
              );
              expect(await readViewport()).toEqual(beforeInspect);
              await page.click(
                '[role="treeitem"][aria-selected="true"] button:last-child',
              );
              await page.waitForSelector('[aria-label="Layer inspection"]');
              expect(
                await page.$('button[aria-label="Comments panel"]'),
              ).toBeNull();
              await page.click('button[aria-label="Comment"]');
              await page.waitForSelector('[aria-label="Comments"]');
              await page.evaluate(
                () =>
                  new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve()),
                    ),
                  ),
              );
              expect(await readViewport()).toEqual(beforeInspect);
              expect(
                await page.$('[aria-label="Layer inspection"]'),
              ).toBeNull();
              // Fit is deliberate here to reveal every viewport before creating feedback.
              await page.click('button[aria-label="Fit all frames"]');
              await page.click('button[aria-label="Comment"]');
              await clickHeading();
              await page.waitForSelector('textarea[aria-label="New comment"]');
              await page.type(
                'textarea[aria-label="New comment"]',
                "Discard this draft",
              );
              const emptyCanvas = (await (await page.$(
                ".react-flow__pane",
              ))!.boundingBox())!;
              await page.mouse.click(emptyCanvas.x + 10, emptyCanvas.y + 10);
              await page.waitForSelector(
                'button[aria-label="Select"][aria-pressed="true"]',
              );
              await page.waitForSelector('textarea[aria-label="New comment"]', {
                hidden: true,
              });
              await waitUntil(
                () =>
                  json(root, ".state/selection.json").frames.length === 0 &&
                  json(root, ".state/selection.json").element === null,
              );
              expect(
                await page.$(
                  'button[aria-label="Comment"][aria-pressed="true"]',
                ),
              ).toBeNull();
              await page.click('button[aria-label="Comment"]');
              await clickHeading();
              await page.waitForSelector('textarea[aria-label="New comment"]');
              expect(
                await page.$eval(
                  'textarea[aria-label="New comment"]',
                  (element) => (element as HTMLTextAreaElement).value,
                ),
              ).toBe("");
              await page.type(
                'textarea[aria-label="New comment"]',
                "Shorten this heading",
              );
              await page.reload({ waitUntil: "networkidle0" });
              await page.waitForSelector('textarea[aria-label="New comment"]');
              expect(
                await page.$eval(
                  'textarea[aria-label="New comment"]',
                  (element) => (element as HTMLTextAreaElement).value,
                ),
              ).toBe("Shorten this heading");
              expect(
                existsSync(join(root, ".framio/comments.json")) &&
                  json(root).comments.some(
                    (comment: { body: string }) =>
                      comment.body === "Shorten this heading",
                  ),
              ).toBe(false);
              await page.focus('textarea[aria-label="New comment"]');
              await page.keyboard.press("Enter");
              await waitUntil(
                () =>
                  existsSync(join(root, ".framio/comments.json")) &&
                  json(root).comments.length === 1,
              );
              const comment = json(root).comments[0];
              expect(comment.anchor.selector).toContain("h1");
              expect(comment.author).toBe("user");
              await page.waitForSelector(`[data-comment-pin="${comment.id}"]`);
              await page.click('button[aria-label="Select"]');
              await page.click(
                `[data-id="__viewport__/01-test/invoices/390"] [data-comment-pin="${comment.id}"]`,
              );
              await page.waitForSelector('textarea[aria-label="Reply"]');
              await page.type('textarea[aria-label="Reply"]', "Keep it clear");
              await page.reload({ waitUntil: "networkidle0" });
              await page.waitForSelector('textarea[aria-label="Reply"]');
              expect(
                await page.$eval(
                  'textarea[aria-label="Reply"]',
                  (element) => (element as HTMLTextAreaElement).value,
                ),
              ).toBe("Keep it clear");
              expect(json(root).comments[0].replies).toHaveLength(0);
              await page.focus('textarea[aria-label="Reply"]');
              await page.keyboard.press("Enter");
              await waitUntil(
                () => json(root).comments[0].replies.length === 1,
              );
              const agent = json(root);
              agent.comments[0].replies.push({
                author: "agent",
                body: "Changed the heading",
                createdAt: new Date().toISOString(),
              });
              writeFileSync(
                join(root, ".framio/comments.json"),
                JSON.stringify(agent),
              );
              await page.waitForFunction(() =>
                document.body.textContent?.includes("Changed the heading"),
              );
              // An anchored pin follows source-driven layout changes after an iframe swap.
              writeFileSync(
                join(root, ".framio/pages/01-test/invoices.tsx"),
                source("Updated invoice overview", 80),
              );
              await page.waitForFunction(() =>
                [
                  ...document.querySelectorAll<HTMLIFrameElement>(
                    "iframe[data-frame]",
                  ),
                ]
                  .filter((f) => f.style.visibility !== "hidden")
                  .every(
                    (f) =>
                      f.contentDocument?.querySelector("h1")?.textContent ===
                      "Updated invoice overview",
                  ),
              );
              await waitUntil(async () =>
                page.evaluate((anchor) => {
                  const iframe = document.querySelector<HTMLIFrameElement>(
                    'iframe[data-frame="__viewport__/01-test/invoices/1440"]',
                  )!;
                  const rect = iframe
                    .contentDocument!.querySelector(anchor.selector)!
                    .getBoundingClientRect();
                  const box = iframe.getBoundingClientRect(),
                    z = box.width / iframe.offsetWidth;
                  const pin = document
                    .querySelector(
                      '[data-id="__viewport__/01-test/invoices/1440"] [data-comment-pin]',
                    )!
                    .getBoundingClientRect();
                  return (
                    Math.abs(
                      (pin.x + pin.width / 2 - box.x) / z - rect.x - anchor.x,
                    ) < 0.5 &&
                    Math.abs(
                      (pin.y + pin.height / 2 - box.y) / z - rect.y - anchor.y,
                    ) < 0.5
                  );
                }, comment.anchor),
              );
              const pinWidth = () =>
                page.$eval(
                  `[data-comment-pin="${comment.id}"]`,
                  (el) => el.getBoundingClientRect().width,
                );
              expect(await pinWidth()).toBeCloseTo(28, 0);
              await page.click('button[aria-label="Zoom in"]');
              await page.click('button[aria-label="Zoom in"]');
              await waitUntil(
                async () => Math.abs((await pinWidth()) - 28) < 0.1,
              );
              await page.click('button[aria-label="Zoom out"]');
              await waitUntil(
                async () => Math.abs((await pinWidth()) - 28) < 0.1,
              );
              await page.evaluate(() =>
                [...document.querySelectorAll("button")]
                  .find((b) => b.textContent === "Resolve")!
                  .click(),
              );
              await waitUntil(
                () => json(root).comments[0].status === "resolved",
              );
              await page.waitForFunction(
                () =>
                  document.querySelectorAll("[data-comment-pin]").length === 0,
              );
              await page.click('button[aria-label="Comment filter"]');
              await page.waitForSelector(
                '[role="menuitemradio"][aria-label="Resolved comments"]',
              );
              await page.click(
                '[role="menuitemradio"][aria-label="Resolved comments"]',
              );
              await page.waitForSelector("[data-comment-pin]");
              await page.evaluate(() =>
                [...document.querySelectorAll("button")]
                  .find((b) => b.textContent === "Reopen")!
                  .click(),
              );
              await waitUntil(() => json(root).comments[0].status === "open");
              // Broken agent edits are reported without destructive fallback writes.
              writeFileSync(join(root, ".framio/comments.json"), "{broken");
              await page.waitForFunction(() =>
                document.body.textContent?.includes("comments.json:"),
              );
              await waitUntil(
                () =>
                  existsSync(join(root, ".framio/.state/errors.json")) &&
                  json(root, ".state/errors.json").errors.some(
                    (e: { kind: string }) => e.kind === "comments",
                  ),
              );
              const rejected = await post(info.url, "comments", {
                type: "reply",
                id: comment.id,
                reply: {
                  author: "user",
                  body: "Must not destroy broken data",
                  createdAt: new Date().toISOString(),
                },
              });
              expect(rejected.ok).toBe(false);
              expect(
                readFileSync(join(root, ".framio/comments.json"), "utf8"),
              ).toBe("{broken");
              writeFileSync(
                join(root, ".framio/comments.json"),
                JSON.stringify(agent),
              );
              await page.waitForFunction(
                () => !document.body.textContent?.includes("comments.json:"),
              );
              await page.click('button[aria-label="Close comments"]');
              await page.keyboard.down("Shift");
              await page.keyboard.press("Digit1");
              await page.keyboard.up("Shift");
              await Bun.sleep(300);
              // Select the smallest viewport through its live iframe, away from the existing pin.
              await clickHeading(120);
              await waitUntil(
                () =>
                  existsSync(join(root, ".framio/.state/selection.json")) &&
                  json(root, ".state/selection.json").width === 390,
              );
              expect(json(root, ".state/selection.json").frames[0].frame).toBe(
                "01-test/invoices",
              );
              await page.waitForSelector('[data-layer-row="Content"]');
              await waitUntil(
                () =>
                  json(root, ".state/selection.json").layer?.path ===
                  "Content/Heading",
              );
              expect(json(root, ".state/selection.json").layer.path).toBe(
                "Content/Heading",
              );
              const layerButton = await page.$(
                '[data-layer-row="Content"] button[title="Content"]',
              );
              await layerButton!.click();
              await waitUntil(
                () =>
                  json(root, ".state/selection.json").layer?.path === "Content",
              );
              expect(json(root, ".state/selection.json").width).toBe(390);
              // Switching the selected viewport keeps layer actions on that viewport.
              const desktopLabel = await page.$(
                '[data-id="__viewport__/01-test/invoices/1440"] .frame-drag',
              );
              await desktopLabel!.click();
              await waitUntil(
                () => json(root, ".state/selection.json").width === 1440,
              );
              await page.click(
                '[data-layer-row="Content"] button[title="Content"]',
              );
              await waitUntil(
                () =>
                  json(root, ".state/selection.json").layer?.path === "Content",
              );
              expect(json(root, ".state/selection.json").width).toBe(1440);
              // Drag one label; all siblings share one persisted frame position.
              const handle = await page.$(
                '[data-id="__viewport__/01-test/invoices/1440"] .frame-drag',
              );
              await page.waitForFunction(() => {
                const el = document.querySelector(
                  '[data-id="__viewport__/01-test/invoices/1440"] .frame-drag',
                )!;
                const at = el.getBoundingClientRect();
                const state = window as unknown as {
                  dragStable?: { x: number; y: number; count: number };
                };
                const prev = state.dragStable;
                state.dragStable = {
                  x: at.x,
                  y: at.y,
                  count:
                    prev &&
                    Math.abs(prev.x - at.x) < 0.1 &&
                    Math.abs(prev.y - at.y) < 0.1
                      ? prev.count + 1
                      : 0,
                };
                return state.dragStable.count > 5;
              });
              const box = await handle!.boundingBox();
              expect(box).not.toBeNull();
              const before = await page.$$eval(".react-flow__node", (nodes) =>
                nodes.map((el) => el.getBoundingClientRect().x),
              );
              await page.mouse.move(
                box!.x + box!.width / 2,
                box!.y + box!.height / 2,
              );
              await page.mouse.down();
              await page.mouse.move(
                box!.x + box!.width / 2 + 80,
                box!.y + box!.height / 2 + 45,
                { steps: 10 },
              );
              await page.mouse.up();
              await waitUntil(() =>
                existsSync(join(root, ".framio/pages/01-test/canvas.json")),
              );
              const after = await page.$$eval(".react-flow__node", (nodes) =>
                nodes.map((el) => el.getBoundingClientRect().x),
              );
              const movedBy = after[0]! - before[0]!;
              expect(movedBy).toBeGreaterThan(50);
              for (let i = 1; i < 3; i++)
                expect(after[i]! - before[i]!).toBeCloseTo(movedBy, 0);
              expect(
                Object.keys(json(root, "pages/01-test/canvas.json").positions),
              ).toEqual(["invoices"]);
              // Delete is explicit and removes only the selected thread.
              await page.click(
                `[data-id="__viewport__/01-test/invoices/390"] [data-comment-pin="${comment.id}"]`,
              );
              await page.waitForSelector(
                'button[aria-label="Comment actions"]',
                {
                  visible: true,
                },
              );
              await page.click('button[aria-label="Comment actions"]');
              await page.waitForSelector('[role="menuitem"]');
              await page.evaluate(() =>
                [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
                  .find((item) => item.textContent?.includes("Delete comment"))!
                  .click(),
              );
              await waitUntil(() => json(root).comments.length === 0);
            } finally {
              await browser.close();
            }
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
