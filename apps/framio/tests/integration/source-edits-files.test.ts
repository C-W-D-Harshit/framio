import { expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSourceEdits } from "../../src/services/source-edits";
import { sourceRevision } from "../../src/server/source-edits";

const original = "<div><p>Hello</p></div>";
const patch = (file = "pages/home/frame.tsx") => ({
  file,
  revision: sourceRevision(original),
  start: 0,
  end: 0,
  text: "// Edited\n",
});

async function withFiles(
  check: (root: string, framio: string) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "framio-source-files-"));
  const framio = join(root, ".framio");
  mkdirSync(join(framio, "pages/home"), { recursive: true });
  writeFileSync(join(framio, "pages/home/frame.tsx"), original);
  try {
    await check(root, framio);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("source writes and exact undo work through an aliased project root", () =>
  withFiles(async (root, framio) => {
    const alias = join(root, "alias");
    symlinkSync(framio, alias, "dir");
    await Effect.runPromise(
      Effect.gen(function* () {
        const edits = yield* makeSourceEdits(alias);
        const result = yield* edits.patch(patch());
        expect(result.ok).toBe(true);
        expect(readFileSync(join(framio, patch().file), "utf8")).toBe(
          "// Edited\n" + original,
        );
        if (result.ok)
          expect((yield* edits.patch(result.inverse)).ok).toBe(true);
        expect(readFileSync(join(framio, patch().file), "utf8")).toBe(original);
      }).pipe(Effect.provide(BunServices.layer)),
    );
  }));

test("source edits reject file and parent symlinks within and outside pages", () =>
  withFiles(async (root, framio) => {
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "frame.tsx"), original);
    symlinkSync(
      join(framio, "pages/home/frame.tsx"),
      join(framio, "pages/inside.tsx"),
    );
    symlinkSync(join(outside, "frame.tsx"), join(framio, "pages/outside.tsx"));
    symlinkSync(
      join(framio, "pages/home"),
      join(framio, "pages/inside"),
      "dir",
    );
    symlinkSync(outside, join(framio, "pages/outside"), "dir");
    await Effect.runPromise(
      Effect.gen(function* () {
        const edits = yield* makeSourceEdits(framio);
        for (const file of [
          "pages/inside.tsx",
          "pages/outside.tsx",
          "pages/inside/frame.tsx",
          "pages/outside/frame.tsx",
        ])
          expect(yield* edits.patch(patch(file))).toMatchObject({
            ok: false,
            reason: "invalid",
          });
        expect(readFileSync(join(framio, patch().file), "utf8")).toBe(original);
        expect(readFileSync(join(outside, "frame.tsx"), "utf8")).toBe(original);
      }).pipe(Effect.provide(BunServices.layer)),
    );
  }));

test("source edits reject a symlinked pages directory", () =>
  withFiles(async (_root, framio) => {
    const pages = join(framio, "pages");
    const saved = join(framio, "saved-pages");
    mkdirSync(join(saved, "home"), { recursive: true });
    writeFileSync(join(saved, "home/frame.tsx"), original);
    rmSync(pages, { recursive: true });
    symlinkSync(saved, pages, "dir");
    await Effect.runPromise(
      Effect.gen(function* () {
        const edits = yield* makeSourceEdits(framio);
        expect(yield* edits.patch(patch())).toMatchObject({
          ok: false,
          reason: "invalid",
        });
        expect(readFileSync(join(saved, "home/frame.tsx"), "utf8")).toBe(
          original,
        );
      }).pipe(Effect.provide(BunServices.layer)),
    );
  }));
