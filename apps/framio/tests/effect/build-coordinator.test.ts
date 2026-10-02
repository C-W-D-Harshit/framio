import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { makeBuildCoordinator } from "../../src/services/build-coordinator";

describe("build coordination", () => {
  it.effect(
    "a failed batch waits without spinning and the next barrier performs a full scan",
    () =>
      Effect.gen(function* () {
        const scans: boolean[] = [];
        let fail = true;
        const coordinator = yield* makeBuildCoordinator({
          initial: 0,
          build: (n, _files, full) => {
            scans.push(full);
            return fail
              ? Effect.fail("temporary read failure")
              : Effect.succeed(n + 1);
          },
          onError: () => Effect.void,
        });
        yield* coordinator.notify("theme.css");
        yield* TestClock.adjust(60);
        assert.deepStrictEqual(scans, [false]);
        yield* TestClock.adjust(1000);
        assert.deepStrictEqual(scans, [false]);
        fail = false;
        assert.strictEqual(
          yield* coordinator.withStableState(Effect.succeed),
          1,
        );
        assert.deepStrictEqual(scans, [false, true]);
      }),
  );

  it.effect("a canceled full scan retries without another file event", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const scans: boolean[] = [];
      const coordinator = yield* makeBuildCoordinator({
        initial: 0,
        build: (n, _files, full) =>
          Effect.gen(function* () {
            scans.push(full);
            if (scans.length === 1) {
              yield* Deferred.succeed(entered, undefined);
              yield* Effect.never;
            }
            return n + 1;
          }),
        onError: () => Effect.void,
      });
      yield* coordinator.notify();
      const capture = yield* coordinator
        .withStableState(Effect.succeed)
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(capture);
      yield* TestClock.adjust(60);
      assert.strictEqual(yield* coordinator.get, 1);
      assert.deepStrictEqual(scans, [true, true]);
    }),
  );
  it.effect(
    "a canceled barrier restores its batch alongside later file events",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const batches: string[][] = [];
        const coordinator = yield* makeBuildCoordinator({
          initial: 0,
          build: (n, files) =>
            Effect.gen(function* () {
              batches.push([...files].sort());
              if (batches.length === 1) {
                yield* Deferred.succeed(entered, undefined);
                yield* Effect.never;
              }
              return n + 1;
            }),
          onError: () => Effect.void,
        });
        yield* coordinator.notify("first.tsx");
        const capture = yield* coordinator
          .withStableState(Effect.succeed)
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        yield* coordinator.notify("later.tsx");
        yield* Fiber.interrupt(capture);
        assert.strictEqual(yield* coordinator.get, 0);
        assert.strictEqual(
          yield* coordinator.withStableState(Effect.succeed),
          1,
        );
        assert.deepStrictEqual(batches, [
          ["first.tsx"],
          ["first.tsx", "later.tsx"],
        ]);
      }),
  );
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
