import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { GLOBAL_DIR } from "../lib/paths";
import { compiled, runningVersion } from "../lib/version";
import type { StudioTelemetry } from "../contracts/telemetry";

// PostHog project keys are public by design: they can only ingest events.
export const POSTHOG_KEY = "phc_rtAxx3Dx952MZi8vCGVYegcDqAC7zjRWvnSyN2cqm9r6";
export const POSTHOG_HOST = "https://us.i.posthog.com";
const TelemetryFile = Schema.Struct({
  id: Schema.NonEmptyString,
  enabled: Schema.optionalKey(Schema.Boolean),
  installKind: Schema.optionalKey(Schema.Literals(["fresh", "existing"])),
  noticeShown: Schema.optionalKey(Schema.Boolean),
});
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(TelemetryFile));
const truthy = (value: string | undefined) =>
  value !== undefined &&
  !["", "0", "false", "off", "no"].includes(value.toLowerCase());
export const telemetryEnabled = (
  env: Record<string, string | undefined>,
  preference?: boolean,
) => {
  if (truthy(env.DO_NOT_TRACK)) return false;
  if (env.FRAMIO_TELEMETRY !== undefined) return truthy(env.FRAMIO_TELEMETRY);
  return typeof Bun !== "undefined" && compiled() && preference !== false;
};
export const readTelemetry = Effect.fn("Telemetry.read")(function* (
  directory = GLOBAL_DIR,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(join(directory, "telemetry.json")).pipe(
    Effect.flatMap(decode),
    Effect.orElseSucceed(() => null),
  );
});
export const telemetryIdentity = Effect.fn("Telemetry.identity")(
  function* (options?: { directory?: string; force?: boolean }) {
    const directory = options?.directory ?? GLOBAL_DIR;
    const force = options?.force ?? false;
    const fs = yield* FileSystem.FileSystem;
    const existing = yield* readTelemetry(directory);
    if (!force && !telemetryEnabled(process.env, existing?.enabled))
      return null;
    if (existing) return { ...existing, created: false };
    const contents = yield* fs
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed(() => []));
    const value = {
      id: randomUUID(),
      installKind: contents.length ? ("existing" as const) : ("fresh" as const),
      noticeShown: false,
    };
    const ready = yield* fs.makeDirectory(directory, { recursive: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!ready) return null;
    const written = yield* Effect.result(
      fs.writeFileString(
        join(directory, "telemetry.json"),
        JSON.stringify(value),
        { flag: "wx", mode: 0o600 },
      ),
    );
    if (written._tag === "Failure") {
      const winner = yield* readTelemetry(directory);
      return winner ? { ...winner, created: false } : null;
    }
    return { ...value, created: true };
  },
);
export const setTelemetry = Effect.fn("Telemetry.set")(function* (
  enabled: boolean,
  directory = GLOBAL_DIR,
) {
  const fs = yield* FileSystem.FileSystem;
  const identity = yield* telemetryIdentity({ directory, force: true });
  if (!identity) return false;
  const { created: _, ...value } = identity;
  const temporary = join(directory, `telemetry-${randomUUID()}.tmp`);
  yield* fs.writeFileString(temporary, JSON.stringify({ ...value, enabled }), {
    mode: 0o600,
  });
  yield* fs.rename(temporary, join(directory, "telemetry.json"));
  return true;
});
export const studioTelemetry = Effect.fn("Telemetry.studio")(function* (
  directory = GLOBAL_DIR,
) {
  const identity = yield* telemetryIdentity({ directory });
  if (!identity) return null;
  return {
    key: POSTHOG_KEY,
    host: process.env.FRAMIO_TELEMETRY_HOST ?? POSTHOG_HOST,
    distinctId: identity.id,
    version: runningVersion,
    os: process.platform,
    arch: process.arch,
    compiled: compiled(),
  } satisfies StudioTelemetry;
});
