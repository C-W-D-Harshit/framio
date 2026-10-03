import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { BunServices } from "@effect/platform-bun";
import * as Effect from "effect/Effect";
import { runServer } from "../../src/server/server";
import { ensureBrowser } from "../../src/lib/browser";
import { emptyUpdate, type UpdateStatus } from "../../src/contracts/update";
test("update actions accept advertised origins and reject foreign browser origins", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-update-origins-"));
  mkdirSync(join(root, ".framio/pages"), { recursive: true });
  writeFileSync(join(root, ".framio/theme.css"), "");
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            for (const origin of [
              "https://example.test",
              "null",
              "http://localhost:1",
            ]) {
              const response = await fetch(info.url + "/api/update", {
                method: "POST",
                headers: { origin },
                body: new TextEncoder().encode('{"action":"restart"}'),
              });
              expect(response.status).toBe(403);
            }
            expect(info.urls?.some((entry) => entry.kind === "network")).toBe(
              true,
            );
            for (const origin of new Set([
              info.url,
              `http://127.0.0.1:${info.port}`,
              ...(info.urls?.map((entry) => entry.url) ?? []),
            ])) {
              const response = await fetch(info.url + "/api/update", {
                method: "POST",
                headers: { origin, "content-type": "application/json" },
                body: JSON.stringify({ action: "restart" }),
              });
              expect(response.status).toBe(200);
              expect((await response.json()).error).toContain(
                "session supervisor",
              );
            }
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("drafts stay with their project when the same tab and port are reused", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "framio-project-drafts-"));
  const roots = [
    join(temporary, "first/design"),
    join(temporary, "second/design"),
  ];
  for (const root of roots) {
    mkdirSync(join(root, ".framio/pages/01-test"), { recursive: true });
    symlinkSync(
      resolve(import.meta.dir, "../../node_modules"),
      join(root, ".framio/node_modules"),
    );
    writeFileSync(join(root, ".framio/theme.css"), "body { margin: 0 }");
    writeFileSync(
      join(root, ".framio/pages/01-test/example.tsx"),
      'export const meta={name:"Example",width:400,height:300};export default function Frame(){return <main style={{height:300,background:"white"}}>Project fixture</main>}',
    );
  }
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const executablePath = yield* ensureBrowser();
          const browser = yield* Effect.acquireRelease(
            Effect.promise(() =>
              puppeteer.launch({ executablePath, headless: true }),
            ),
            (browser) => Effect.promise(() => browser.close()),
          );
          const page = yield* Effect.promise(() => browser.newPage());
          page.setDefaultTimeout(5000);
          let url = "";
          for (const [index, root] of [
            roots[0]!,
            roots[1]!,
            roots[0]!,
          ].entries()) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { info } = yield* runServer(root);
                if (url) expect(info.url).toBe(url);
                url = info.url;
                yield* Effect.promise(async () => {
                  await page.goto(info.url, { waitUntil: "networkidle0" });
                  await page.waitForSelector(
                    'iframe[data-frame="01-test/example"]',
                  );
                  const input = 'textarea[aria-label="New comment"]';
                  if (index === 1) {
                    expect(await page.$(input)).toBeNull();
                  }
                  if (index < 2) {
                    await page.click('button[aria-label="Comment"]');
                    await page.waitForFunction(() =>
                      document
                        .querySelector<HTMLIFrameElement>(
                          'iframe[data-frame="01-test/example"]',
                        )
                        ?.contentDocument?.querySelector("main"),
                    );
                    await page.click('button[aria-label="Fit all frames"]');
                    await Bun.sleep(400);
                    const frame = await page.$(
                      'iframe[data-frame="01-test/example"]',
                    );
                    const box = (await frame!.boundingBox())!;
                    await page.mouse.click(
                      box.x + box.width / 2,
                      box.y + box.height / 2,
                    );
                    await page.waitForSelector(input);
                    expect(
                      await page.$eval(
                        input,
                        (element) => (element as HTMLTextAreaElement).value,
                      ),
                    ).toBe("");
                    await page.type(
                      input,
                      index === 0
                        ? "First project draft"
                        : "Second project draft",
                    );
                    await page.reload({ waitUntil: "networkidle0" });
                  }
                  await page.waitForSelector(input);
                  expect(
                    await page.$eval(
                      input,
                      (element) => (element as HTMLTextAreaElement).value,
                    ),
                  ).toBe(
                    index === 1
                      ? "Second project draft"
                      : "First project draft",
                  );
                });
              }),
            );
          }
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 30000);
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
            const availableRelease = state.release;
            state.phase = "idle";
            state.release = null;
            state.canInstall = false;
            state.error = "GitHub returned 503. Try checking again.";
            await page.setRequestInterception(true);
            page.on("request", (request) => {
              if (new URL(request.url()).pathname !== "/api/update")
                return void request.continue();
              if (request.method() === "POST") {
                const action = JSON.parse(request.postData()!).action;
                actions.push(action);
                if (action === "check") {
                  state.phase = "available";
                  state.release = availableRelease;
                  state.canInstall = true;
                  state.error = null;
                } else {
                  state.phase = "downloading";
                  state.bytes = 10;
                  state.total = 100;
                }
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
            expect(await page.$eval(button, (el) => el.textContent)).toContain(
              "Check for updates",
            );
            expect(
              await page.$eval('[role="alert"]', (el) => el.textContent),
            ).toContain("503");
            expect(
              await page.$eval(
                button,
                (el) => (el as HTMLButtonElement).disabled,
              ),
            ).toBe(false);
            await page.click(button);
            await page.waitForFunction(() =>
              document.body.innerText.includes("Update available"),
            );
            expect(actions).toEqual(["check"]);
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
            expect(actions).toEqual(["check", "download"]);
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
            expect(actions).toEqual(["check", "download"]);
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
