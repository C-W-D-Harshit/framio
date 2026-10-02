import * as Effect from "effect/Effect";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Release } from "../../contracts/update";
import { UpdateFailure } from "../../contracts/update";
import { boundedFetch } from "../../platform/update-http";
import {
  downloadArchive,
  extractExecutable,
  executableVersion,
  hashFile,
  native,
  removeFile,
  syncDirectory,
} from "../../platform/update-files";
export const stageRelease = Effect.fn("UpdateStaging.stage")(function* (
  release: Release,
  directory: string,
  progress: (bytes: number) => Effect.Effect<void, UpdateFailure>,
) {
  yield* native(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  });
  const archive = join(directory, "download.partial"),
    executable = join(
      directory,
      process.platform === "win32" ? "staged.exe" : "staged",
    );
  yield* removeFile(archive);
  yield* removeFile(executable);
  const sums = yield* boundedFetch(
    release.checksumUrl,
    undefined,
    "application/octet-stream",
  );
  if (sums.status !== 200)
    return yield* new UpdateFailure({
      message: `Could not download checksums: HTTP ${sums.status}`,
    });
  const matches = sums.text
    .split("\n")
    .filter((line) => line.endsWith(`  ${release.assetName}`));
  if (
    matches.length !== 1 ||
    !/^[a-f0-9]{64}  [A-Za-z0-9.-]+$/.test(matches[0]!)
  )
    return yield* new UpdateFailure({
      message: "Release checksum is missing or malformed",
    });
  yield* downloadArchive(release, archive, (bytes) =>
    Effect.runPromise(progress(bytes)),
  );
  if ((yield* hashFile(archive)) !== matches[0]!.slice(0, 64))
    return yield* new UpdateFailure({
      message:
        "Archive checksum does not match the release checksum. Retry download.",
    });
  yield* extractExecutable(
    archive,
    executable,
    release.assetName.replace(/\.tar\.gz$/, "") +
      (release.assetName.startsWith("framio-win32-") ? ".exe" : ""),
  );
  if ((yield* executableVersion(executable)) !== release.version)
    return yield* new UpdateFailure({
      message: "Staged executable version does not match the release tag",
    });
  const hash = yield* hashFile(executable);
  yield* removeFile(archive);
  yield* native(async () => {
    await syncDirectory(directory);
  });
  return hash;
});
