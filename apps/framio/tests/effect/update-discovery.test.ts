import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
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
