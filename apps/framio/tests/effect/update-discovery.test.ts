import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { UpdateFailure } from "../../src/contracts/update";
import type { UpdateStorage } from "../../src/services/update/storage";
import {
  makeDiscovery,
  newer,
  shortDescription,
  validateRelease,
} from "../../src/services/update/discovery";
const release = (overrides = {}) => ({
  tag_name: "v1.2.3",
  draft: false,
  prerelease: false,
  body: "A clearer canvas.\n\n## Changes\nLong notes",
  assets: [
    {
      id: 1,
      name: "framio-darwin-arm64.tar.gz",
      size: 100,
      browser_download_url:
        "https://github.com/C-W-D-Harshit/framio/releases/download/v1.2.3/framio-darwin-arm64.tar.gz",
    },
    {
      id: 2,
      name: "SHA256SUMS",
      size: 100,
      browser_download_url:
        "https://github.com/C-W-D-Harshit/framio/releases/download/v1.2.3/SHA256SUMS",
    },
  ],
  ...overrides,
});

function memoryStorage(): UpdateStorage {
  const records = new Map<string, unknown>();
  return {
    read: <S extends Schema.Constraint>(key: string, schema: S) =>
      records.has(key)
        ? Schema.decodeUnknownEffect(schema)(records.get(key)).pipe(
            Effect.mapError(
              (error) => new UpdateFailure({ message: error.message }),
            ),
          )
        : Effect.succeed(null),
    write: (key, value) =>
      Effect.sync(() => {
        records.set(key, value);
      }),
    lock: (_key, work) => Effect.scoped(work),
    owned: () => Effect.succeed(false),
  };
}

describe("release freshness", () => {
  it.effect(
    "discovers a release published after startup within 30 minutes",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const discovery = makeDiscovery(memoryStorage(), "darwin-arm64", () =>
          Effect.sync(() => {
            calls++;
            return {
              status: 200,
              etag: `release-${calls}`,
              text: JSON.stringify(release({ body: `Release ${calls}` })),
              retryAfter: null,
              reset: null,
            };
          }),
        );
        assert.strictEqual(
          (yield* discovery.check()).release?.description,
          "Release 1",
        );
        yield* TestClock.adjust("29 minutes");
        yield* discovery.check();
        assert.strictEqual(calls, 1);
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(
          (yield* discovery.check()).release?.description,
          "Release 2",
        );
        assert.strictEqual(calls, 2);
      }),
  );
  it.effect("refreshes successful daily caches written by older binaries", () =>
    Effect.gen(function* () {
      const store = memoryStorage();
      yield* store.write("discovery:darwin-arm64", {
        release: null,
        etag: "old-release",
        nextCheck: 86400000,
        failures: 0,
        error: null,
      });
      yield* TestClock.adjust("1 hour");
      let calls = 0;
      const discovery = makeDiscovery(store, "darwin-arm64", (_url, etag) =>
        Effect.sync(() => {
          calls++;
          assert.strictEqual(etag, "old-release");
          return {
            status: 200,
            etag: "new-release",
            text: JSON.stringify(release()),
            retryAfter: null,
            reset: null,
          };
        }),
      );
      assert.strictEqual((yield* discovery.check()).release?.version, "1.2.3");
      assert.strictEqual(calls, 1);
    }),
  );
});
describe("release validation", () => {
  it.effect(
    "compares semantic stable versions and ignores build metadata",
    () =>
      Effect.sync(() => {
        assert.isTrue(newer("1.10.0", "1.9.99"));
        assert.isFalse(newer("1.2.3+build", "1.2.3"));
        assert.isFalse(newer("1.2.3-beta", "1.2.2"));
        assert.isFalse(newer("01.2.3", "0.0.0"));
      }),
  );
  it.effect("freezes asset identity and limits plain text descriptions", () =>
    Effect.gen(function* () {
      const result = yield* validateRelease(release(), "darwin-arm64");
      assert.strictEqual(result?.description, "A clearer canvas.");
      assert.strictEqual(
        result?.assetUrl,
        "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/1",
      );
      assert.isBelow(shortDescription("a".repeat(1000)).length, 282);
      assert.strictEqual(
        shortDescription("<img src=x onerror=alert(1)>Hello"),
        "Hello",
      );
      assert.isTrue(shortDescription(null).includes("release notes"));
    }),
  );
  it.effect("ignores drafts and prereleases", () =>
    Effect.gen(function* () {
      assert.isNull(
        yield* validateRelease(release({ draft: true }), "darwin-arm64"),
      );
      assert.isNull(
        yield* validateRelease(release({ prerelease: true }), "darwin-arm64"),
      );
    }),
  );
  it.effect(
    "rejects malformed metadata, unsupported assets and untrusted URLs",
    () =>
      Effect.gen(function* () {
        for (const [input, platform] of [
          [{}, "darwin-arm64"],
          [release(), "darwin-x64"],
          [release({ tag_name: "v1.2.3-beta" }), "darwin-arm64"],
          [release({ assets: [] }), "darwin-arm64"],
          [
            release({
              assets: release().assets.map((asset) => ({ ...asset, id: -1 })),
            }),
            "darwin-arm64",
          ],
          [
            release({
              assets: release().assets.map((asset) => ({
                ...asset,
                browser_download_url: "https://example.com/framio",
              })),
            }),
            "darwin-arm64",
          ],
        ] as const) {
          const result = yield* validateRelease(input, platform).pipe(
            Effect.result,
          );
          assert.strictEqual(result._tag, "Failure");
        }
      }),
  );
});
