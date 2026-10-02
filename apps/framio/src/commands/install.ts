import * as Effect from "effect/Effect";
import { runBun } from "../lib/bun";
import { projectPaths } from "../lib/paths";
import { requireProject } from "./shared";
import { PackageCommandFailed } from "../domain/errors";

export const install = Effect.fn("install")(function* (
  packages: readonly string[],
) {
  const p = projectPaths(yield* requireProject);
  const result = yield* runBun(
    packages.length ? ["add", ...packages] : ["install"],
    p.framio,
  );
  if (result.code !== 0)
    return yield* new PackageCommandFailed({ message: "Install failed." });
});
