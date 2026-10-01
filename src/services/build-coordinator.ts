import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { Diagnostics } from "./diagnostics";

/** A bounded wake-up channel accompanies an accumulated set, never one filename. */
export const makeBuildCoordinator = <S, E>(options: {
  initial: S;
  build: (previous: S, files: ReadonlySet<string>, full: boolean) => Effect.Effect<S, E>;
  onError: (error: E) => Effect.Effect<void>;
  quietMillis?: number;
  maxWaitMillis?: number;
  maxPending?: number;
}) => Effect.gen(function*() {
  const state = yield* SubscriptionRef.make(options.initial);
  const pending = yield* Ref.make({ files: new Set<string>(), full: false });
  const wake = yield* Queue.sliding<void>(1);
  const lock = yield* Semaphore.make(1);
  const flush = Effect.gen(function*() {
    const batch = yield* Ref.getAndSet(pending, { files: new Set<string>(), full: false });
    yield* Metric.update(Diagnostics.pendingFiles, 0);
    if (!batch.full && batch.files.size === 0) return;
    const previous = yield* SubscriptionRef.get(state);
    yield* options.build(previous, batch.files, batch.full).pipe(
      Effect.flatMap(next => SubscriptionRef.set(state, next)),
      Effect.catch(options.onError),
    );
  });
  const notify = Effect.fnUntraced(function*(filename?: string) {
    yield* Ref.update(pending, current => {
      if (current.full) return current;
      if (!filename || current.files.size >= (options.maxPending ?? 1024)) return { files: new Set<string>(), full: true };
      return { files: new Set([...current.files, filename]), full: false };
    });
    const current = yield* Ref.get(pending);
    yield* Metric.update(Diagnostics.pendingFiles, current.full ? (options.maxPending ?? 1024) : current.files.size);
    yield* Queue.offer(wake, undefined);
  });
  const worker = Effect.gen(function*() {
    while (true) {
      yield* Queue.take(wake);
      const started = yield* Clock.currentTimeMillis;
      while (true) {
        const remaining = (options.maxWaitMillis ?? 500) - ((yield* Clock.currentTimeMillis) - started);
        if (remaining <= 0) break;
        const next = yield* Queue.take(wake).pipe(Effect.timeoutOption(Math.min(options.quietMillis ?? 60, remaining)));
        if (Option.isNone(next)) break;
      }
      yield* flush.pipe(Semaphore.withPermits(lock, 1));
    }
  });
  yield* Effect.forkScoped(worker);
  const withStableState = <A, E2, R>(use: (value: S) => Effect.Effect<A, E2, R>) => Effect.gen(function*() {
    // The barrier drains pending events, including ones still in the quiet window.
    yield* flush;
    return yield* use(yield* SubscriptionRef.get(state));
  }).pipe(Semaphore.withPermits(lock, 1));
  const update = (f: (value: S) => S) => Effect.gen(function*() {
    const current = yield* SubscriptionRef.get(state);
    const next = f(current);
    if (next !== current) yield* SubscriptionRef.set(state, next);
  }).pipe(Semaphore.withPermits(lock, 1));
  return { get: SubscriptionRef.get(state), changes: SubscriptionRef.changes(state), notify, withStableState, update };
});
