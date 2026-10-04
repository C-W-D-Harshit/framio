#!/usr/bin/env bun
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Analytics, analyticsLogger } from "./services/analytics";
import { telemetryLayer } from "./services/telemetry-platform";
import { Cause, Clock, Exit } from "effect";
import * as Runtime from "effect/Runtime";
import { FetchHttpClient } from "effect/http";
import { ServerRegistry } from "./services/server-registry";
import { ServerLauncher } from "./services/server-launcher";
import { InvalidInput } from "./domain/errors";
import { TerminalUI } from "./services/terminal-ui";
declare const FRAMIO_VERSION: string | undefined;
const VERSION = typeof FRAMIO_VERSION === "string" ? FRAMIO_VERSION : "dev";
const Platform = Layer.mergeAll(BunServices.layer, FetchHttpClient.layer);
const Registry = ServerRegistry.layer.pipe(Layer.provideMerge(Platform));
let args = process.argv.slice(2);
if (args[0] === "help") args = ["--help", ...args.slice(1)];
if (args[0] === "-v") args = ["--version", ...args.slice(1)];
const internal = args[0] === "__serve" || args[0] === "__supervise";
const Telemetry = telemetryLayer(
  internal ? "server" : "cli",
  args[0] === "telemetry",
).pipe(Layer.provideMerge(Platform));
const LoggedTelemetry = analyticsLogger.pipe(Layer.provideMerge(Telemetry));
const commands = Effect.gen(function* () {
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
  if (args[0] === "__serve" || args[0] === "__supervise") {
    const { runServerCommand } = yield* Effect.promise(
      () => import("./commands/command-tree"),
    );
    yield* runServerCommand(args[0], args.slice(1), VERSION);
  } else {
    const { runCommands } = yield* Effect.promise(
      () => import("./commands/command-tree"),
    );
    yield* runCommands(args, VERSION).pipe(
      Effect.provide(ServerLauncher.layer),
    );
  }
});
Effect.gen(function* () {
  const analytics = yield* Analytics;
  const started = yield* Clock.currentTimeMillis;
  const exit = yield* Effect.exit(Effect.scoped(commands));
  const interrupted =
    Exit.isFailure(exit) && exit.cause.reasons.every(Cause.isInterruptReason);
  if (!internal && args[0] !== "telemetry") {
    const allowed = [
      "start",
      "init",
      "stop",
      "list",
      "status",
      "open",
      "install",
      "add",
      "evidence",
      "inspect",
      "screenshot",
      "update",
      "upgrade",
    ];
    const command = !args[0]
      ? "start"
      : args[0] === "--help"
        ? "help"
        : args[0] === "--version"
          ? "version"
          : allowed.includes(args[0])
            ? args[0] === "upgrade"
              ? "update"
              : args[0]
            : "unknown";
    yield* analytics.record("cli command", {
      command,
      outcome: interrupted
        ? "interrupted"
        : Exit.isFailure(exit) || (process.exitCode ?? 0) !== 0
          ? "failure"
          : "success",
      duration_ms: (yield* Clock.currentTimeMillis) - started,
    });
  }
  if (Exit.isFailure(exit)) {
    if (interrupted) return yield* Effect.failCause(exit.cause);
    for (const reason of exit.cause.reasons) {
      if (Cause.isInterruptReason(reason)) continue;
      const error = Cause.isFailReason(reason) ? reason.error : reason.defect;
      yield* analytics.exception(error, "cli_top_level");
      yield* (yield* TerminalUI).message(
        "error",
        error instanceof Error
          ? error.message
          : "Unexpected application failure",
      );
    }
    process.exitCode = 1;
  }
}).pipe(
  Effect.provide(LoggedTelemetry),
  Effect.provide(Registry),
  Effect.provide(TerminalUI.layer(VERSION)),
  BunRuntime.runMain({
    disableErrorReporting: true,
    teardown: (exit, onExit) =>
      Runtime.defaultTeardown(exit, (code) =>
        onExit(
          code === 130 &&
            (!args[0] ||
              args[0].startsWith("-") ||
              args[0] === "start" ||
              args[0] === "__serve" ||
              args[0] === "__supervise")
            ? 0
            : code,
        ),
      ),
  }),
);
