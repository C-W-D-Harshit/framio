import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { saveReferenceCapture } from "../../src/commands/references";
import { DesignReference } from "../../src/contracts/references";
import {
  designReferences,
  referenceById,
  searchReferences,
} from "../../src/domain/references";
import { validateScreenshot } from "../../src/domain/screenshot";
import { projectPaths } from "../../src/lib/paths";

describe("visual references", () => {
  it.effect("finds relevant candidates and refuses unknown capture IDs", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        searchReferences("  ERP DARK  ").map((item) => item.id),
        ["dusk-landing-1"],
      );
      assert.deepStrictEqual(searchReferences("unrelated-query"), []);
      assert.strictEqual(searchReferences().length, 5);
      assert.strictEqual(
        (yield* referenceById("../../outside").pipe(Effect.result))._tag,
        "Failure",
      );
      yield* Schema.decodeUnknownEffect(Schema.Array(DesignReference))(
        designReferences,
      );
    }),
  );

  it.effect(
    "allows viewport-only URL captures without changing frame capture semantics",
    () =>
      Effect.gen(function* () {
        const request = yield* validateScreenshot({
          url: "https://example.com",
          viewportOnly: true,
          width: 960,
          height: 600,
        });
        assert.isTrue(request.viewportOnly);
        assert.strictEqual(
          (yield* validateScreenshot({
            frames: ["page/hero"],
            viewportOnly: true,
          }).pipe(Effect.result))._tag,
          "Failure",
        );
      }),
  );

  it.effect(
    "publishes the immutable image with source notes before exposing a new frame",
    () =>
      Effect.gen(function* () {
        const reference = yield* referenceById("axis");
        const operations: string[] = [];
        const files = new Map<string, string>([
          ["/existing.png.json", "Keep my notes"],
        ]);
        const fs = FileSystem.makeNoop({
          makeDirectory: () => Effect.void,
          copyFile: (from, to) =>
            Effect.sync(() => {
              operations.push(`copy:${from}`);
              files.set(to, "reference pixels");
            }),
          writeFileString: (path, content) =>
            Effect.sync(() => {
              operations.push("sidecar");
              files.set(path, content);
            }),
          rename: (from, to) =>
            Effect.sync(() => {
              operations.push("publish");
              files.set(to, files.get(from)!);
              files.delete(from);
            }),
          remove: (path) =>
            Effect.sync(() => {
              files.delete(path);
            }),
        });
        const result = yield* saveReferenceCapture(
          projectPaths("/project"),
          reference,
          {
            results: [
              {
                frame: reference.previewUrl,
                path: "/latest.png",
                archivePath: "/immutable.png",
                captureId: "capture-1",
                width: 960,
                height: 600,
              },
            ],
          },
        ).pipe(Effect.provideService(FileSystem.FileSystem, fs));
        assert.deepStrictEqual(operations, [
          "copy:/immutable.png",
          "sidecar",
          "publish",
        ]);
        assert.strictEqual(result.captureId, "capture-1");
        assert.strictEqual(result.width, 960);
        assert.strictEqual(result.height, 600);
        assert.isTrue(result.frame.startsWith("01-moodboard/axis-"));
        assert.strictEqual(files.get(result.path), "reference pixels");
        const sidecar = JSON.parse(files.get(result.sidecarPath)!);
        assert.strictEqual(sidecar.source, reference.previewUrl);
        assert.include(sidecar.note, reference.borrow);
        assert.strictEqual(files.get("/existing.png.json"), "Keep my notes");
        assert.strictEqual(files.size, 3);
      }),
  );

  it.effect("does not publish a frame for failed or unrelated captures", () =>
    Effect.gen(function* () {
      const reference = yield* referenceById("axis");
      for (const results of [
        [{ frame: reference.previewUrl, error: "URL returned HTTP 403" }],
        [
          {
            frame: "another-url",
            path: "/unrelated.png",
            width: 960,
            height: 600,
          },
        ],
        [{ frame: reference.previewUrl, path: "/incomplete.png", width: 960 }],
      ]) {
        const result = yield* saveReferenceCapture(
          projectPaths("/project"),
          reference,
          { results },
        ).pipe(
          Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
          Effect.result,
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.strictEqual(result.failure._tag, "CaptureFailed");
      }
    }),
  );

  it.effect(
    "cleans incomplete publication while preserving existing notes",
    () =>
      Effect.gen(function* () {
        const reference = yield* referenceById("axis");
        const files = new Map<string, string>([
          ["/existing.png.json", "Keep my notes"],
        ]);
        const fs = FileSystem.makeNoop({
          makeDirectory: () => Effect.void,
          copyFile: (_, to) =>
            Effect.sync(() => {
              files.set(to, "pixels");
            }),
          writeFileString: (path, content) =>
            Effect.sync(() => {
              files.set(path, content);
            }),
          remove: (path) =>
            Effect.sync(() => {
              files.delete(path);
            }),
        });
        const result = yield* saveReferenceCapture(
          projectPaths("/project"),
          reference,
          {
            results: [
              {
                frame: reference.previewUrl,
                path: "/capture.png",
                width: 960,
                height: 600,
              },
            ],
          },
        ).pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.result);
        assert.strictEqual(result._tag, "Failure");
        assert.deepStrictEqual(
          [...files],
          [["/existing.png.json", "Keep my notes"]],
        );
      }),
  );
});
