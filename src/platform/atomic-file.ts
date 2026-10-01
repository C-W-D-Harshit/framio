import * as Predicate from "effect/Predicate";
import * as Effect from "effect/Effect";
import { readFileSync, renameSync, unlinkSync } from "node:fs";
import { basename } from "node:path";
import { InvalidInput } from "../domain/errors";
/** Compare immediately before rename without an asynchronous gap in this process. */
export const publishIfUnchanged = (
  file: string,
  temporary: string,
  expected: string | null,
) =>
  Effect.try({
    try: () => {
      let current: string | null;
      try {
        current = readFileSync(file, "utf8");
      } catch (error) {
        if (!Predicate.hasProperty(error, "code") || error.code !== "ENOENT")
          throw error;
        current = null;
      }
      if (current !== expected) {
        unlinkSync(temporary);
        return false;
      }
      renameSync(temporary, file);
      return true;
    },
    catch: (cause) =>
      new InvalidInput({
        message: `Could not save ${basename(file)}: ${String(cause)}`,
      }),
  });
