import * as Fiber from "effect/Fiber";
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

it.effect("restart flush waits for active saves and reports failed saves", () =>
  Effect.gen(function* () {
    let fail = true;
    const saved: unknown[] = [];
    const service = yield* makePersistence({
      selection: (payload) =>
        Effect.sync(() => {
          saved.push(payload);
        }),
      canvas: (payload) =>
        fail
          ? Effect.fail("disk full")
          : Effect.sync(() => {
              saved.push(payload);
            }),
      onError: () => Effect.void,
    });
    yield* service.selection({ frames: ["one"], element: null });
    yield* service.canvas({ page: "a", positions: { one: { x: 1, y: 2 } } });
    const result = yield* service.flush.pipe(Effect.result);
    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(
      (yield* service.canvas({ page: "a", positions: {} }).pipe(Effect.result))
        ._tag,
      "Failure",
    );
    fail = false;
    yield* service.flush;
    assert.strictEqual(saved.length, 2);
    yield* service.resume;
    yield* service.canvas({ page: "b", positions: {} });
    yield* service.flush;
    assert.strictEqual(saved.length, 3);
  }),
);

it.effect("restart barrier waits for an active write before returning", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let finished = false;
    const service = yield* makePersistence({
      selection: () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
      canvas: () => Effect.void,
      onError: () => Effect.void,
    });
    yield* service.selection({ frames: ["one"], element: null });
    yield* TestClock.adjust(150);
    yield* Deferred.await(entered);
    const barrier = yield* service.flush.pipe(
      Effect.andThen(
        Effect.sync(() => {
          finished = true;
        }),
      ),
      Effect.forkScoped,
    );
    yield* Effect.yieldNow;
    assert.isFalse(finished);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(barrier);
    assert.isTrue(finished);
  }),
);
