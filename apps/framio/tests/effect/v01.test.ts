import { assert, describe, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { makeComments, readComments } from "../../src/services/comments";
import { parseMeta } from "../../src/server/project";
import { viewports } from "../../src/domain/viewports";
import { validateScreenshot } from "../../src/domain/screenshot";
import type { Comment } from "../../src/contracts/comments";

const comment: Comment = {
  id: "one",
  frame: "page/frame",
  anchor: { selector: "#root > h1", x: 10, y: 12 },
  body: "Fix heading",
  author: "user",
  status: "open",
  createdAt: "2026-10-01T00:00:00.000Z",
  replies: [],
};
describe("v0.1 files and commands", () => {
  it.effect(
    "retries concurrent editor changes and preserves all replies and extra fields",
    () =>
      Effect.gen(function* () {
        const storage = yield* Ref.make<string | null>(
          JSON.stringify({ comments: [comment], custom: { keep: true } }),
        );
        let writes = 0;
        const service = yield* makeComments({
          read: Ref.get(storage),
          commit: (expected, next) =>
            Effect.gen(function* () {
              if (writes++ === 0) {
                yield* Ref.set(
                  storage,
                  JSON.stringify({
                    custom: { keep: true },
                    comments: [
                      {
                        ...comment,
                        body: "Agent revised heading",
                        replies: [
                          {
                            author: "agent",
                            body: "Adjusted typography",
                            createdAt: "2026-10-01T01:00:00Z",
                          },
                        ],
                      },
                      { ...comment, id: "two", body: "Other user comment" },
                    ],
                  }),
                );
                return false;
              }
              if ((yield* Ref.get(storage)) !== expected) return false;
              yield* Ref.set(storage, next);
              return true;
            }),
        });
        const reply = {
          author: "user" as const,
          body: "Thanks",
          createdAt: "2026-10-01T02:00:00Z",
        };
        yield* service.apply({ type: "reply", id: "one", reply });
        yield* service.apply({ type: "reply", id: "one", reply });
        yield* service.apply({
          type: "status",
          id: "one",
          expected: "open",
          status: "resolved",
        });
        const file = yield* readComments(yield* Ref.get(storage));
        assert.strictEqual(file.comments.length, 2);
        assert.deepStrictEqual(file.custom, { keep: true });
        assert.strictEqual(file.comments[0]!.body, "Agent revised heading");
        assert.deepStrictEqual(
          file.comments[0]!.replies.map((r) => r.author),
          ["agent", "user"],
        );
        assert.strictEqual(file.comments[0]!.status, "resolved");
        assert.strictEqual(
          (yield* service
            .apply({ type: "delete", id: "one", expected: comment })
            .pipe(Effect.result))._tag,
          "Failure",
        );
        assert.strictEqual(
          (yield* readComments(yield* Ref.get(storage))).comments.length,
          2,
        );
      }),
  );
  it.effect(
    "broken comments never cause a write and duplicate IDs fail validation",
    () =>
      Effect.gen(function* () {
        for (const text of [
          "{broken",
          '{"comments":null}',
          JSON.stringify({ comments: [comment, comment] }),
          JSON.stringify({
            comments: [{ ...comment, body: " ", status: "bad" }],
          }),
        ]) {
          let wrote = false;
          const service = yield* makeComments({
            read: Effect.succeed(text),
            commit: () =>
              Effect.sync(() => {
                wrote = true;
                return true;
              }),
          });
          const result = yield* service
            .apply({ type: "create", comment })
            .pipe(Effect.result);
          assert.strictEqual(result._tag, "Failure");
          assert.strictEqual(wrote, false);
        }
      }),
  );
  it.effect(
    "responsive metadata uses width-specific heights and rejects malformed arrays",
    () =>
      Effect.sync(() => {
        const meta = {
          name: "Responsive",
          height: 900,
          width: 1440,
          ...parseMeta(
            "export const meta = { widths: [1440, 768, 390], height: 900 };",
          ),
        };
        assert.deepStrictEqual(viewports(meta), [
          { width: 1440, height: 900 },
          { width: 768, height: 1024 },
          { width: 390, height: 844 },
        ]);
        assert.deepStrictEqual(
          viewports({ ...meta, heights: [1000, 1100, 880] }),
          [
            { width: 1440, height: 1000 },
            { width: 768, height: 1100 },
            { width: 390, height: 880 },
          ],
        );
        assert.deepStrictEqual(
          viewports({ name: "Legacy", width: 390, height: 777 }),
          [{ width: 390, height: 777 }],
        );
        for (const data of [
          "widths: []",
          "widths: [390, 390]",
          "widths: [0]",
          "widths: [1.5]",
          "widths: [390], heights: [844, 900]",
          "heights: [900]",
        ])
          assert.throws(() => parseMeta(`export const meta = { ${data} };`));
      }),
  );
  it.effect("handoff arguments validate before launching a server", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        (yield* validateScreenshot({
          url: "http://localhost:3000",
          compare: "page/frame",
          into: "01-before",
          width: 390,
          height: 844,
          scale: 2,
        })).width,
        390,
      );
      for (const input of [
        { url: "file:///etc/passwd" },
        { url: "https://example.com", layers: ["Header"] },
        { page: "one", layers: ["Header"] },
        { url: "invalid" },
        { url: "https://example.com", frames: ["one"] },
        { compare: "page/frame" },
        { into: "page" },
        { url: "http://localhost", into: "../outside" },
        { url: "http://localhost", width: -1 },
        {},
      ])
        assert.strictEqual(
          (yield* validateScreenshot(input).pipe(Effect.result))._tag,
          "Failure",
        );
      assert.strictEqual(
        (yield* validateScreenshot({ url: "https://example.com" }, true).pipe(
          Effect.result,
        ))._tag,
        "Failure",
      );
      yield* validateScreenshot({ frames: ["one"], width: 390 });
      yield* validateScreenshot({}, true);
    }),
  );
});
