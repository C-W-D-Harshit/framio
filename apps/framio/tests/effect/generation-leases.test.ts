import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { makeGenerationLeases } from "../../src/services/generation-leases";
import { makeBuildCoordinator } from "../../src/services/build-coordinator";
it.effect(
  "a pinned capture does not block publication and releases on interruption",
  () =>
    Effect.gen(function* () {
      const leases = yield* makeGenerationLeases<{ version: number }>();
      const coordinator = yield* makeBuildCoordinator({
        initial: { version: 1 },
        build: (state) => Effect.succeed({ version: state.version + 1 }),
        onError: () => Effect.void,
      });
      const entered = yield* Deferred.make<string>();
      const capture = yield* Effect.scoped(
        Effect.gen(function* () {
          const lease = yield* Effect.acquireRelease(
            coordinator.withStableState(leases.acquire),
            leases.release,
          );
          yield* Deferred.succeed(entered, lease.token);
          yield* Effect.never;
        }),
      ).pipe(Effect.forkChild);
      const token = yield* Deferred.await(entered);
      yield* coordinator.notify("frame.tsx");
      assert.strictEqual(
        (yield* coordinator.withStableState(Effect.succeed)).version,
        2,
      );
      assert.strictEqual((yield* leases.get(token))?.version, 1);
      yield* Fiber.interrupt(capture);
      assert.strictEqual(yield* leases.get(token), undefined);
      assert.deepStrictEqual(yield* leases.values, []);
    }),
);
