#!/usr/bin/env bun
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/http";
import { ServerRegistry } from "./services/server-registry";
import { ServerLauncher } from "./services/server-launcher";
import { supervise } from "./services/session-supervisor";
import { serve } from "./services/server-application";
import { InvalidInput } from "./domain/errors";
declare const FRAMIO_VERSION: string | undefined;
const VERSION = typeof FRAMIO_VERSION === "string" ? FRAMIO_VERSION : "dev";
const Platform = Layer.mergeAll(BunServices.layer, FetchHttpClient.layer);
const Registry = ServerRegistry.layer.pipe(Layer.provideMerge(Platform));
let args = process.argv.slice(2);
if (args[0] === "help") args = ["--help", ...args.slice(1)];
if (args[0] === "-v") args = ["--version", ...args.slice(1)];
Effect.gen(function* () {
  if (!Bun.semver.satisfies(Bun.version, ">=1.4.2"))
    return yield* new InvalidInput({
      message:
        "Framio source commands require Bun 1.4.2 or later. Use the packaged binary or `bun run` scripts with the pinned development toolchain.",
    });
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const onHup = () => process.kill(process.pid, "SIGTERM");
      process.on("SIGHUP", onHup);
      return onHup;
    }),
    (onHup) =>
      Effect.sync(() => {
        process.off("SIGHUP", onHup);
      }),
  );
  if (args[0] === "__supervise") {
    const parsed = yield* Schema.decodeUnknownEffect(
      Schema.Tuple([Schema.String, Schema.optional(Schema.Literal("--open"))]),
    )(args.slice(1));
    process.exitCode = yield* supervise(parsed[0], parsed[1] === "--open");
  } else if (args[0] === "__serve") {
    const parsed = yield* Schema.decodeUnknownEffect(
      Schema.Tuple([Schema.String, Schema.optional(Schema.Literal("--open"))]),
    )(args.slice(1));
    yield* serve(parsed[0], parsed[1] === "--open");
  } else {
    const { runCommands } = yield* Effect.promise(
      () => import("./commands/command-tree"),
    );
    yield* runCommands(args, VERSION).pipe(
      Effect.provide(ServerLauncher.layer),
    );
  }
}).pipe(
  Effect.scoped,
  Effect.provide(Registry),
  Effect.catch((error) =>
    Console.error(error.message).pipe(
      Effect.andThen(
        Effect.sync(() => {
          process.exitCode = 1;
        }),
      ),
    ),
  ),
  BunRuntime.runMain({
    disableErrorReporting: true,
    teardown: (exit, onExit) =>
      Runtime.defaultTeardown(exit, (code) =>
        onExit(
          code === 130 &&
            (!args[0] ||
              args[0].startsWith("-") ||
              args[0] === "start" ||
              args[0] === "__serve")
            ? 0
            : code,
        ),
      ),
  }),
);
