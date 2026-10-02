import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { join } from "node:path";
import { buildUi } from "./services/ui-build";
import { watchProject } from "../src/platform/project-watch";
const root = join(import.meta.dir, "..");
Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.scoped(buildUi(root));
    if (!process.argv.includes("--watch")) return;
    const wake = yield* Queue.sliding<void>(1);
    for (const dir of [
      "src/ui",
      "src/runtime",
      "src/scaffold",
      "src/contracts",
      "src/domain",
    ]) {
      yield* watchProject(join(root, dir)).pipe(
        Stream.runForEach(() => Queue.offer(wake, undefined)),
        Effect.forkScoped,
      );
    }
    yield* Effect.logInfo(
      "watching UI, runtime, scaffold and shared contracts",
    );
    while (true) {
      yield* Queue.take(wake);
      yield* Effect.sleep(80);
      yield* Queue.takeAll(wake);
      yield* Effect.scoped(buildUi(root)).pipe(
        Effect.catch((error) =>
          Effect.logError("UI build failed; previous assets retained", error),
        ),
      );
    }
  }),
).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
