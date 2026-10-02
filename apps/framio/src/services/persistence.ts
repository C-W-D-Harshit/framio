import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type { CanvasRequest, SelectionRequest } from "../contracts/requests";

/** One worker orders writes. Pending canvas deltas merge independently per page. */
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
    const pending = yield* Ref.make<Pending>({
      selection: null,
      canvas: new Map(),
    });
    const wake = yield* Queue.sliding<void>(1);
    const selection = Effect.fnUntraced(function* (
      payload: typeof SelectionRequest.Type,
    ) {
      yield* Ref.update(pending, (current) => ({
        ...current,
        selection: payload,
      }));
      yield* Queue.offer(wake, undefined);
    });
    const canvas = Effect.fnUntraced(function* (
      payload: typeof CanvasRequest.Type,
    ) {
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
    yield* Effect.gen(function* () {
      while (true) {
        yield* Queue.take(wake);
        yield* Effect.sleep(150);
        const batch = yield* Ref.getAndSet(pending, {
          selection: null,
          canvas: new Map(),
        });
        if (batch.selection)
          yield* options
            .selection(batch.selection)
            .pipe(Effect.catch(options.onError));
        yield* Effect.forEach(
          batch.canvas,
          ([page, positions]) =>
            options
              .canvas({ page, positions })
              .pipe(Effect.catch(options.onError)),
          { discard: true },
        );
      }
    }).pipe(Effect.forkScoped);
    return { selection, canvas };
  });
