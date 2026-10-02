import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { BunServices } from "@effect/platform-bun";
import * as Effect from "effect/Effect";
import { runServer } from "../../src/server/server";
import { ensureBrowser } from "../../src/lib/browser";
import { emptyUpdate, type UpdateStatus } from "../../src/contracts/update";
test("footer supports keyboard descriptions, direct download, progress, install later and recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-update-ui-"));
  mkdirSync(join(root, ".framio/pages"), { recursive: true });
  writeFileSync(join(root, ".framio/theme.css"), "");
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          const browser = yield* Effect.acquireRelease(
            Effect.promise(async () =>
              puppeteer.launch({
                executablePath: await Effect.runPromise(
                  ensureBrowser().pipe(Effect.provide(BunServices.layer)),
                ),
                headless: true,
              }),
            ),
            (browser) => Effect.promise(() => browser.close()),
          );
          yield* Effect.promise(async () => {
            const page = await browser.newPage();
            const actions: string[] = [];
            const state: {
              -readonly [K in keyof UpdateStatus]: UpdateStatus[K];
            } = {
              ...emptyUpdate,
              phase: "available",
              release: {
                version: "2.0.0",
                tag: "v2.0.0",
                description: "A simpler update experience.",
                notesUrl:
                  "https://github.com/C-W-D-Harshit/framio/releases/tag/v2.0.0",
                assetId: 1,
                assetName: "framio-darwin-arm64.tar.gz",
                assetUrl:
                  "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/1",
                assetSize: 100,
                checksumUrl:
                  "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/2",
                requiresProjectUpdate: false,
              },
              runningVersion: "1.0.0",
              installedVersion: "1.0.0",
              canInstall: true,
              installationNotice: null,
              restartNeeded: false,
              restartPhase: "idle",
              restartError: null,
            };
            await page.setRequestInterception(true);
            page.on("request", (request) => {
              if (new URL(request.url()).pathname !== "/api/update")
                return void request.continue();
              if (request.method() === "POST") {
                actions.push(JSON.parse(request.postData()!).action);
                state.phase = "downloading";
                state.bytes = 10;
                state.total = 100;
                return void request.respond({
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify({ ok: true, error: null }),
                });
              }
              void request.respond({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(state),
              });
            });
            await page.goto(info.url, { waitUntil: "networkidle0" });
            const button =
              'button[aria-describedby="framio-update-description"]';
            await page.waitForSelector(button);
            await page.focus(button);
            await page.keyboard.press("Tab");
            await page.keyboard.down("Shift");
            await page.keyboard.press("Tab");
            await page.keyboard.up("Shift");
            await page.waitForSelector('[data-slot="tooltip-content"]');
            expect(
              await page.$eval(
                '[data-slot="tooltip-content"]',
                (el) => el.textContent,
              ),
            ).toContain("A simpler update experience.");
            await page.hover(button);
            expect(
              await page.$eval(
                '[data-slot="tooltip-content"]',
                (el) => el.textContent,
              ),
            ).toContain("2.0.0");
            await page.click(button);
            expect(actions).toEqual(["download"]);
            await page.waitForFunction(() =>
              document.body.innerText.includes("Downloading"),
            );
            expect(
              await page.$eval(
                "progress",
                (el) => (el as HTMLProgressElement).value,
              ),
            ).toBe(10);
            state.phase = "ready";
            state.bytes = 100;
            await page.waitForFunction(() =>
              document.body.innerText.includes("Install update"),
            );
            expect(actions).toEqual(["download"]);
            expect(await page.$eval(button, (el) => el.textContent)).toContain(
              "2.0.0",
            );
            expect(await page.$eval("body", (el) => el.textContent)).toContain(
              "Installing restarts this project",
            );
            state.phase = "download-failed";
            state.error = "Checksum mismatch. Retry download.";
            await page.waitForFunction(() =>
              document.body.innerText.includes("Retry download"),
            );
            expect(
              await page.$eval('[role="alert"]', (el) => el.textContent),
            ).toContain("Checksum mismatch");
            state.phase = "idle";
            state.error = null;
            state.installedVersion = "2.0.0";
            state.restartNeeded = true;
            await page.waitForFunction(() =>
              document.body.innerText.includes("Restart to update"),
            );
            await page.setViewport({ width: 390, height: 844 });
            await page.click('button[data-sidebar="trigger"]');
            await page.waitForSelector(button, { visible: true });
            const box = await (await page.$(button))!.boundingBox();
            expect(box!.width).toBeLessThan(390);
            await page.click("summary");
            expect(
              await page.$eval(
                "#framio-update-description",
                (el) => el.textContent,
              ),
            ).toContain("simpler update");
            expect(
              await page.$eval(
                'a[href="https://github.com/C-W-D-Harshit/framio/releases/tag/v2.0.0"]',
                (el) => el.textContent,
              ),
            ).toContain("Complete release notes");
            await page.close();
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test("multiple live tabs safely refuse restart before installation", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-update-tabs-"));
  mkdirSync(join(root, ".framio/pages"), { recursive: true });
  writeFileSync(join(root, ".framio/theme.css"), "");
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            const sockets = [
              new WebSocket(info.url.replace("http:", "ws:") + "/ws"),
              new WebSocket(info.url.replace("http:", "ws:") + "/ws"),
            ];
            try {
              await Promise.all(
                sockets.map(
                  (socket) =>
                    new Promise<void>((resolve, reject) => {
                      socket.onopen = () => resolve();
                      socket.onerror = reject;
                    }),
                ),
              );
              const response = await fetch(info.url + "/api/update", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "install" }),
              });
              const result = await response.json();
              expect(result.ok).toBe(false);
              expect(result.error).toContain("other canvas tabs");
              const health = await (
                await fetch(info.url + "/api/health")
              ).json();
              expect(health.pid).toBe(info.pid);
            } finally {
              for (const socket of sockets) socket.close();
            }
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
