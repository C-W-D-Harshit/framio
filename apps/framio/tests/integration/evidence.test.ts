import { expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Fiber } from "effect";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { ensureBrowser } from "../../src/lib/browser";
import {
  emptyEvidence,
  type EvidenceFile,
  type EvidenceResponse,
} from "../../src/contracts/evidence";
import type { Snapshot } from "../../src/contracts/snapshot";
import type { ScreenshotResponse } from "../../src/contracts/requests";
import { reviewStatus } from "../../src/domain/evidence";
import { runServer } from "../../src/server/server";
import { ProjectState } from "../../src/services/project-state";
import { frameRevision } from "../../src/services/frame-revision";
import { projectPaths } from "../../src/lib/paths";
import { evidenceContextRevision } from "../../src/services/evidence";

test("canvas reviews retain immutable mobile captures and expire on source, theme, assets and brief changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-evidence-"));
  const dir = join(root, ".framio");
  mkdirSync(join(dir, "pages/01-test"), { recursive: true });
  mkdirSync(join(dir, "assets"));
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(dir, "node_modules"),
  );
  const file = join(dir, "pages/01-test/hero.tsx");
  const source = (text: string, height = 300) =>
    `import React from "react";export const meta={name:"Approval hero",width:1440,height:${height},widths:[1440,390]};export default function Frame(){return <main style={{padding:24,minHeight:300}}><section data-layer="Product Task"><h1>${text}</h1><p>An invoice and its approval context.</p></section></main>}`;
  writeFileSync(file, source("Invoice approvals"));
  writeFileSync(
    join(dir, "theme.css"),
    "body { margin: 0; color: #111; background: #fff; }",
  );
  writeFileSync(
    join(dir, "assets/mark.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>',
  );
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            const get = async <T>(path: string): Promise<T> => {
              const result = await fetch(`${info.url}${path}`);
              expect(result.ok).toBe(true);
              return result.json();
            };
            const post = async <T>(path: string, body: unknown): Promise<T> => {
              const result = await fetch(`${info.url}${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              });
              expect(result.ok).toBe(true);
              return result.json();
            };
            const snapshot = () => get<Snapshot>("/api/project");
            const evidence = () =>
              get<typeof EvidenceResponse.Type>("/api/evidence");
            const initial = await evidence();
            const doc: EvidenceFile = {
              ...emptyEvidence,
              brief: {
                audience: "Finance operators",
                difference: "Approval context beside the invoice",
                conversion: "Book a demo",
                facts: [],
                assumptions: ["Demo invoice amounts are synthetic."],
              },
              direction: {
                frame: "01-test/hero",
                referenceIds: [],
                composition: "Promise above the invoice task",
                why: "The user supplied this starting direction",
                alternatives: [],
              },
              projectNotes: "Keep this note",
            };
            expect(
              (
                await post<{ ok: boolean }>("/api/evidence", {
                  evidence: doc,
                  expectedRevision: initial.revision,
                })
              ).ok,
            ).toBe(true);
            await evidence();
            const browser = await puppeteer.launch({
              executablePath: await Effect.runPromise(
                ensureBrowser().pipe(Effect.provide(BunServices.layer)),
              ),
              headless: true,
            });
            try {
              const page = await browser.newPage();
              page.setDefaultTimeout(5000);
              await page.setViewport({ width: 1280, height: 900 });
              await page.goto(info.url);
              await page
                .locator('button[aria-label="Design evidence"]')
                .click();
              const shot = (
                await post<typeof ScreenshotResponse.Type>("/api/screenshot", {
                  frames: ["01-test/hero"],
                  width: 390,
                })
              ).results[0]!;
              expect(shot.error).toBeNull();
              expect(shot.captureId).toBeString();
              expect(shot.viewportWidth).toBe(390);
              expect(shot.archivePath).not.toBe(shot.path);
              const archived = readFileSync(shot.archivePath!);
              await page.waitForFunction(
                () =>
                  !!document.querySelector(
                    '[aria-label="Design evidence"][data-slot="sidebar"] img[alt*="Captured 01-test/hero"]',
                  ),
              );
              const before = await snapshot();
              expect(shot.revision).toBe(before.pages[0]!.frames[0]!.revision);
              const captured = await evidence();
              const review = {
                id: "mobile-composition",
                frame: "01-test/hero",
                captureId: shot.captureId!,
                kind: "composition" as const,
                verdict: "pass" as const,
                findings: ["Invoice task remains readable at 390px."],
                changes: [],
                createdAt: new Date().toISOString(),
              };
              const reviewed = { ...doc, reviews: [review] };
              expect(
                (
                  await post<{ ok: boolean }>("/api/evidence", {
                    evidence: reviewed,
                    expectedRevision: captured.revision,
                  })
                ).ok,
              ).toBe(true);
              const current = await evidence();
              const currentSnapshot = await snapshot();
              expect(
                reviewStatus(
                  review,
                  current.captures,
                  currentSnapshot.pages.flatMap((p) => p.frames),
                  current.contextRevision,
                ).status,
              ).toBe("current");
              await page.waitForFunction(() =>
                document
                  .querySelector(
                    '[aria-label="Design evidence"][data-slot="sidebar"]',
                  )
                  ?.textContent?.includes("Pass"),
              );
              expect(
                await page.$eval(
                  '[aria-label="Design evidence"][data-slot="sidebar"]',
                  (el) => el.textContent,
                ),
              ).toContain("Finance operators");
              writeFileSync(file, source("Approve invoices with context"));
              await page.waitForFunction(() =>
                document
                  .querySelector(
                    '[aria-label="Design evidence"][data-slot="sidebar"]',
                  )
                  ?.textContent?.includes("Outdated"),
              );
              const afterSource = await evidence();
              expect(afterSource.evidence.reviews).toEqual([review]);
              const newShot = (
                await post<typeof ScreenshotResponse.Type>("/api/screenshot", {
                  frames: ["01-test/hero"],
                  width: 390,
                })
              ).results[0]!;
              expect(newShot.error).toBeNull();
              expect(readFileSync(shot.archivePath!)).toEqual(archived);
              expect(readFileSync(newShot.archivePath!)).not.toEqual(archived);
              let revision = newShot.revision;
              for (const change of [
                () =>
                  writeFileSync(
                    join(dir, "theme.css"),
                    "body { margin:0; color:#222; background:#fafafa; }",
                  ),
                () =>
                  writeFileSync(
                    join(dir, "assets/mark.svg"),
                    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="blue"/></svg>',
                  ),
                () =>
                  writeFileSync(
                    file,
                    source("Approve invoices with context", 400),
                  ),
              ]) {
                change();
                let changed: Snapshot | undefined;
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                  await evidence();
                  changed = await snapshot();
                  if (changed.pages[0]!.frames[0]!.revision !== revision) break;
                  await Bun.sleep(20);
                }
                expect(changed!.pages[0]!.frames[0]!.revision).not.toBe(
                  revision,
                );
                revision = changed!.pages[0]!.frames[0]!.revision;
              }
              const latest = await evidence();
              expect(
                (
                  await post<{ ok: boolean }>("/api/evidence", {
                    evidence: {
                      ...reviewed,
                      brief: { ...doc.brief!, audience: "Controllers" },
                    },
                    expectedRevision: latest.revision,
                  })
                ).ok,
              ).toBe(true);
              const changedBrief = await evidence();
              expect(changedBrief.contextRevision).not.toBe(
                current.contextRevision,
              );
              expect(
                (
                  await post<{ ok: boolean }>("/api/evidence", {
                    evidence: doc,
                    expectedRevision: latest.revision,
                  })
                ).ok,
              ).toBe(false);
              expect((await evidence()).evidence.projectNotes).toBe(
                "Keep this note",
              );
            } finally {
              await browser.close();
            }
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          yield* Effect.promise(async () => {
            const state = (await (
              await fetch(`${info.url}/api/evidence`)
            ).json()) as typeof EvidenceResponse.Type;
            const restored = (await (
              await fetch(`${info.url}/api/project`)
            ).json()) as Snapshot;
            expect(state.captures.length).toBeGreaterThan(0);
            const review = state.evidence.reviews[0]!;
            expect(
              reviewStatus(
                review,
                state.captures,
                restored.pages.flatMap((p) => p.frames),
                state.contextRevision,
              ).status,
            ).toBe("outdated");
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 40_000);

test("capture retention waits for an evidence save and preserves its reviewed image", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-evidence-retention-"));
  const p = projectPaths(root);
  mkdirSync(join(p.screenshots, "history"), { recursive: true });
  mkdirSync(p.pages, { recursive: true });
  writeFileSync(p.theme, "body { margin:0; }");
  const captures = Array.from({ length: 60 }, (_, index) => ({
    id: `capture-${index}`,
    frame: "01-test/hero",
    path: `history/capture-${index}.png`,
    revision: "fixture-revision",
    contextRevision: evidenceContextRevision(emptyEvidence),
    generation: 1,
    viewportWidth: 390,
    width: 390,
    height: 844,
    capturedAt: "2026-10-02T12:00:00Z",
  }));
  writeFileSync(join(p.state, "captures.json"), JSON.stringify(captures));
  for (const capture of captures)
    writeFileSync(join(p.screenshots, capture.path), "archive fixture");
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const project = yield* ProjectState;
          const started = yield* Deferred.make<void>();
          const continueSave = yield* Deferred.make<void>();
          const review = {
            id: "review-55",
            frame: "01-test/hero",
            captureId: "capture-55",
            kind: "composition" as const,
            verdict: "revise" as const,
            findings: ["Retain this earlier image."],
            changes: [],
            createdAt: "2026-10-02T12:01:00Z",
          };
          const writer = yield* project
            .withEvidenceWrite(
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(continueSave);
                yield* Effect.sync(() =>
                  writeFileSync(
                    join(p.framio, "evidence.json"),
                    JSON.stringify({ ...emptyEvidence, reviews: [review] }),
                  ),
                );
                yield* project.notify("evidence.json");
              }),
            )
            .pipe(Effect.forkChild);
          yield* Deferred.await(started);
          const incoming = {
            ...captures[0]!,
            id: "capture-new",
            path: "history/capture-new.png",
          };
          writeFileSync(join(p.screenshots, incoming.path), "new archive");
          const prune = yield* project
            .recordCaptures([incoming])
            .pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          expect(prune.pollUnsafe()).toBeUndefined();
          yield* Deferred.succeed(continueSave, undefined);
          yield* Fiber.join(writer);
          yield* Fiber.join(prune);
          const current = yield* project.get;
          expect(
            current.captures?.some((capture) => capture.id === "capture-55"),
          ).toBe(true);
          expect(
            readFileSync(join(p.screenshots, "history/capture-55.png"), "utf8"),
          ).toBe("archive fixture");
          expect(
            current.captures?.some((capture) => capture.id === "capture-56"),
          ).toBe(false);
          expect(
            yield* Effect.promise(() =>
              Bun.file(join(p.screenshots, "history/capture-56.png")).exists(),
            ),
          ).toBe(false);
        }),
      ).pipe(
        Effect.provide(ProjectState.layer(p)),
        Effect.provide(BunServices.layer),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

test("replacing a linked reference image invalidates comparison evidence without changing the product frame", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-reference-revision-"));
  const p = projectPaths(root);
  mkdirSync(join(p.pages, "01-test"), { recursive: true });
  mkdirSync(p.state, { recursive: true });
  writeFileSync(p.theme, "body { margin:0; }");
  writeFileSync(
    join(p.pages, "01-test/hero.tsx"),
    'export const meta={name:"Hero",width:390,height:844};export default function Frame(){return null}',
  );
  const referenceFile = join(p.pages, "01-test/reference.svg");
  const reference = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="${fill}"/></svg>`;
  writeFileSync(referenceFile, reference("red"));
  writeFileSync(
    join(p.framio, "evidence.json"),
    JSON.stringify({
      ...emptyEvidence,
      references: [
        {
          id: "reference",
          name: "Rendered reference",
          url: "https://example.com",
          previewFrame: "01-test/reference.svg",
          borrow: "Compare the product composition.",
        },
      ],
    }),
  );
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const project = yield* ProjectState;
          const before = yield* project.get;
          const hero = before.pages[0]!.frames.find(
            (frame) => frame.slug === "hero",
          )!;
          const revision = frameRevision(before, hero);
          yield* Effect.sync(() =>
            writeFileSync(referenceFile, reference("blue")),
          );
          yield* project.notify("pages/01-test/reference.svg");
          const after = yield* project.withStableState(Effect.succeed);
          expect(after.evidenceContextRevision).not.toBe(
            before.evidenceContextRevision,
          );
          expect(frameRevision(after, hero)).toBe(revision);
        }),
      ).pipe(
        Effect.provide(ProjectState.layer(p)),
        Effect.provide(BunServices.layer),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
