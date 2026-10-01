import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { makeBuildCoordinator } from "../../src/services/build-coordinator";

describe("build coordination", () => {
  it.effect(
    "accumulates filenames and a screenshot barrier drains the quiet window",
    () =>
      Effect.gen(function* () {
        const batches: string[][] = [];
        const coordinator = yield* makeBuildCoordinator({
          initial: 0,
          build: (n, files) =>
            Effect.sync(() => {
              batches.push([...files].sort());
              return n + 1;
            }),
          onError: () => Effect.void,
        });
        yield* coordinator.notify("a.tsx");
        yield* coordinator.notify("theme.css");
        const pinned = yield* coordinator.withStableState(Effect.succeed);
        assert.strictEqual(pinned, 1);
        assert.deepStrictEqual(batches, [["a.tsx", "theme.css"]]);
        yield* TestClock.adjust(60);
        assert.strictEqual(yield* coordinator.get, 1);
      }),
  );
  it.effect("events during a capture wait for release and are retained", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const coordinator = yield* makeBuildCoordinator({
        initial: 0,
        build: (n) => Effect.succeed(n + 1),
        onError: () => Effect.void,
      });
      const capture = yield* coordinator
        .withStableState((n) =>
          Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.as(n),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(ready);
      yield* coordinator.notify("a.tsx");
      yield* TestClock.adjust(60);
      assert.strictEqual(yield* coordinator.get, 0);
      yield* Deferred.succeed(gate, undefined);
      assert.strictEqual(yield* Fiber.join(capture), 0);
      yield* coordinator.withStableState(Effect.succeed);
      assert.strictEqual(yield* coordinator.get, 1);
    }),
  );
  it.effect(
    "overflow requests a full scan and a failed build leaves the committed state intact",
    () =>
      Effect.gen(function* () {
        let attempt = 0;
        const full: boolean[] = [];
        const coordinator = yield* makeBuildCoordinator({
          initial: 7,
          maxPending: 1,
          build: (n, _files, scan) => {
            full.push(scan);
            return ++attempt === 1
              ? Effect.fail("broken")
              : Effect.succeed(n + 1);
          },
          onError: () => Effect.void,
        });
        yield* coordinator.notify("a");
        yield* coordinator.notify("b");
        assert.strictEqual(
          yield* coordinator.withStableState(Effect.succeed),
          7,
        );
        assert.deepStrictEqual(full, [true]);
        yield* coordinator.notify("c");
        assert.strictEqual(
          yield* coordinator.withStableState(Effect.succeed),
          8,
        );
      }),
  );
  it.effect(
    "continuous edits reach the maximum wait instead of starving the worker",
    () =>
      Effect.gen(function* () {
        const coordinator = yield* makeBuildCoordinator({
          initial: 0,
          build: (n) => Effect.succeed(n + 1),
          onError: () => Effect.void,
        });
        yield* coordinator.notify("first");
        yield* Effect.yieldNow;
        for (let i = 0; i < 10; i++) {
          yield* TestClock.adjust(50);
          yield* coordinator.notify(String(i));
        }
        assert.strictEqual(yield* coordinator.get, 1);
      }),
  );
});
