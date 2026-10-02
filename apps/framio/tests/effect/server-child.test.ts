import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Logger } from "effect";
import { TestClock } from "effect/testing";
import { ServerStartupFailed } from "../../src/domain/errors";
import { stopWindowsProcessTree } from "../../src/platform/server-child";

describe("Windows process tree cleanup", () => {
  it.effect("terminates the owned tree and releases the helper", () =>
    Effect.gen(function* () {
      let closed = false;
      const terminate = (pid: number) => {
        expect(pid).toBe(123);
        return Effect.scoped(
          Effect.acquireRelease(Effect.succeed(0), () =>
            Effect.sync(() => {
              closed = true;
            }),
          ),
        );
      };
      expect(yield* stopWindowsProcessTree(123, terminate)).toBe(true);
      expect(closed).toBe(true);
    }),
  );

  it.effect(
    "reports a nonzero exit instead of claiming the tree was stopped",
    () =>
      Effect.gen(function* () {
        const messages: unknown[] = [];
        const logger = Logger.make((entry) => messages.push(entry.message));
        expect(
          yield* stopWindowsProcessTree(123, () => Effect.succeed(1)).pipe(
            Effect.provide(Logger.layer([logger])),
          ),
        ).toBe(false);
        expect(JSON.stringify(messages)).toContain("taskkill exited 1");
        expect(JSON.stringify(messages)).toContain(
          "descendants may still be running",
        );
      }),
  );

  it.effect("reports a taskkill spawn failure", () =>
    Effect.gen(function* () {
      const messages: unknown[] = [];
      const logger = Logger.make((entry) => messages.push(entry.message));
      expect(
        yield* stopWindowsProcessTree(123, () =>
          Effect.fail(
            new ServerStartupFailed({ message: "taskkill.exe was not found" }),
          ),
        ).pipe(Effect.provide(Logger.layer([logger]))),
      ).toBe(false);
      expect(JSON.stringify(messages)).toContain("taskkill.exe was not found");
    }),
  );

  it.effect(
    "a stalled taskkill times out and releases its process during finalization",
    () =>
      Effect.gen(function* () {
        let closed = false;
        const entered = yield* Deferred.make<void>();
        const messages: unknown[] = [];
        const logger = Logger.make((entry) => messages.push(entry.message));
        const terminate = () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                closed = true;
              }),
            ),
          );
        const cleanup = yield* stopWindowsProcessTree(123, terminate).pipe(
          Effect.uninterruptible,
          Effect.provide(Logger.layer([logger])),
          Effect.forkChild,
        );
        yield* Deferred.await(entered);
        yield* TestClock.adjust("5 seconds");
        expect(yield* Fiber.join(cleanup)).toBe(false);
        expect(closed).toBe(true);
        expect(JSON.stringify(messages)).toContain("taskkill timed out");
      }),
  );
});
