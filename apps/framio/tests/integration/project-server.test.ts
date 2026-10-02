import { expect, test } from "bun:test";
import puppeteer from "puppeteer-core";
import { ensureBrowser } from "../../src/lib/browser";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { LiveRpc } from "../../src/contracts/live";
import { runServer } from "../../src/server/server";
import type { Snapshot } from "../../src/contracts/snapshot";

async function withProjectServer(
  setup: (root: string) => void,
  check: (url: string, root: string) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "framio-project-server-"));
  mkdirSync(join(root, ".framio/pages/01-test"), { recursive: true });
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(root, ".framio/node_modules"),
  );
  writeFileSync(join(root, ".framio/theme.css"), "body { margin: 0; }");
  try {
    setup(root);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(() => check(info.url, root));
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  "frame groups collapse and reopen without clearing canvas selection",
  () =>
    withProjectServer(
      (root) => {
        for (const name of ["One", "Two"]) {
          writeFileSync(
            join(root, `.framio/pages/01-test/${name.toLowerCase()}.tsx`),
            `export const meta={name:"${name}",width:390,height:300};export default function Frame(){return <h1>${name} content</h1>}`,
          );
        }
      },
      async (url) => {
        const browser = await puppeteer.launch({
          executablePath: await Effect.runPromise(
            ensureBrowser().pipe(Effect.provide(BunServices.layer)),
          ),
          headless: true,
        });
        try {
          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 800 });
          await page.goto(url);
          const row = (name: string) =>
            page.locator(
              `[aria-label="Project navigation"] button[title$="/${name.toLowerCase()}.tsx"]`,
            );
          const group = (name: string) =>
            page.$eval(
              '[aria-label="Project navigation"]',
              (sidebar, name) => {
                const button = [...sidebar.querySelectorAll("button")].find(
                  (button) => button.textContent?.trim() === name,
                )!;
                return {
                  expanded: button.getAttribute("aria-expanded"),
                  selected: button.hasAttribute("data-active"),
                  layers:
                    button.parentElement!.querySelector("section") !== null,
                };
              },
              name,
            );
          await row("One").click();
          await page.waitForSelector(
            '[aria-label="Project navigation"] button[title$="/one.tsx"][data-active]',
          );
          expect((await group("One")).layers).toBe(true);
          await row("One").click();
          expect(await group("One")).toEqual({
            expanded: "false",
            selected: true,
            layers: false,
          });
          // The same native button supports keyboard disclosure.
          await page.keyboard.press("Enter");
          expect(await group("One")).toEqual({
            expanded: "true",
            selected: true,
            layers: true,
          });
          await row("One").click();
          await row("Two").click();
          await page.waitForFunction(() =>
            [...document.querySelectorAll("button")].some(
              (button) =>
                button.textContent?.trim() === "Two" &&
                button.getAttribute("aria-expanded") === "true",
            ),
          );
          expect(await group("One")).toEqual({
            expanded: "false",
            selected: false,
            layers: false,
          });
          expect(await group("Two")).toEqual({
            expanded: "true",
            selected: true,
            layers: true,
          });
          await row("One").click();
          await page.waitForFunction(() =>
            [...document.querySelectorAll("button")].some(
              (button) =>
                button.textContent?.trim() === "One" &&
                button.getAttribute("aria-expanded") === "true",
            ),
          );
          expect(await group("One")).toEqual({
            expanded: "true",
            selected: true,
            layers: true,
          });
        } finally {
          await browser.close();
        }
      },
    ),
  60_000,
);

test(
  "an unreadable TSX frame remains diagnostic without hiding healthy frames",
  () =>
    withProjectServer(
      (root) => {
        const dir = join(root, ".framio/pages/01-test");
        writeFileSync(
          join(dir, "healthy.tsx"),
          'export const meta={name:"Healthy",width:390,height:844};export default function Frame(){return <h1>Healthy frame</h1>}',
        );
        symlinkSync(join(root, "missing.tsx"), join(dir, "broken.tsx"));
      },
      async (url) => {
        const response = await fetch(`${url}/api/project`, {
          headers: { connection: "close" },
        });
        expect(response.status).toBe(200);
        const snapshot: Snapshot = await response.json();
        expect(snapshot.pages).toHaveLength(1);
        expect(snapshot.pages[0]!.frames).toHaveLength(2);
        const healthy = snapshot.pages[0]!.frames.find(
          (frame) => frame.slug === "healthy",
        )!;
        const broken = snapshot.pages[0]!.frames.find(
          (frame) => frame.slug === "broken",
        )!;
        expect(healthy.error).toBeNull();
        expect(healthy.version).toBeGreaterThan(0);
        expect(broken.error).toContain("Could not read");
        const bundle = await fetch(
          `${url}/js/01-test/healthy.js?v=${healthy.version}`,
          { headers: { connection: "close" } },
        );
        expect(bundle.status).toBe(200);
        expect(await bundle.text()).toContain("Healthy frame");
      },
    ),
  30_000,
);

test(
  "mutable assets require cache revalidation after replacement",
  () =>
    withProjectServer(
      (root) => {
        mkdirSync(join(root, ".framio/assets"));
        writeFileSync(
          join(root, ".framio/assets/image.svg"),
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
        );
      },
      async (url, root) => {
        const response = await fetch(`${url}/assets/image.svg`, {
          headers: { connection: "close" },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(await response.text()).toContain('fill="red"');
        writeFileSync(
          join(root, ".framio/assets/image.svg"),
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>',
        );
        const replacement = await fetch(`${url}/assets/image.svg`, {
          headers: { connection: "close" },
        });
        expect(replacement.headers.get("cache-control")).toBe("no-cache");
        expect(await replacement.text()).toContain('fill="blue"');
      },
    ),
  30_000,
);

test("RPC publishes watched generations, stale reports are ignored and canvas fields survive saves", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-project-server-"));
  const dir = join(root, ".framio/pages/01-test");
  mkdirSync(dir, { recursive: true });
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(root, ".framio/node_modules"),
  );
  writeFileSync(join(root, ".framio/theme.css"), "body { margin: 0; }");
  const source = (label: string) =>
    `export const meta={name:"${label}",width:390,height:844};export default function Frame(){return <h1>${label}</h1>}`;
  writeFileSync(join(dir, "one.tsx"), source("Before"));
  writeFileSync(
    join(dir, "canvas.json"),
    JSON.stringify({
      positions: { one: { x: 1, y: 2 } },
      custom: { keep: true },
    }),
  );
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          const protocol = RpcClient.layerProtocolSocket({
            retryTransientErrors: false,
          }).pipe(
            Layer.provide(
              Socket.layerWebSocket(
                info.url.replace("http", "ws") + "/ws",
              ).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
            ),
            Layer.provide(RpcSerialization.layerJson),
          );
          yield* Effect.scoped(
            Effect.gen(function* () {
              const rpc = yield* RpcClient.make(LiveRpc);
              const first = yield* rpc.snapshotsV1().pipe(Stream.runHead);
              expect(Option.isSome(first)).toBe(true);
              if (Option.isNone(first))
                return yield* Effect.die("No initial snapshot");
              const before = first.value.pages[0]!.frames[0]!;
              expect(before.meta.name).toBe("Before");
              yield* Effect.sync(() =>
                writeFileSync(join(dir, "one.tsx"), source("After")),
              );
              const changed = yield* rpc.snapshotsV1().pipe(
                Stream.filter(
                  (snapshot) =>
                    snapshot.pages[0]?.frames[0]?.meta.name === "After",
                ),
                Stream.runHead,
                Effect.timeout("5 seconds"),
              );
              if (Option.isNone(changed))
                return yield* Effect.die("No watched generation");
              const after = changed.value.pages[0]!.frames[0]!;
              expect(after.version).toBeGreaterThan(before.version);
              const oldEntry = yield* Effect.promise(() =>
                fetch(`${info.url}/js/01-test/one.js?v=${before.version}`, {
                  headers: { connection: "close" },
                }).then((response) => response.text()),
              );
              expect(oldEntry.includes('children: "Before"')).toBe(true);
              expect(oldEntry.includes('children: "After"')).toBe(false);
              const status = yield* Effect.promise(() =>
                fetch(`${info.url}/api/frame-status`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    connection: "close",
                  },
                  body: JSON.stringify({
                    id: before.id,
                    version: before.version,
                    error: "stale failure",
                  }),
                }),
              );
              expect(status.status).toBe(200);
              yield* Effect.promise(() => status.text());
              const current = yield* rpc.snapshotsV1().pipe(Stream.runHead);
              if (Option.isNone(current))
                return yield* Effect.die("No current snapshot");
              expect(current.value.pages[0]!.frames[0]!.error).toBeNull();
              const save = yield* Effect.promise(() =>
                fetch(`${info.url}/api/canvas`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    connection: "close",
                  },
                  body: JSON.stringify({
                    page: "01-test",
                    positions: { two: { x: 3.4, y: 4.6 } },
                  }),
                }),
              );
              expect(save.status).toBe(200);
              yield* Effect.promise(() => save.text());
              expect(
                JSON.parse(readFileSync(join(dir, "canvas.json"), "utf8")),
              ).toEqual({
                positions: { one: { x: 1, y: 2 }, two: { x: 3, y: 5 } },
                custom: { keep: true },
              });
              const invalid = yield* Effect.promise(() =>
                fetch(`${info.url}/api/screenshot`, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    connection: "close",
                  },
                  body: JSON.stringify({ scale: -1 }),
                }),
              );
              expect(invalid.status).toBe(400);
              yield* Effect.promise(() => invalid.text());
            }).pipe(Effect.provide(protocol)),
          );
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test(
  "canvas contains browser overscroll while wheel panning and pinch zoom still work",
  () =>
    withProjectServer(
      (root) => {
        writeFileSync(
          join(root, ".framio/pages/01-test/one.tsx"),
          'export const meta={name:"Wheel fixture",width:390,height:300};export default function Frame(){return <div style={{height:300}}>Wheel fixture</div>}',
        );
      },
      async (url, root) => {
        const browser = await puppeteer.launch({
          executablePath: await Effect.runPromise(
            ensureBrowser().pipe(Effect.provide(BunServices.layer)),
          ),
          headless: true,
        });
        try {
          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 800 });
          // A saved viewport keeps initial auto-fit from masking wheel movement.
          await page.evaluateOnNewDocument((project) => {
            localStorage.setItem(
              `framio:viewport:${project}/01-test`,
              JSON.stringify({ x: 100, y: 100, zoom: 1 }),
            );
          }, basename(root));
          await page.goto(url);
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLIFrameElement>("iframe[data-frame]")
                ?.contentWindow?.__framio?.ready,
          );
          expect(
            await page.evaluate(
              () =>
                getComputedStyle(document.documentElement).overscrollBehaviorX,
            ),
          ).toBe("none");
          // Pinches that cross studio chrome must never become page zoom.
          const cancellation = await page.evaluate(() => {
            const sidebar = document.querySelector(
              '[aria-label="Project navigation"]',
            )!;
            const pinch = new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
              deltaY: -80,
            });
            const scroll = new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: 80,
            });
            sidebar.dispatchEvent(pinch);
            sidebar.dispatchEvent(scroll);
            return {
              pinch: pinch.defaultPrevented,
              scroll: scroll.defaultPrevented,
            };
          });
          expect(cancellation).toEqual({ pinch: true, scroll: false });
          const originalUrl = page.url();
          const transform = () =>
            page.$eval(
              ".react-flow__viewport",
              (el) => (el as HTMLElement).style.transform,
            );
          for (const overFrame of [false, true]) {
            for (const deltaX of [-80, 80]) {
              const target = await page.$(
                overFrame ? "iframe[data-frame]" : ".react-flow",
              );
              const box = (await target!.boundingBox())!;
              await page.mouse.move(
                overFrame ? box.x + box.width / 2 : box.x + box.width - 40,
                overFrame ? box.y + box.height / 2 : box.y + box.height - 40,
              );
              const before = await transform();
              await page.mouse.wheel({ deltaX, deltaY: 0 });
              await page.waitForFunction(
                (before) =>
                  (
                    document.querySelector(
                      ".react-flow__viewport",
                    ) as HTMLElement
                  ).style.transform !== before,
                {},
                before,
              );
              expect(page.url()).toBe(originalUrl);
            }
          }
          const studioSize = () =>
            page.evaluate(() => ({
              width: window.innerWidth,
              sidebarWidth: document
                .querySelector('[aria-label="Project navigation"]')!
                .getBoundingClientRect().width,
              scale: window.visualViewport!.scale,
            }));
          const beforeSize = await studioSize();
          for (const overFrame of [true, false]) {
            const target = await page.$(
              overFrame ? "iframe[data-frame]" : ".react-flow",
            );
            const box = (await target!.boundingBox())!;
            await page.mouse.move(
              overFrame ? box.x + box.width / 2 : box.x + box.width - 40,
              overFrame ? box.y + box.height / 2 : box.y + box.height - 40,
            );
            const beforeZoom = await page.evaluate(() =>
              getComputedStyle(document.documentElement).getPropertyValue(
                "--zoom",
              ),
            );
            await page.keyboard.down("Control");
            await page.mouse.wheel({ deltaY: -80 });
            await page.keyboard.up("Control");
            await page.waitForFunction(
              (before) =>
                getComputedStyle(document.documentElement).getPropertyValue(
                  "--zoom",
                ) !== before,
              {},
              beforeZoom,
            );
            expect(await studioSize()).toEqual(beforeSize);
            expect(page.url()).toBe(originalUrl);
          }
        } finally {
          await browser.close();
        }
      },
    ),
  60_000,
);

test(
  "pinch stays on the canvas while zoomed-out thumbnails become loading iframes",
  () =>
    withProjectServer(
      (root) => {
        for (let i = 0; i < 9; i++) {
          writeFileSync(
            join(root, `.framio/pages/01-test/frame-${i}.tsx`),
            'import React from "react";export const meta={name:"Pinch transition",width:390,height:300};export default function Frame(){return <div style={{height:300}}>Pinch transition</div>}',
          );
        }
      },
      async (url, root) => {
        const browser = await puppeteer.launch({
          executablePath: await Effect.runPromise(
            ensureBrowser().pipe(Effect.provide(BunServices.layer)),
          ),
          headless: true,
        });
        try {
          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 800 });
          await page.evaluateOnNewDocument((project) => {
            localStorage.setItem(
              `framio:viewport:${project}/01-test`,
              JSON.stringify({ x: 100, y: 100, zoom: 0.24 }),
            );
          }, basename(root));
          // Hold the new iframe documents so the test exercises the input gap,
          // rather than depending on a lucky millisecond during real loading.
          let hold = true;
          const loading: import("puppeteer-core").HTTPRequest[] = [];
          await page.setRequestInterception(true);
          page.on("request", (request) => {
            if (hold && new URL(request.url()).pathname.startsWith("/f/"))
              loading.push(request);
            else void request.continue();
          });
          await page.goto(url);
          await page.waitForSelector(".react-flow__node img");
          expect(await page.$$("iframe[data-frame]")).toHaveLength(0);
          const node = await page.$(".react-flow__node");
          const box = (await node!.boundingBox())!;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.keyboard.down("Control");
          // Cross the 28% admission threshold with normalized Linux wheel deltas.
          await page.mouse.wheel({ deltaY: -160 });
          await page.waitForSelector("iframe[data-frame]");
          const during = await page.evaluate(() => ({
            pointerEvents: [
              ...document.querySelectorAll("iframe[data-frame]"),
            ].map((frame) => getComputedStyle(frame).pointerEvents),
            zoom: getComputedStyle(document.documentElement).getPropertyValue(
              "--zoom",
            ),
            scale: window.visualViewport!.scale,
            sidebarWidth: document
              .querySelector('[aria-label="Project navigation"]')!
              .getBoundingClientRect().width,
          }));
          expect(during.pointerEvents.length).toBeGreaterThan(0);
          expect(during.pointerEvents.every((value) => value === "none")).toBe(
            true,
          );
          // Continue the same pinch over a frame whose runtime is not loaded yet.
          await page.mouse.wheel({ deltaY: -20 });
          await page.keyboard.up("Control");
          await page.waitForFunction(
            (before) =>
              getComputedStyle(document.documentElement).getPropertyValue(
                "--zoom",
              ) !== before,
            {},
            during.zoom,
          );
          expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(
            1,
          );
          expect(during.scale).toBe(1);
          expect(during.sidebarWidth).toBe(248);
          await page.waitForFunction(
            () => !document.documentElement.classList.contains("is-zooming"),
          );
          // A slow iframe remains protected even after the gesture has finished.
          expect(
            await page.$$eval("iframe[data-frame]", (frames) =>
              frames.every(
                (frame) => getComputedStyle(frame).pointerEvents === "none",
              ),
            ),
          ).toBe(true);
          hold = false;
          for (const request of loading) await request.continue();
          await page.waitForFunction(
            () =>
              !document.documentElement.classList.contains("is-zooming") &&
              [
                ...document.querySelectorAll<HTMLIFrameElement>(
                  "iframe[data-frame]",
                ),
              ].every(
                (frame) =>
                  frame.contentWindow?.__framio?.ready &&
                  getComputedStyle(frame).pointerEvents === "all",
              ),
          );
        } finally {
          await browser.close();
        }
      },
    ),
  60_000,
);

test(
  "embedded assets negotiate compression and thumbnails use scaled, temporary captures",
  () =>
    withProjectServer(
      (root) => {
        writeFileSync(
          join(root, ".framio/pages/01-test/performance.tsx"),
          'export const meta={name:"Performance",width:390,height:300};export default function Frame(){return <div style={{height:949}}>Geometry</div>}',
        );
      },
      async (url, root) => {
        const request = (path: string, encoding = "gzip") =>
          fetch(`${url}${path}`, { headers: { "accept-encoding": encoding } });
        const html = await request("/");
        expect(html.headers.get("content-encoding")).toBe("gzip");
        expect(html.headers.get("cache-control")).toBe("no-cache");
        const document = await html.text();
        const js = document.match(/src="([^"]+\.js)"/)![1]!;
        const asset = await request(js.startsWith("/") ? js : `/${js}`);
        expect(asset.headers.get("cache-control")).toContain("immutable");
        expect(asset.headers.get("vary")).toBe("Accept-Encoding");
        const uncompressed = await request("/_runtime.js", "gzip;q=0, *;q=1");
        expect(uncompressed.headers.get("content-encoding")).toBeNull();
        expect(uncompressed.headers.get("cache-control")).toBe("no-cache");
        const frame = await (await request("/f/01-test/performance")).text();
        const runtime = frame.match(/src="(\/_runtime.js\?v=[^"]+)"/)![1]!;
        expect((await request(runtime)).headers.get("cache-control")).toContain(
          "immutable",
        );
        const thumbnail = await request(
          "/thumb/01-test/performance.png?scale=0.125",
        );
        expect(thumbnail.status).toBe(200);
        expect(thumbnail.headers.get("x-framio-height")).toBe("949");
        const png = new DataView(await thumbnail.arrayBuffer());
        expect(png.getUint32(16)).toBe(Math.round(390 * 0.125));
        expect(
          (await request("/thumb/01-test/performance.png?scale=0.2")).status,
        ).toBe(400);
        const { readdirSync } = await import("node:fs");
        const state = join(root, ".framio/.state");
        const previews = readdirSync(state).find((name) =>
          name.startsWith("previews-"),
        )!;
        expect(readdirSync(join(state, previews))).toEqual([]);
      },
    ),
  30_000,
);

test(
  "large canvases bound live frames even when every responsive viewport is selected",
  () =>
    withProjectServer(
      (root) => {
        for (let i = 0; i < 20; i++)
          writeFileSync(
            join(root, `.framio/pages/01-test/budget-${i}.tsx`),
            `export const meta={name:"Budget ${i}",width:390,height:300};export default function Frame(){return <div style={{height:300}}>Budget ${i}</div>}`,
          );
      },
      async (url, root) => {
        const browser = await puppeteer.launch({
          executablePath: await Effect.runPromise(
            ensureBrowser().pipe(Effect.provide(BunServices.layer)),
          ),
          headless: true,
        });
        try {
          const page = await browser.newPage();
          await page.setViewport({ width: 1600, height: 1000 });
          await page.evaluateOnNewDocument(
            (project) =>
              localStorage.setItem(
                `framio:viewport:${project}/01-test`,
                JSON.stringify({ x: 100, y: 100, zoom: 1 }),
              ),
            basename(root),
          );
          await page.goto(url);
          await page.waitForFunction(() => {
            const frames = [
              ...document.querySelectorAll<HTMLIFrameElement>(
                "iframe[data-frame]",
              ),
            ];
            return (
              frames.length === 6 &&
              frames.every((frame) => frame.contentWindow?.__framio?.ready)
            );
          });
          expect(await page.$$("iframe[data-frame]")).toHaveLength(6);
          await page.keyboard.down(
            process.platform === "darwin" ? "Meta" : "Control",
          );
          await page.keyboard.press("a");
          await page.keyboard.up(
            process.platform === "darwin" ? "Meta" : "Control",
          );
          await page.waitForFunction(
            () =>
              document.querySelectorAll(".react-flow__node.selected").length ===
              20,
          );
          expect(
            (await page.$$("iframe[data-frame]")).length,
          ).toBeLessThanOrEqual(6);
          const liveWithoutThumbnails = await page.$$eval(
            "iframe[data-frame]",
            (frames) =>
              frames.every(
                (frame) => !frame.parentElement?.querySelector("img"),
              ),
          );
          expect(liveWithoutThumbnails).toBe(true);
        } finally {
          await browser.close();
        }
      },
    ),
  30_000,
);

test(
  "reload restores measured geometry before frame documents finish loading",
  () =>
    withProjectServer(
      (root) =>
        writeFileSync(
          join(root, ".framio/pages/01-test/geometry.tsx"),
          'export const meta={name:"Geometry",width:390,height:844};export default function Frame(){return <div style={{height:949}}>Measured</div>}',
        ),
      async (url) => {
        const browser = await puppeteer.launch({
          executablePath: await Effect.runPromise(
            ensureBrowser().pipe(Effect.provide(BunServices.layer)),
          ),
          headless: true,
        });
        try {
          const page = await browser.newPage();
          await page.goto(url);
          await page.waitForFunction(() => {
            const surface =
              document.querySelector<HTMLElement>(".frame-surface");
            return (
              surface?.style.height === "949px" &&
              Object.keys(localStorage).some((key) =>
                key.startsWith("framio:geometry:"),
              )
            );
          });
          const held: import("puppeteer-core").HTTPRequest[] = [];
          await page.setRequestInterception(true);
          page.on("request", (request) => {
            if (/^\/(f|thumb)\//.test(new URL(request.url()).pathname))
              held.push(request);
            else void request.continue();
          });
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForSelector(".frame-surface");
          expect(
            await page.$eval(
              ".frame-surface",
              (surface) => (surface as HTMLElement).style.height,
            ),
          ).toBe("949px");
          for (const request of held) await request.abort();
        } finally {
          await browser.close();
        }
      },
    ),
  30_000,
);

test(
  "a broken entry preserves shared healthy chunks and dependency edits still rebuild them",
  () =>
    withProjectServer(
      (root) => {
        mkdirSync(join(root, ".framio/components"), { recursive: true });
        writeFileSync(
          join(root, ".framio/components/shared.tsx"),
          'export const title="Before";',
        );
        writeFileSync(
          join(root, ".framio/pages/01-test/aaa-broken.tsx"),
          "export default function (",
        );
        for (let i = 0; i < 8; i++)
          writeFileSync(
            join(root, `.framio/pages/01-test/healthy-${i}.tsx`),
            `import {title} from "../../components/shared";export default function Frame(){return <h1>{title} ${i}</h1>}`,
          );
      },
      async (url, root) => {
        const snapshot = async () =>
          (await (await fetch(`${url}/api/project`)).json()) as Snapshot;
        const first = await snapshot();
        const frames = first.pages[0]!.frames;
        expect(
          frames.find((frame) => frame.slug === "aaa-broken")?.error,
        ).toBeTruthy();
        const healthy = frames.filter((frame) =>
          frame.slug.startsWith("healthy"),
        );
        expect(healthy).toHaveLength(8);
        expect(healthy.every((frame) => frame.error === null)).toBe(true);
        const entries = await Promise.all(
          healthy.map(
            async (frame) =>
              await (
                await fetch(`${url}/js/${frame.id}.js?v=${frame.version}`)
              ).text(),
          ),
        );
        const chunks = entries.flatMap((entry) =>
          [...entry.matchAll(/(?:\.\.\/)?chunks\/[^"']+\.js/g)].map((match) =>
            match[0].replace(/^\.\.\//, ""),
          ),
        );
        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of new Set(chunks))
          expect((await fetch(`${url}/js/${chunk}`)).status).toBe(200);
        writeFileSync(
          join(root, ".framio/components/shared.tsx"),
          'export const title="After";',
        );
        const deadline = Date.now() + 10_000;
        let changed = first;
        while (Date.now() < deadline) {
          changed = await snapshot();
          if (
            healthy.every(
              (old) =>
                changed.pages[0]!.frames.find((frame) => frame.id === old.id)
                  ?.version !== old.version,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(
          healthy.every(
            (old) =>
              changed.pages[0]!.frames.find((frame) => frame.id === old.id)
                ?.version !== old.version,
          ),
        ).toBe(true);
        expect(
          changed.pages[0]!.frames.filter((frame) =>
            frame.slug.startsWith("healthy"),
          ).every((frame) => frame.error === null),
        ).toBe(true);
      },
    ),
  30_000,
);
