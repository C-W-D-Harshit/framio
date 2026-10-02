import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { openUpdateStorage } from "../../platform/update-storage";
import { UpdateFailure } from "../../contracts/update";
export const io = <A>(thunk: () => A) =>
  Effect.try({
    try: thunk,
    catch: (cause) => new UpdateFailure({ message: String(cause) }),
  });
export const makeUpdateStorage = Effect.fn("UpdateStorage.open")(function* (
  directory: string,
) {
  const native = yield* Effect.acquireRelease(
    io(() => openUpdateStorage(directory)),
    (db) => Effect.sync(db.close),
  );
  const read = <S extends Schema.Constraint>(key: string, schema: S) =>
    io(() => native.read(key)).pipe(
      Effect.flatMap((value) =>
        value === null
          ? Effect.succeed(null)
          : Schema.decodeUnknownEffect(schema)(value).pipe(
              Effect.mapError(
                (error) =>
                  new UpdateFailure({
                    message: `Invalid update state: ${error.message}`,
                  }),
              ),
            ),
      ),
    );
  const write = (key: string, value: unknown) =>
    io(() => native.write(key, value)).pipe(Effect.asVoid);
  const lock = <A, E, R>(key: string, work: Effect.Effect<A, E, R>) =>
    Effect.scoped(
      Effect.acquireRelease(
        io(() => native.claim(key)).pipe(
          Effect.flatMap((token) =>
            token
              ? Effect.succeed(token)
              : Effect.fail(
                  new UpdateFailure({
                    message:
                      "Another Framio process owns this update operation. Wait for it to finish.",
                  }),
                ),
          ),
        ),
        (token) => io(() => native.release(key, token)).pipe(Effect.orDie),
      ).pipe(Effect.andThen(work)),
    );
  return {
    read,
    write,
    lock,
    owned: (key: string) => io(() => native.owned(key)),
  };
});
export type UpdateStorage = Effect.Success<
  ReturnType<typeof makeUpdateStorage>
>;
