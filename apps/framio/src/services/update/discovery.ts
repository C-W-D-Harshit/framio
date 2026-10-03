import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Schema from "effect/Schema";
import { Release, Version, UpdateFailure } from "../../contracts/update";
import { boundedFetch } from "../../platform/update-http";
import type { UpdateStorage } from "./storage";
export const REPOSITORY = "C-W-D-Harshit/framio";
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const Asset = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  size: Schema.Int,
  browser_download_url: Schema.String,
});
const Metadata = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  body: Schema.NullOr(Schema.String),
  assets: Schema.Array(Asset),
});
const Cache = Schema.Struct({
  release: Schema.NullOr(Release),
  etag: Schema.NullOr(Schema.String),
  nextCheck: Schema.Number,
  checkedAt: Schema.optional(Schema.Number),
  failures: Schema.Int,
  rateLimited: Schema.optional(Schema.Boolean),
  error: Schema.NullOr(Schema.String),
});
export function newer(a: string, b: string) {
  const av = Schema.decodeUnknownResult(Version)(a),
    bv = Schema.decodeUnknownResult(Version)(b);
  if (av._tag === "Failure" || bv._tag === "Failure") return false;
  const aa = a.split("+")[0]!.split(".").map(BigInt),
    bb = b.split("+")[0]!.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (aa[i]! > bb[i]!) return true;
    if (aa[i]! < bb[i]!) return false;
  }
  return false;
}
export function shortDescription(body: string | null) {
  const first = (body ?? "").trim().split(/\n\s*\n|\n(?=#)/)[0] ?? "";
  const text = first
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text
    ? text.slice(0, 280) + (text.length > 280 ? "…" : "")
    : "A new Framio release is available. Read the release notes for details.";
}
export const validateRelease = Effect.fn("ReleaseDiscovery.validate")(
  function* (input: unknown, platform: string) {
    const data = yield* Schema.decodeUnknownEffect(Metadata)(input).pipe(
      Effect.mapError(
        (error) =>
          new UpdateFailure({
            message: `Invalid release metadata: ${error.message}`,
          }),
      ),
    );
    if (data.draft || data.prerelease) return null;
    const version = yield* Schema.decodeUnknownEffect(Version)(
      data.tag_name.replace(/^v/, ""),
    ).pipe(
      Effect.mapError(
        () =>
          new UpdateFailure({
            message: "Release tag is not a stable semantic version",
          }),
      ),
    );
    if (data.tag_name !== `v${version}`)
      return yield* new UpdateFailure({
        message: "Release tag must use v followed by the package version",
      });
    const assetName = `framio-${platform}.tar.gz`;
    const assets = data.assets.filter((asset) => asset.name === assetName),
      sums = data.assets.filter((asset) => asset.name === "SHA256SUMS");
    if (assets.length !== 1 || sums.length !== 1)
      return yield* new UpdateFailure({
        message: `This release has no verified update for ${platform}. Read the release notes or try again later.`,
      });
    const asset = assets[0]!,
      checksum = sums[0]!;
    const base = `https://github.com/${REPOSITORY}/releases/download/${data.tag_name}/`;
    if (
      asset.browser_download_url !== base + assetName ||
      checksum.browser_download_url !== base + "SHA256SUMS" ||
      asset.id <= 0 ||
      checksum.id <= 0 ||
      checksum.size <= 0 ||
      checksum.size > 1024 * 1024 ||
      asset.size <= 0 ||
      asset.size > 256 * 1024 * 1024
    )
      return yield* new UpdateFailure({
        message: "Release assets do not match the trusted distribution",
      });
    return {
      version,
      tag: data.tag_name,
      description: shortDescription(data.body),
      notesUrl: `https://github.com/${REPOSITORY}/releases/tag/${data.tag_name}`,
      assetId: asset.id,
      assetName,
      assetUrl: `https://api.github.com/repos/${REPOSITORY}/releases/assets/${asset.id}`,
      assetSize: asset.size,
      checksumUrl: `https://api.github.com/repos/${REPOSITORY}/releases/assets/${checksum.id}`,
      requiresProjectUpdate: /(?:^|\n)Project update required:/i.test(
        data.body ?? "",
      ),
    } satisfies Release;
  },
);
export const makeDiscovery = (
  store: UpdateStorage,
  platform: string,
  request = boundedFetch,
) => {
  const cachedStatus = () => store.read(`discovery:${platform}`, Cache);
  const fresh = (cache: typeof Cache.Type, now: number, force: boolean) => {
    // Older binaries wrote successful caches with a 24-hour lifetime.
    const nextCheck =
      cache.failures === 0 && !cache.error
        ? Math.min(
            cache.nextCheck,
            (cache.checkedAt ?? cache.nextCheck - 86400000) + CHECK_INTERVAL_MS,
          )
        : cache.nextCheck;
    return now < nextCheck && (!force || cache.rateLimited === true);
  };
  const check = Effect.fn("ReleaseDiscovery.check")(function* (force = false) {
    const now = yield* Clock.currentTimeMillis;
    const cached = yield* cachedStatus();
    if (cached && fresh(cached, now, force)) return cached;
    return yield* store.lock(
      "discovery",
      Effect.gen(function* () {
        const current = yield* cachedStatus();
        if (current && fresh(current, now, force)) return current;
        const result = yield* Effect.gen(function* () {
          const response = yield* request(
            `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
            current?.etag ?? undefined,
          );
          if (response.status === 304 && current)
            return {
              ...current,
              nextCheck: now + CHECK_INTERVAL_MS,
              checkedAt: now,
              failures: 0,
              rateLimited: false,
              error: null,
            };
          if (response.status !== 200) {
            const seconds = (value: string | null) => {
              const decoded = Schema.decodeUnknownResult(
                Schema.NumberFromString,
              )(value ?? "0");
              return decoded._tag === "Success" &&
                Number.isFinite(decoded.success)
                ? decoded.success
                : 0;
            };
            const retry = Math.max(
              seconds(response.retryAfter) * 1000,
              seconds(response.reset) * 1000 - now,
              60000 * 2 ** Math.min(current?.failures ?? 0, 10),
            );
            return {
              release: current?.release ?? null,
              etag: current?.etag ?? null,
              nextCheck: now + Math.min(86400000, retry),
              failures: (current?.failures ?? 0) + 1,
              rateLimited: response.status === 403 || response.status === 429,
              error: `GitHub returned ${response.status}. Cached update information remains available.`,
            };
          }
          const metadata = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Unknown),
          )(response.text).pipe(
            Effect.mapError(
              (error) => new UpdateFailure({ message: error.message }),
            ),
          );
          const release = yield* validateRelease(metadata, platform);
          return {
            release,
            etag: response.etag,
            nextCheck: now + CHECK_INTERVAL_MS,
            checkedAt: now,
            failures: 0,
            rateLimited: false,
            error: null,
          };
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              release: current?.release ?? null,
              etag: current?.etag ?? null,
              failures: (current?.failures ?? 0) + 1,
              rateLimited: false,
              nextCheck:
                now +
                Math.min(
                  86400000,
                  60000 * 2 ** Math.min(current?.failures ?? 0, 10),
                ),
              error: error.message,
            }),
          ),
        );
        yield* store.write(`discovery:${platform}`, result);
        return result;
      }),
    );
  });
  return { check, cachedStatus };
};
