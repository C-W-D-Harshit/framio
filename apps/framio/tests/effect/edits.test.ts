import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { CanvasMessage, FrameMessage } from "../../src/contracts/frame-message";
import {
  decodeCapabilities,
  decodeLocks,
  EditCapability,
  EditOperation,
  encodeCapabilities,
  encodeLocks,
  formatSourceRef,
  LockReason,
  parseSourceRef,
  SourceRef,
  type ElementLock,
} from "../../src/contracts/edits";

const rev = "0123456789abcdef".repeat(4);
const ref = "pages/home/frame.tsx:0:24:0123456789ab";

describe("quick edit contracts", () => {
  it.effect("preserves select envelopes and round trips the new messages", () =>
    Effect.gen(function* () {
      const base = { source: "framio", frame: "home/frame" } as const;
      const select = { ...base, type: "select", element: null } as const;
      const selection = {
        ref,
        index: 1,
        count: 2,
        allowed: ["text"],
        locks: [{ capability: "move", reason: "dynamic-siblings" }],
      } as const;
      for (const message of [
        select,
        { ...select, sourceSelection: selection },
        { ...base, type: "edit", id: "edit-1", edit: { type: "remove", ref } },
        { ...base, type: "text-editing", active: true },
      ] as const) {
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(FrameMessage)(message),
          message,
        );
      }
      for (const message of [
        { source: "framio-canvas", type: "select-source", ref, index: 1 },
        { source: "framio-canvas", type: "command", command: "edit-text" },
        { source: "framio-canvas", type: "command", command: "remove" },
        { source: "framio-canvas", type: "command", command: "duplicate" },
        {
          source: "framio-canvas",
          type: "edit-result",
          id: "edit-1",
          ok: false,
        },
      ] as const) {
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(CanvasMessage)(message),
          message,
        );
      }
    }),
  );

  it.effect("formats relative paths and truncates full revisions", () =>
    Effect.sync(() => {
      assert.strictEqual(
        formatSourceRef({
          file: "pages/home/frame.tsx",
          start: 0,
          end: 24,
          rev,
        }),
        ref,
      );
      assert.strictEqual(
        formatSourceRef({
          file: "pages\\home\\frame.tsx",
          start: 0,
          end: 24,
          rev,
        }),
        ref,
      );
      assert.deepStrictEqual(parseSourceRef(ref), {
        file: "pages/home/frame.tsx",
        start: 0,
        end: 24,
        rev: rev.slice(0, 12),
      });
    }),
  );

  it.effect("parses from the right and preserves UTF-16 offsets", () =>
    Effect.sync(() => {
      const text = 'const emoji = "😀"; <p>Hello</p>';
      const start = text.indexOf("<p>");
      const location = {
        file: "pages/name:with:colons.tsx",
        start,
        end: text.length,
        rev: rev.slice(0, 12),
      };
      const parsed = parseSourceRef(formatSourceRef(location));
      assert.deepStrictEqual(parsed, location);
      assert.strictEqual(
        text.slice(parsed!.start, parsed!.end),
        "<p>Hello</p>",
      );
    }),
  );

  it.effect("rejects malformed refs and invalid source spans", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* Schema.decodeUnknownEffect(SourceRef)(ref),
        ref,
      );
      for (const value of [
        "",
        "pages/home.tsx",
        ":0:24:0123456789ab",
        "/pages/home.tsx:0:24:0123456789ab",
        "pages\\home.tsx:0:24:0123456789ab",
        "pages/home.tsx:-1:24:0123456789ab",
        "pages/home.tsx:1.5:24:0123456789ab",
        "pages/home.tsx:24:0:0123456789ab",
        "pages/home.tsx:0:9007199254740992:0123456789ab",
        "pages/home.tsx:0:24:0123456789a",
        "pages/home.tsx:0:24:0123456789abc",
        "pages/home.tsx:0:24:0123456789ag",
        `${ref}\n`,
      ]) {
        assert.strictEqual(parseSourceRef(value), null, value);
        assert.strictEqual(
          (yield* Schema.decodeUnknownEffect(SourceRef)(value).pipe(
            Effect.result,
          ))._tag,
          "Failure",
          value,
        );
      }
    }),
  );

  it.effect("round trips capabilities and ignores unknown tokens", () =>
    Effect.sync(() => {
      const capabilities = [...EditCapability.literals];
      assert.strictEqual(
        encodeCapabilities(capabilities),
        "text,size,move,remove,duplicate",
      );
      assert.deepStrictEqual(
        decodeCapabilities(encodeCapabilities(capabilities)),
        capabilities,
      );
      assert.deepStrictEqual(
        decodeCapabilities("text,unknown,,size,remove,nope"),
        ["text", "size", "remove"],
      );
      assert.strictEqual(encodeCapabilities([]), "");
      assert.deepStrictEqual(decodeCapabilities(null), []);
      assert.deepStrictEqual(decodeCapabilities(""), []);
    }),
  );

  it.effect("round trips locks and ignores unknown or malformed pairs", () =>
    Effect.sync(() => {
      const locks: ElementLock[] = [
        { capability: "text", reason: "dynamic-text" },
        { capability: "move", reason: "dynamic-siblings" },
      ];
      const encoded = "text:dynamic-text;move:dynamic-siblings";
      assert.strictEqual(encodeLocks(locks), encoded);
      assert.deepStrictEqual(decodeLocks(encoded), locks);
      const allReasons = LockReason.literals.map((reason) => ({
        capability: "text" as const,
        reason,
      }));
      assert.deepStrictEqual(decodeLocks(encodeLocks(allReasons)), allReasons);
      assert.deepStrictEqual(
        decodeLocks(
          `${encoded};unknown:dynamic-text;text:unknown;remove;:dynamic-text;text:;text:dynamic-text:extra;;`,
        ),
        locks,
      );
      assert.strictEqual(encodeLocks([]), "");
      assert.deepStrictEqual(decodeLocks(null), []);
      assert.deepStrictEqual(decodeLocks(""), []);
    }),
  );

  it.effect("rejects multiline text and non-finite sizes", () =>
    Effect.gen(function* () {
      for (const text of ["", "Hello <world> & friends"]) {
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(EditOperation)({
            type: "text",
            ref,
            text,
          }),
          { type: "text", ref, text },
        );
      }
      for (const text of [
        "line\nbreak",
        "trailing\n",
        "carriage\r",
        "line\r\nbreak",
      ]) {
        assert.strictEqual(
          (yield* Schema.decodeUnknownEffect(EditOperation)({
            type: "text",
            ref,
            text,
          }).pipe(Effect.result))._tag,
          "Failure",
        );
      }
      const size = { type: "size", ref, width: null, height: 123.5 } as const;
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(EditOperation)(size),
        size,
      );
      for (const dimension of [NaN, Infinity, -Infinity]) {
        for (const size of [
          { type: "size", ref, width: dimension, height: null },
          { type: "size", ref, width: null, height: dimension },
        ]) {
          assert.strictEqual(
            (yield* Schema.decodeUnknownEffect(EditOperation)(size).pipe(
              Effect.result,
            ))._tag,
            "Failure",
          );
        }
      }
    }),
  );
});
