import * as Effect from "effect/Effect";
import { lstat } from "node:fs/promises";
import { InvalidInput } from "../domain/errors";

export const isSourceSymlink = (file: string) =>
  Effect.tryPromise({
    try: async () => (await lstat(file)).isSymbolicLink(),
    catch: (cause) => new InvalidInput({ message: String(cause) }),
  });
