import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import {
  studioTelemetry,
  telemetryEnabled,
} from "../../src/services/telemetry";

const saved = {
  DO_NOT_TRACK: process.env.DO_NOT_TRACK,
  FRAMIO_TELEMETRY: process.env.FRAMIO_TELEMETRY,
};
const directories: string[] = [];
afterEach(() => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const run = (directory: string) =>
  Effect.runPromise(
    studioTelemetry(directory).pipe(Effect.provide(BunFileSystem.layer)),
  );

test("source checkouts stay quiet unless telemetry is forced on", () => {
  expect(telemetryEnabled({})).toBe(false);
  expect(telemetryEnabled({ FRAMIO_TELEMETRY: "1" })).toBe(true);
  expect(telemetryEnabled({ FRAMIO_TELEMETRY: "OFF" })).toBe(false);
  expect(telemetryEnabled({ FRAMIO_TELEMETRY: "1", DO_NOT_TRACK: "1" })).toBe(
    false,
  );
  expect(telemetryEnabled({ FRAMIO_TELEMETRY: "1", DO_NOT_TRACK: "0" })).toBe(
    true,
  );
});

test("the anonymous id is created once and reused", async () => {
  const directory = mkdtempSync(join(tmpdir(), "framio-telemetry-"));
  directories.push(directory);
  delete process.env.DO_NOT_TRACK;
  process.env.FRAMIO_TELEMETRY = "1";
  const first = await run(directory);
  const second = await run(directory);
  expect(first?.distinctId).toBeTruthy();
  expect(second?.distinctId).toBe(first!.distinctId);
  expect(
    JSON.parse(readFileSync(join(directory, "telemetry.json"), "utf8")).id,
  ).toBe(first!.distinctId);
  process.env.DO_NOT_TRACK = "1";
  expect(await run(directory)).toBeNull();
});

test("saved preferences preserve the id and environment variables override them", async () => {
  const { setTelemetry, readTelemetry } =
    await import("../../src/services/telemetry");
  const directory = mkdtempSync(join(tmpdir(), "framio-preference-"));
  directories.push(directory);
  delete process.env.DO_NOT_TRACK;
  process.env.FRAMIO_TELEMETRY = "1";
  const first = await run(directory);
  await Effect.runPromise(
    setTelemetry(false, directory).pipe(Effect.provide(BunFileSystem.layer)),
  );
  expect((await run(directory))?.distinctId).toBe(first!.distinctId);
  const saved = await Effect.runPromise(
    readTelemetry(directory).pipe(Effect.provide(BunFileSystem.layer)),
  );
  expect(saved?.enabled).toBe(false);
  expect(saved?.id).toBe(first!.distinctId);
  process.env.FRAMIO_TELEMETRY = "0";
  expect(await run(directory)).toBeNull();
});

test("concurrent processes claim one identity and classify existing installations", async () => {
  const { writeFileSync } = await import("node:fs");
  const { telemetryIdentity } = await import("../../src/services/telemetry");
  const directory = mkdtempSync(join(tmpdir(), "framio-identity-"));
  directories.push(directory);
  writeFileSync(join(directory, "existing-cache"), "cache");
  delete process.env.DO_NOT_TRACK;
  process.env.FRAMIO_TELEMETRY = "1";
  const identities = await Promise.all(
    Array.from({ length: 10 }, () =>
      Effect.runPromise(
        telemetryIdentity({ directory }).pipe(
          Effect.provide(BunFileSystem.layer),
        ),
      ),
    ),
  );
  expect(new Set(identities.map((i) => i?.id)).size).toBe(1);
  expect(identities.filter((i) => i?.created)).toHaveLength(1);
  expect(identities[0]?.installKind).toBe("existing");
});
