import * as Effect from "effect/Effect";
import { randomUUID } from "node:crypto";

/** A capture pins immutable bytes without retaining the build coordinator lock. */
export const makeGenerationLeases = <S>() =>
  Effect.sync(() => {
    const generations = new Map<string, S>();
    return {
      acquire: (state: S) =>
        Effect.sync(() => {
          const token = randomUUID();
          generations.set(token, state);
          return { token, state };
        }),
      release: (lease: { token: string }) =>
        Effect.sync(() => {
          generations.delete(lease.token);
        }),
      get: (token: string) => Effect.sync(() => generations.get(token)),
      values: Effect.sync(() => [...generations.values()]),
    };
  });
