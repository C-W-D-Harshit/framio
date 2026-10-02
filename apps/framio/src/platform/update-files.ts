import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { spawn } from "node:child_process";
import * as Effect from "effect/Effect";
import { UpdateFailure, type Release } from "../contracts/update";
export const native = <A>(work: (signal: AbortSignal) => Promise<A>) =>
  Effect.callback<A, UpdateFailure>((resume, signal) => {
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work(signal);
    });
    pending.then(
      (value) => resume(Effect.succeed(value)),
      (cause) =>
        resume(Effect.fail(new UpdateFailure({ message: String(cause) }))),
    );
    return Effect.promise(() =>
      pending.then(
        () => undefined,
        () => undefined,
      ),
    );
  });
export function supportedPlatform(
  os = process.platform,
  arch: string = process.arch,
  translated = false,
) {
  if (os === "darwin" && translated) arch = "arm64";
  if (
    (os === "darwin" && arch === "arm64") ||
    (os === "linux" && (arch === "x64" || arch === "arm64"))
  )
    return `${os}-${arch}`;
  throw new Error("No Framio release is available for this platform.");
}
export const platform = Effect.fn("UpdateFiles.platform")(function* () {
  const translated =
    process.platform === "darwin" && process.arch === "x64"
      ? (yield* command("/usr/sbin/sysctl", [
          "-n",
          "sysctl.proc_translated",
        ]).pipe(Effect.catch(() => Effect.succeed("0")))).trim() === "1"
      : false;
  return yield* Effect.try({
    try: () => supportedPlatform(process.platform, process.arch, translated),
    catch: (cause) => new UpdateFailure({ message: String(cause) }),
  });
});
export const command = (file: string, args: string[]) =>
  native(
    (signal) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(file, args, {
          signal,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, BUN_BE_BUN: "0" },
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.length > 8192) child.kill("SIGKILL");
        });
        const abort = () => child.kill("SIGKILL");
        signal.addEventListener("abort", abort, { once: true });
        child.once("close", () => signal.removeEventListener("abort", abort));
        child.stderr.resume();
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 && output.length <= 8192
            ? resolve(output.trim())
            : reject(
                new Error(`Executable verification failed with exit ${code}`),
              ),
        );
      }),
  ).pipe(
    Effect.timeout("10 seconds"),
    Effect.mapError((error) => new UpdateFailure({ message: error.message })),
  );
export const executableVersion = (file: string) =>
  command(file, ["--version"]).pipe(
    Effect.flatMap((output) => {
      const match = /(?:^|\s)v?(\d+\.\d+\.\d+(?:\+[A-Za-z0-9.-]+)?)$/.exec(
        output,
      );
      return match
        ? Effect.succeed(match[1]!)
        : Effect.fail(
            new UpdateFailure({
              message: `Unrecognized executable version: ${output}`,
            }),
          );
    }),
  );
export const writableTarget = (target: string) =>
  native(async () => {
    const info = await stat(target);
    if (!info.isFile())
      throw new Error("The installation target is not a regular executable");
    await access(dirname(target), constants.W_OK | constants.X_OK);
    return info.mode & 0o777;
  });
export const hashFile = (file: string) =>
  native(async (signal) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file, { signal }))
      hash.update(chunk);
    return hash.digest("hex");
  });
export const removeFile = (file: string) =>
  native(async () => {
    await unlink(file).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  });
export async function syncDirectory(directory: string) {
  const fd = await open(directory, "r");
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
export const replaceExecutable = (
  source: string,
  target: string,
  mode: number,
) =>
  native(async () => {
    const temporary = join(dirname(target), `.framio-update-${randomUUID()}`);
    try {
      await copyFile(source, temporary, constants.COPYFILE_EXCL);
      await chmod(temporary, mode);
      const fd = await open(temporary, "r");
      try {
        await fd.sync();
      } finally {
        await fd.close();
      }
      await rename(temporary, target);
      await syncDirectory(dirname(target));
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
export const backupExecutable = (target: string, backup: string) =>
  native(async () => {
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
    const temporary = `${backup}.${randomUUID()}.tmp`;
    try {
      await copyFile(target, temporary, constants.COPYFILE_EXCL);
      const fd = await open(temporary, "r");
      try {
        await fd.sync();
      } finally {
        await fd.close();
      }
      await rename(temporary, backup);
      await syncDirectory(dirname(backup));
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
export const downloadArchive = (
  release: Release,
  destination: string,
  progress: (bytes: number) => Promise<void>,
) =>
  native(async (signal) => {
    const response = await fetch(release.assetUrl, {
      signal,
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "Framio updater",
      },
    });
    if (!response.ok || !response.body)
      throw new Error(`Archive download failed: HTTP ${response.status}`);
    const final = new URL(response.url);
    if (
      final.protocol !== "https:" ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(final.hostname)
    )
      throw new Error("Unsafe archive redirect");
    const fd = await open(destination, "wx", 0o600);
    let bytes = 0,
      last = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.length;
        if (bytes > release.assetSize || bytes > 256 * 1024 * 1024)
          throw new Error("Archive exceeds expected size");
        await fd.writeFile(chunk);
        if (bytes - last >= 512 * 1024) {
          await progress(bytes);
          last = bytes;
        }
      }
      if (bytes !== release.assetSize)
        throw new Error("Archive download is incomplete");
      await fd.sync();
      await progress(bytes);
    } finally {
      await fd.close();
    }
  }).pipe(
    Effect.timeout("15 minutes"),
    Effect.mapError((error) => new UpdateFailure({ message: error.message })),
  );

/** Only the build workflow's single regular-file tar format is accepted. */
export const extractExecutable = (
  archive: string,
  destination: string,
  expected: string,
) =>
  native(async (signal) => {
    const input = createReadStream(archive, { signal });
    const gzip = input.pipe(createGunzip());
    input.on("error", (error) => gzip.destroy(error));
    const fd = await open(destination, "wx", 0o700);
    let header = Buffer.alloc(0),
      remaining = -1,
      padding = 0,
      seen = false,
      total = 0,
      tail = 0;
    try {
      for await (const data of gzip) {
        let chunk = Buffer.from(data);
        total += chunk.length;
        if (total > 512 * 1024 * 1024)
          throw new Error("Extracted archive exceeds 512 MiB");
        while (chunk.length) {
          if (remaining > 0) {
            const length = Math.min(remaining, chunk.length);
            await fd.writeFile(chunk.subarray(0, length));
            remaining -= length;
            chunk = chunk.subarray(length);
            continue;
          }
          if (padding > 0) {
            const length = Math.min(padding, chunk.length);
            if (chunk.subarray(0, length).some((byte) => byte !== 0))
              throw new Error("Invalid archive padding");
            padding -= length;
            chunk = chunk.subarray(length);
            continue;
          }
          const length = Math.min(512 - header.length, chunk.length);
          header = Buffer.concat([header, chunk.subarray(0, length)]);
          chunk = chunk.subarray(length);
          if (header.length < 512) continue;
          if (header.every((byte) => byte === 0)) {
            tail += 512;
            header = Buffer.alloc(0);
            continue;
          }
          if (seen || tail)
            throw new Error("Archive contains unexpected entries");
          const field = (start: number, end: number) =>
            header.subarray(start, end).toString("utf8").split("\0")[0]!;
          const name = field(0, 100),
            prefix = field(345, 500),
            type = header[156];
          if (
            name !== expected ||
            prefix ||
            (type !== 0 && type !== 48) ||
            field(157, 257)
          )
            throw new Error(
              "Archive must contain only the expected regular executable",
            );
          const checksumText = field(148, 156).trim(),
            sizeText = field(124, 136).trim();
          if (!/^[0-7]+$/.test(checksumText) || !/^[0-7]+$/.test(sizeText))
            throw new Error("Invalid tar header numbers");
          let sum = 0;
          for (let i = 0; i < 512; i++)
            sum += i >= 148 && i < 156 ? 32 : header[i]!;
          if (sum !== parseInt(checksumText, 8))
            throw new Error("Invalid tar header checksum");
          remaining = parseInt(sizeText, 8);
          if (remaining <= 0 || remaining > 512 * 1024 * 1024)
            throw new Error("Invalid executable size");
          padding = (512 - (remaining % 512)) % 512;
          seen = true;
          header = Buffer.alloc(0);
        }
      }
      if (!seen || remaining !== 0 || padding || header.length || tail < 1024)
        throw new Error("Truncated archive");
      await fd.sync();
    } finally {
      gzip.destroy();
      input.destroy();
      await fd.close();
    }
  }).pipe(
    Effect.timeout("60 seconds"),
    Effect.mapError((error) => new UpdateFailure({ message: error.message })),
  );
