import { Console, Effect, FileSystem, Layer } from "effect";
import { join } from "node:path";
import { Analytics, makeAnalytics } from "./analytics";
import { GLOBAL_DIR } from "../lib/paths";
import { POSTHOG_HOST, POSTHOG_KEY, telemetryIdentity } from "./telemetry";
import { compiled, runningVersion } from "../lib/version";

export const telemetryLayer = (app: "cli" | "server", management = false) =>
  Layer.unwrap(
    Effect.gen(function* () {
      if (management) return Analytics.layerTest;
      const identity = yield* telemetryIdentity();
      if (!identity) return Analytics.layerTest;
      return Layer.effect(
        Analytics,
        Effect.gen(function* () {
          const service = yield* makeAnalytics({
            key: POSTHOG_KEY,
            host: process.env.FRAMIO_TELEMETRY_HOST ?? POSTHOG_HOST,
            distinctId: identity.id,
            common: {
              app,
              framio_version: runningVersion,
              os: process.platform,
              arch: process.arch,
              compiled: compiled(),
            },
          });
          const fs = yield* FileSystem.FileSystem;
          const installClaim = yield* Effect.result(
            fs.writeFileString(join(GLOBAL_DIR, "telemetry-install"), "1", {
              flag: "wx",
              mode: 0o600,
            }),
          );
          if (installClaim._tag === "Success")
            yield* service.record("install", {
              install_kind: identity.installKind ?? "existing",
              source: "first_run",
            });
          if (!identity.noticeShown) {
            const claim = yield* Effect.result(
              fs.writeFileString(join(GLOBAL_DIR, "telemetry-notice"), "1", {
                flag: "wx",
                mode: 0o600,
              }),
            );
            if (claim._tag === "Success")
              yield* Console.error(
                "Framio collects anonymous usage and application errors. No designs or comments. Disable with framio telemetry off or FRAMIO_TELEMETRY=0. Learn more: https://framio.design/docs",
              );
          }
          return service;
        }),
      );
    }),
  );
