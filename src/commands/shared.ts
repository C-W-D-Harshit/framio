import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { dirname, join, resolve } from "node:path";
import { ProjectNotFound } from "../domain/errors";

export const requireProject = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  let dir = resolve(process.cwd());
  while (true) {
    if (yield* fs.exists(join(dir, ".framio"))) return yield* fs.realPath(dir);
    const parent = dirname(dir);
    if (parent === dir) return yield* new ProjectNotFound({ message: "No .framio found here or in any parent directory. Run `framio init` first." });
    dir = parent;
  }
});
