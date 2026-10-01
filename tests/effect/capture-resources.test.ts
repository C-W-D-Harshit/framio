import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { makeCaptureResources } from "../../src/services/capture-resources";

describe("capture ownership", () => {
  it.effect("shares one browser and closes pages before the idle browser expires", () => Effect.gen(function*() {
    const events: string[] = [];
    const resources = yield* makeCaptureResources({
      acquireBrowser: Effect.acquireRelease(Effect.sync(() => { events.push("browser-open"); return "browser"; }), () => Effect.sync(() => { events.push("browser-close"); })),
      openPage: () => Effect.sync(() => { events.push("page-open"); return "page"; }),
      closePage: () => Effect.sync(() => { events.push("page-close"); }),
      isConnected: () => true,
      idleTTL: "5 minutes",
    });
    yield* resources.withPage(() => Effect.void);
    yield* resources.withPage(() => Effect.void);
    assert.deepStrictEqual(events, ["browser-open", "page-open", "page-close", "page-open", "page-close"]);
    yield* TestClock.adjust("5 minutes");
    assert.deepStrictEqual(events, ["browser-open", "page-open", "page-close", "page-open", "page-close", "browser-close"]);
  }));

  it.effect("a canceled waiter cannot acquire a page or consume the next permit", () => Effect.gen(function*() {
    let opened = 0;
    let closed = 0;
    const ready = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    const resources = yield* makeCaptureResources({
      acquireBrowser: Effect.succeed("browser"),
      openPage: () => Effect.sync(() => ++opened),
      closePage: () => Effect.sync(() => { closed++; }),
      isConnected: () => true,
      concurrency: 1,
    });
    const active = yield* resources.withPage(() => Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(gate)))).pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    const waiter = yield* resources.withPage(() => Effect.void).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(waiter);
    assert.strictEqual(opened, 1);
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(active);
    yield* resources.withPage(() => Effect.void);
    assert.strictEqual(opened, 2);
    assert.strictEqual(closed, 2);
  }));

  it.effect("active capture borrows prevent idle closure and interruption closes its page", () => Effect.gen(function*() {
    const events: string[] = [];
    const ready = yield* Deferred.make<void>();
    const resources = yield* makeCaptureResources({
      acquireBrowser: Effect.acquireRelease(Effect.succeed("browser"), () => Effect.sync(() => { events.push("browser-close"); })),
      openPage: () => Effect.succeed("page"),
      closePage: () => Effect.sync(() => { events.push("page-close"); }),
      isConnected: () => true,
      idleTTL: "5 minutes",
    });
    const active = yield* resources.withPage(() => Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never))).pipe(Effect.forkChild);
    yield* Deferred.await(ready);
    yield* TestClock.adjust("6 minutes");
    assert.deepStrictEqual(events, []);
    yield* Fiber.interrupt(active);
    assert.deepStrictEqual(events, ["page-close"]);
    yield* TestClock.adjust("5 minutes");
    assert.deepStrictEqual(events, ["page-close", "browser-close"]);
  }));
});
