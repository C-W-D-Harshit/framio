import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as RcRef from "effect/RcRef";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Metric from "effect/Metric";
import { Diagnostics, measure } from "./diagnostics";
import { Policies } from "../domain/policies";

/** Shared resource ownership, independent of the browser implementation. */
export const makeCaptureResources = <B, P, E, EP>(options: {
  acquireBrowser: Effect.Effect<B, E, Scope.Scope>;
  openPage: (browser: B) => Effect.Effect<P, EP>;
  closePage: (page: P) => Effect.Effect<void>;
  isConnected: (browser: B) => boolean;
  concurrency?: number;
  idleTTL?: Duration.Input;
}) => Effect.gen(function*() {
  const browser = yield* RcRef.make({ acquire: options.acquireBrowser, idleTimeToLive: options.idleTTL ?? Policies.browserIdleTTL });
  const permits = yield* Semaphore.make(options.concurrency ?? Policies.captureConcurrency);
  const withPage = <A, E2, R>(use: (page: P) => Effect.Effect<A, E2, R>) => Effect.scoped(
    Effect.gen(function*() {
      let current = yield* RcRef.get(browser);
      if (!options.isConnected(current)) {
        yield* RcRef.invalidate(browser);
        current = yield* RcRef.get(browser);
      }
      yield* Effect.acquireRelease(
        Metric.modify(Diagnostics.activeCaptures, 1).pipe(Effect.andThen(Metric.update(Diagnostics.captures, 1))),
        () => Metric.modify(Diagnostics.activeCaptures, -1),
      );
      const page = yield* Effect.acquireRelease(options.openPage(current), options.closePage);
      return yield* measure(Diagnostics.captureDuration, use(page));
    }),
  ).pipe(Semaphore.withPermits(permits, 1));
  return { withPage, invalidate: RcRef.invalidate(browser) };
});
