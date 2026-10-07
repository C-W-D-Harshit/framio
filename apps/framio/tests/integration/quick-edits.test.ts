import { expect, test } from "bun:test";
import puppeteer, { type Page, type KeyInput } from "puppeteer-core";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { imageSize } from "../../src/server/image-size";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureBrowser } from "../../src/lib/browser";
import { runServer } from "../../src/server/server";
import { editConflict } from "../../src/server/source-edits";
import { parseSourceRef } from "../../src/contracts/edits";

const original = `import { Button } from "@/components/ui/button";
export const meta = { name: "Quick edits", width: 480, height: 640 };
const label = "Computed text";
export default function Frame() {
  return (
    <main className="p-8" data-layer="Page">
      <h1 id="heading" className="text-2xl h-10">Original heading</h1>
      <div id="card" className="h-20 w-64 bg-red-200">Card</div>
      <div id="items" className="flex flex-col gap-2">
        <p data-item="1" className="h-8">Item 1</p>
        <p data-item="2" className="h-8">Item 2</p>
        <p data-item="3" key="third" className="h-8">Item 3</p>
      </div>
      <Button id="button" className="h-10">Create invoice</Button>
      <div id="mapped" className="flex flex-col">
        {[1, 2, 3].map((item) => <p key={item} className="h-8">Mapped item</p>)}
      </div>
      <p id="variable" className="h-8">{label}</p>
    </main>
  );
}
`;
const shownSelector = 'iframe[data-frame="01-test/quick"][data-shown="true"]';
async function shown(page: Page) {
  const iframe = await page.waitForSelector(shownSelector);
  return (await iframe!.contentFrame())!;
}
async function point(page: Page, selector: string, edge = false) {
  return page.$eval(
    shownSelector,
    (iframe, selector, edge) => {
      const frame = iframe as HTMLIFrameElement;
      const element = frame.contentDocument!.querySelector(selector)!;
      const rect = element.getBoundingClientRect();
      const outer = frame.getBoundingClientRect();
      const scale = outer.width / frame.contentWindow!.innerWidth;
      return {
        x: outer.x + (rect.x + rect.width / 2) * scale,
        y: outer.y + (rect.y + (edge ? 1 : rect.height / 2)) * scale,
        scale,
      };
    },
    selector,
    edge,
  );
}
async function click(page: Page, selector: string, count = 1) {
  const at = await point(page, selector);
  await page.mouse.click(at.x, at.y, { count });
}
async function version(page: Page) {
  return page.$eval(shownSelector, (frame) =>
    Number((frame as HTMLElement).dataset.version),
  );
}
async function swapped(page: Page, previous: number) {
  await page.waitForFunction(
    (selector, previous) => {
      const iframe = document.querySelector<HTMLIFrameElement>(selector);
      return (
        iframe &&
        Number(iframe.dataset.version) > previous &&
        iframe.dataset.ready === "true"
      );
    },
    {},
    shownSelector,
    previous,
  );
}
async function selected(page: Page, selector: string, index = 0) {
  await page
    .waitForFunction(
      (frameSelector, selector, index) => {
        const frame = document.querySelector<HTMLIFrameElement>(frameSelector);
        const elements = frame?.contentDocument?.querySelectorAll(selector);
        const messages = (window as any).quickMessages as any[];
        const last = messages.filter((m) => m.type === "select").at(-1);
        return (
          elements?.[index] &&
          last?.sourceSelection?.ref ===
            elements[index].getAttribute("data-framio-src") &&
          last.sourceSelection.index ===
            [...frame!.contentDocument!.querySelectorAll("[data-framio-src]")]
              .filter(
                (el) =>
                  el.getAttribute("data-framio-src") ===
                  last.sourceSelection.ref,
              )
              .indexOf(elements[index])
        );
      },
      {},
      shownSelector,
      selector,
      index,
    )
    .catch(async (error) => {
      console.log(
        "selection diagnostics",
        await page.evaluate(() => ({
          messages: (window as any).quickMessages,
          frames: [...document.querySelectorAll("iframe")].map((f) => ({
            dataset: { ...f.dataset },
            body: f.contentDocument?.body.innerHTML.slice(0, 1800),
          })),
        })),
      );
      throw error;
    });
  await page.waitForSelector('section[aria-label="Quick edits"]');
}
async function shortcut(page: Page, key: KeyInput, redo = false) {
  await page.keyboard.down("Meta");
  if (redo) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (redo) await page.keyboard.up("Shift");
  await page.keyboard.up("Meta");
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for source write");
    await Bun.sleep(2);
  }
}

test("quick edits round trip through Studio, source writes and rebuilt frames", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-quick-edits-"));
  const framio = join(root, ".framio");
  mkdirSync(join(framio, "pages/01-test"), { recursive: true });
  mkdirSync(join(framio, "components/ui"), { recursive: true });
  mkdirSync(join(framio, "lib"));
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(framio, "node_modules"),
  );
  for (const file of [
    "components/ui/button.tsx",
    "lib/utils.ts",
    "tsconfig.json",
  ])
    copyFileSync(
      resolve(import.meta.dir, "../../src/scaffold", file),
      join(framio, file),
    );
  writeFileSync(
    join(framio, "theme.css"),
    '@import "tailwindcss"; body { margin: 0 }',
  );
  const file = join(framio, "pages/01-test/quick.tsx");
  writeFileSync(file, original);
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            const browser = await puppeteer.launch({
              executablePath: await Effect.runPromise(
                ensureBrowser().pipe(Effect.provide(BunServices.layer)),
              ),
              headless: true,
            });
            try {
              const page = await browser.newPage();
              await page.setViewport({ width: 1440, height: 1000 });
              page.setDefaultTimeout(8000);
              const errors: string[] = [];
              page.on("pageerror", (error) => errors.push(String(error)));
              page.on("console", (message) => {
                if (message.type() === "error") errors.push(message.text());
              });
              await page.evaluateOnNewDocument(() => {
                (window as any).quickMessages = [];
                window.addEventListener("message", (event) => {
                  if (event.data?.source === "framio")
                    (window as any).quickMessages.push({
                      ...event.data,
                      time: Date.now(),
                    });
                });
              });
              await page.goto(info.url);
              await (await shown(page)).waitForSelector("#heading");
              await page.waitForFunction(
                (selector) =>
                  document.querySelector<HTMLIFrameElement>(selector)?.dataset
                    .ready === "true",
                {},
                shownSelector,
              );
              await Bun.sleep(400);
              await click(page, "#heading", 2);
              await (
                await shown(page)
              )
                .waitForSelector('[contenteditable="plaintext-only"]')
                .catch(async (error) => {
                  console.log(
                    "editing diagnostics",
                    await page.evaluate(() => ({
                      messages: (window as any).quickMessages,
                      frames: [...document.querySelectorAll("iframe")].map(
                        (f) => ({
                          dataset: { ...f.dataset },
                          body: f.contentDocument?.body.innerHTML.slice(
                            0,
                            2500,
                          ),
                        }),
                      ),
                    })),
                  );
                  throw error;
                });
              await page.keyboard.type("vh edited heading");
              expect(
                await page.$eval('button[aria-label="Select"]', (el) =>
                  el.getAttribute("aria-pressed"),
                ),
              ).toBe("true");
              const before = await version(page);
              const input = Date.now();
              const written = until(
                () => readFileSync(file, "utf8") !== original,
              )
                .then(() => Date.now())
                .catch(async (error) => {
                  console.log(
                    "write diagnostics",
                    JSON.stringify(
                      await page.evaluate(() => ({
                        messages: (window as any).quickMessages,
                        notices: [
                          ...document.querySelectorAll('[role="status"]'),
                        ].map((el) => el.textContent),
                      })),
                    ),
                  );
                  throw error;
                });
              await page.keyboard.press("Enter");
              const writeTime = await written;
              expect(readFileSync(file, "utf8")).toBe(
                original.replace("Original heading", "vh edited heading"),
              );
              await swapped(page, before);
              const swapTime = Date.now();
              await selected(page, "#heading");
              const restoreTime = Date.now();
              console.log(
                `Quick edits timing: input to write ${writeTime - input}ms; write to displayed version ${swapTime - writeTime}ms; input to selection ${restoreTime - input}ms`,
              );
              expect(
                await (
                  await shown(page)
                ).$eval("#heading", (el) => el.textContent),
              ).toBe("vh edited heading");
              const selectionFile = join(framio, ".state/selection.json");
              await until(
                () =>
                  existsSync(selectionFile) &&
                  JSON.parse(readFileSync(selectionFile, "utf8")).element
                    ?.text === "vh edited heading",
              );
              expect(
                JSON.parse(readFileSync(selectionFile, "utf8")),
              ).toMatchObject({
                frames: [
                  {
                    frame: "01-test/quick",
                    file: ".framio/pages/01-test/quick.tsx",
                  },
                ],
                element: {
                  selector: "#root > main > h1",
                  text: "vh edited heading",
                },
              });

              // Real resize handle geometry includes the Studio canvas transform.
              await click(page, "#card");
              await selected(page, "#card");
              const cardVersion = await version(page);
              const beforeResize = readFileSync(file, "utf8");
              const handle = await page.$eval(shownSelector, (iframe) => {
                const frame = iframe as HTMLIFrameElement;
                const card = frame
                  .contentDocument!.querySelector("#card")!
                  .getBoundingClientRect();
                const candidates = [
                  ...frame.contentDocument!.querySelectorAll<HTMLElement>(
                    "div",
                  ),
                ].filter(
                  (el) =>
                    el.style.cursor === "ns-resize" &&
                    el.style.display === "block",
                );
                const handle = candidates
                  .sort(
                    (a, b) =>
                      Math.abs(a.getBoundingClientRect().y - card.bottom) -
                      Math.abs(b.getBoundingClientRect().y - card.bottom),
                  )[0]!
                  .getBoundingClientRect();
                const outer = frame.getBoundingClientRect();
                const scale = outer.width / frame.contentWindow!.innerWidth;
                return {
                  x: outer.x + (handle.x + handle.width / 2) * scale,
                  y: outer.y + (handle.y + handle.height / 2) * scale,
                  scale,
                  screenWidth: handle.width * scale,
                };
              });
              expect(handle.screenWidth).toBeCloseTo(8, 1);
              await page.mouse.move(handle.x, handle.y);
              await page.mouse.down();
              await page.mouse.move(handle.x, handle.y + 19 * handle.scale, {
                steps: 5,
              });
              await page.mouse.up();
              await until(() =>
                readFileSync(file, "utf8").includes(
                  'className="w-64 bg-red-200 h-25"',
                ),
              );
              expect(readFileSync(file, "utf8")).toBe(
                beforeResize.replace(
                  "h-20 w-64 bg-red-200",
                  "w-64 bg-red-200 h-25",
                ),
              );
              await swapped(page, cardVersion);
              await selected(page, "#card");
              await (
                await shown(page)
              ).waitForFunction(
                () =>
                  getComputedStyle(document.querySelector("#card")!).height ===
                  "100px",
              );

              await click(page, '[data-item="3"]');
              await selected(page, '[data-item="3"]');
              const moveVersion = await version(page);
              const from = await point(page, '[data-item="3"]');
              const to = await point(page, '[data-item="1"]', true);
              await page.mouse.move(from.x, from.y);
              await page.mouse.down();
              await page.mouse.move(to.x, to.y, { steps: 8 });
              await page.mouse.up();
              await swapped(page, moveVersion);
              await selected(page, '[data-item="3"]');
              expect(readFileSync(file, "utf8")).toContain(
                '        <p data-item="3" key="third" className="h-8">Item 3</p>\n        <p data-item="1"',
              );

              await click(page, '[data-item="2"]');
              await selected(page, '[data-item="2"]');
              const deleteVersion = await version(page);
              await page.keyboard.press("Delete");
              await swapped(page, deleteVersion);
              expect(readFileSync(file, "utf8")).not.toContain('data-item="2"');
              await click(page, '[data-item="3"]');
              await selected(page, '[data-item="3"]');
              await click(page, '[data-item="3"]');
              expect(
                await page.evaluate(() => document.activeElement?.tagName),
              ).toBe("IFRAME");
              const duplicateVersion = await version(page);
              const nativeFrame = await shown(page);
              // Observe native default prevention without replacing the real key event.
              await (
                await shown(page)
              ).evaluate(() => {
                window.addEventListener("keydown", (event) => {
                  if (event.metaKey && event.key.toLowerCase() === "d")
                    document.body.dataset.duplicatePrevented = String(
                      event.defaultPrevented,
                    );
                });
              });
              await shortcut(page, "d");
              await nativeFrame.waitForFunction(
                () => document.body.dataset.duplicatePrevented === "true",
              );
              await swapped(page, duplicateVersion);
              await selected(page, '[data-item="3"]', 1);
              expect(readFileSync(file, "utf8")).toContain(
                '        <p data-item="3" className="h-8">Item 3</p>',
              );
              expect(await browser.pages()).toHaveLength(2);
              const final = readFileSync(file, "utf8");
              for (let i = 0; i < 5; i++) {
                const v = await version(page);
                await shortcut(page, "z");
                await swapped(page, v);
              }
              expect(readFileSync(file, "utf8")).toBe(original);
              for (let i = 0; i < 5; i++) {
                const v = await version(page);
                await shortcut(page, "z", true);
                await swapped(page, v);
              }
              expect(readFileSync(file, "utf8")).toBe(final);
              await selected(page, '[data-item="3"]', 1);

              await click(page, "#button");
              await selected(page, "#button");
              expect(
                await page.$eval(
                  'section[aria-label="Quick edits"]',
                  (el) => el.textContent,
                ),
              ).not.toContain("shared component");
              const ref = await (
                await shown(page)
              ).$eval("#button", (el) => el.getAttribute("data-framio-src"));
              expect(parseSourceRef(ref!)?.file).toBe(
                "pages/01-test/quick.tsx",
              );
              const buttonSource = readFileSync(
                join(framio, "components/ui/button.tsx"),
                "utf8",
              );
              const buttonVersion = await version(page);
              await click(page, "#button", 2);
              await (
                await shown(page)
              ).waitForSelector('[contenteditable="plaintext-only"]');
              await page.keyboard.type("Save invoice");
              await page.keyboard.press("Enter");
              await swapped(page, buttonVersion);
              await selected(page, "#button");
              expect(readFileSync(file, "utf8")).toBe(
                final.replace("Create invoice", "Save invoice"),
              );
              expect(
                readFileSync(join(framio, "components/ui/button.tsx"), "utf8"),
              ).toBe(buttonSource);

              await click(page, "#variable");
              await selected(page, "#variable");
              expect(
                await page.$eval(
                  'section[aria-label="Quick edits"]',
                  (el) => el.textContent,
                ),
              ).toContain("Text comes from code");
              await click(page, "#mapped p");
              await selected(page, "#mapped p");
              const locked = await page.$eval(
                'section[aria-label="Quick edits"]',
                (el) => el.textContent,
              );
              expect(locked).toContain("order can't be changed");
              expect(locked).toContain("Applies to 3 items");
              const lockedSource = readFileSync(file, "utf8");
              const mappedFrom = await point(page, "#mapped p");
              const mappedTo = await point(page, "#mapped p:last-child");
              await page.mouse.move(mappedFrom.x, mappedFrom.y);
              await page.mouse.down();
              await page.mouse.move(mappedTo.x, mappedTo.y, { steps: 8 });
              await page.mouse.up();
              await Bun.sleep(100);
              expect(readFileSync(file, "utf8")).toBe(lockedSource);

              // Hold only the replacement navigation, keeping the stale displayed document available.
              await click(page, "#heading", 2);
              await (
                await shown(page)
              ).waitForSelector('[contenteditable="plaintext-only"]');
              await page.setRequestInterception(true);
              const held: import("puppeteer-core").HTTPRequest[] = [];
              let hold = true;
              page.on("request", (request) => {
                if (
                  hold &&
                  request.isNavigationRequest() &&
                  request.url().includes("/f/01-test/quick?")
                )
                  held.push(request);
                else void request.continue();
              });
              const stale = await shown(page);
              const conflictVersion = await version(page);
              const agent = lockedSource.replace(
                "vh edited heading",
                "Agent heading",
              );
              writeFileSync(file, agent);
              await page.keyboard.type("Rejected edit");
              await page.keyboard.press("Enter");
              await page.waitForFunction(
                (message) =>
                  [...document.querySelectorAll('[role="status"]')].some((el) =>
                    el.textContent?.includes(message),
                  ),
                {},
                editConflict,
              );
              await stale.waitForFunction(
                () =>
                  document.querySelector("#heading")!.textContent ===
                  "vh edited heading",
              );
              expect(readFileSync(file, "utf8")).toBe(agent);
              hold = false;
              await Promise.all(held.map((request) => request.continue()));
              await swapped(page, conflictVersion);
              expect(
                await (
                  await shown(page)
                ).$eval("#heading", (el) => el.textContent),
              ).toBe("Agent heading");
              // Captures must not inherit the selection handles from the Studio document.
              const capture = async () => {
                const response = await fetch(info.url + "/api/screenshot", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ frames: ["01-test/quick"] }),
                });
                expect(response.status).toBe(200);
                const result = (await response.json()) as {
                  results: { path: string; error: string | null }[];
                };
                expect(result.results[0]!.error).toBeNull();
                return readFileSync(result.results[0]!.path);
              };
              await click(page, "#card");
              await selected(page, "#card");
              const screenshot = await capture();
              const v = await version(page);
              const thumbUrl = `${info.url}/thumb/01-test/quick.png?v=${v}&width=480&scale=0.5`;
              const thumb = Buffer.from(
                await (await fetch(thumbUrl)).arrayBuffer(),
              );
              await click(page, "#variable");
              await selected(page, "#variable");
              expect(await capture()).toEqual(screenshot);
              expect(
                Buffer.from(await (await fetch(thumbUrl)).arrayBuffer()),
              ).toEqual(thumb);
              const standalone = await browser.newPage();
              try {
                const dimensions = imageSize(screenshot, "png")!;
                await standalone.setViewport({
                  width: dimensions.width,
                  height: dimensions.height,
                  deviceScaleFactor: 1,
                });
                await standalone.goto(
                  info.url + "/f/01-test/quick?width=480&height=640",
                );
                await standalone.waitForFunction("window.__framio?.ready");
                expect(
                  await standalone.evaluate(
                    () =>
                      [...document.querySelectorAll<HTMLElement>("div")].filter(
                        (el) => el.style.cursor.endsWith("resize"),
                      ).length,
                  ),
                ).toBe(0);
                expect(
                  Buffer.from(
                    await standalone.screenshot({ fullPage: true }),
                  ).equals(screenshot),
                ).toBe(true);
              } finally {
                await standalone.close();
              }
              expect(errors).toEqual([]);
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
}, 90_000);
