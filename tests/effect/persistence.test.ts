import { assert, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { TestClock } from "effect/testing";
import { makePersistence } from "../../src/services/persistence";

it.effect(
  "merges pending deltas per page and serializes newer saves after an active save",
  () =>
    Effect.gen(function* () {
      const writes: unknown[] = [];
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const service = yield* makePersistence({
        selection: (payload) =>
          Effect.gen(function* () {
            writes.push(payload);
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }),
        canvas: (payload) =>
          Effect.sync(() => {
            writes.push(payload);
          }),
        onError: () => Effect.void,
      });
      yield* service.selection({ frames: ["old"], element: null });
      yield* TestClock.adjust(150);
      yield* Deferred.await(entered);
      yield* service.selection({ frames: ["new"], element: null });
      yield* service.canvas({ page: "a", positions: { one: { x: 1, y: 2 } } });
      yield* service.canvas({ page: "a", positions: { two: { x: 3, y: 4 } } });
      yield* service.canvas({ page: "b", positions: { one: { x: 5, y: 6 } } });
      assert.strictEqual(writes.length, 1);
      yield* Deferred.succeed(release, undefined);
      yield* TestClock.adjust(150);
      assert.deepStrictEqual(writes, [
        { frames: ["old"], element: null },
        { frames: ["new"], element: null },
        { page: "a", positions: { one: { x: 1, y: 2 }, two: { x: 3, y: 4 } } },
        { page: "b", positions: { one: { x: 5, y: 6 } } },
      ]);
    }),
);
