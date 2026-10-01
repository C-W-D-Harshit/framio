import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { CanvasRequest, ScreenshotRequest } from "../../src/contracts/requests";
import { Snapshot } from "../../src/contracts/snapshot";
import { ImageSidecar } from "../../src/domain/project";

describe("shared contracts", () => {
  it.effect("rejects invalid geometry before persistence or capture", () => Effect.gen(function*() {
    for (const scale of [0, -1, NaN, Infinity]) {
      const result = yield* Schema.decodeUnknownEffect(ScreenshotRequest)({ scale }).pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
    }
    const result = yield* Schema.decodeUnknownEffect(CanvasRequest)({ page: "01-example", positions: { frame: { x: Infinity, y: 0 } } }).pipe(Effect.result);
    assert.strictEqual(result._tag, "Failure");
  }));

  it.effect("preserves valid image sidecars and rejects malformed fields", () => Effect.gen(function*() {
    const side = { name: "Reference", width: 390, note: "Typography", source: "https://example.com" };
    assert.deepStrictEqual(yield* Schema.decodeUnknownEffect(ImageSidecar)(side), side);
    for (const input of [null, [], { width: -1 }, { note: {} }, { name: 42 }]) {
      assert.strictEqual((yield* Schema.decodeUnknownEffect(ImageSidecar)(input).pipe(Effect.result))._tag, "Failure");
    }
  }));

  it.effect("round trips the existing snapshot wire shape", () => Effect.gen(function*() {
    const snapshot: Snapshot = { projectName: "Fixture", cssVersion: 1, cssError: null, pages: [{ id: "01-example", name: "Example", positions: {}, frames: [{ id: "01-example/frame", page: "01-example", slug: "frame", kind: "tsx", relFile: ".framio/pages/01-example/frame.tsx", meta: { name: "Frame", width: 390, height: 844 }, parent: null, version: 1, error: null }] }] };
    const decoded = yield* Schema.decodeUnknownEffect(Snapshot)(snapshot);
    assert.deepStrictEqual(yield* Schema.encodeEffect(Snapshot)(decoded), snapshot);
  }));
});
