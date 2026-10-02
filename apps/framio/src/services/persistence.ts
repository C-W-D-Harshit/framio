import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import type { CanvasRequest, SelectionRequest } from "../contracts/requests";
export class SavesPaused extends Schema.TaggedError<SavesPaused>()(
  "SavesPaused",
  { message: Schema.String },
) {}
/** One worker orders writes and retains failed batches until a successful retry. */
export const makePersistence = <E>(options: {
  selection: (
    payload: typeof SelectionRequest.Type,
  ) => Effect.Effect<unknown, E>;
  canvas: (payload: typeof CanvasRequest.Type) => Effect.Effect<unknown, E>;
  onError: (error: E) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    type Pending = {
      selection: typeof SelectionRequest.Type | null;
      canvas: ReadonlyMap<string, (typeof CanvasRequest.Type)["positions"]>;
    };
    const empty = (): Pending => ({ selection: null, canvas: new Map() });
    const pending = yield* Ref.make<Pending>(empty());
    const paused = yield* Ref.make(false);
    const permit = yield* Semaphore.make(1);
    const wake = yield* Queue.sliding<void>(1);
    const selection = Effect.fnUntraced(function* (
      payload: typeof SelectionRequest.Type,
    ) {
      if (yield* Ref.get(paused))
        return yield* new SavesPaused({
          message: "Canvas saves are paused while restarting.",
        });
      yield* Ref.update(pending, (current) => ({
        ...current,
        selection: payload,
      }));
      yield* Queue.offer(wake, undefined);
    });
    const canvas = Effect.fnUntraced(function* (
      payload: typeof CanvasRequest.Type,
    ) {
      if (yield* Ref.get(paused))
        return yield* new SavesPaused({
          message: "Canvas saves are paused while restarting.",
        });
      yield* Ref.update(pending, (current) => {
        const canvas = new Map(current.canvas);
        canvas.set(payload.page, {
          ...canvas.get(payload.page),
          ...payload.positions,
        });
        return { ...current, canvas };
      });
      yield* Queue.offer(wake, undefined);
    });
    const drain = Effect.gen(function* () {
      const batch = yield* Ref.getAndSet(pending, empty());
      if (batch.selection) {
        const saved = yield* options
          .selection(batch.selection)
          .pipe(Effect.result);
        if (saved._tag === "Failure") {
          yield* Ref.update(pending, (current) => {
            const canvas = new Map(batch.canvas);
            for (const [page, positions] of current.canvas)
              canvas.set(page, { ...canvas.get(page), ...positions });
            return { selection: current.selection ?? batch.selection, canvas };
          });
          yield* options.onError(saved.failure);
          return yield* Effect.fail(saved.failure);
        }
      }
      for (const [page, positions] of batch.canvas) {
        const saved = yield* options
          .canvas({ page, positions })
          .pipe(Effect.result);
        if (saved._tag === "Failure") {
          yield* Ref.update(pending, (current) => {
            const canvas = new Map(current.canvas);
            let retain = false;
            for (const [key, value] of batch.canvas) {
              if (key === page) retain = true;
              if (retain) canvas.set(key, { ...value, ...canvas.get(key) });
            }
            return { ...current, canvas };
          });
          yield* options.onError(saved.failure);
          return yield* Effect.fail(saved.failure);
        }
      }
    }).pipe(Semaphore.withPermits(permit, 1));
    yield* Effect.gen(function* () {
      while (true) {
        yield* Queue.take(wake);
        yield* Effect.sleep(150);
        yield* drain.pipe(Effect.catch(() => Effect.void));
      }
    }).pipe(Effect.forkScoped);
    const flush = Effect.gen(function* () {
      yield* Ref.set(paused, true);
      yield* drain;
    });
    return { selection, canvas, flush, resume: Ref.set(paused, false) };
  });
