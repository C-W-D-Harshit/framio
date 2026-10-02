import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { processBirth } from "../../src/platform/process-liveness";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import * as Effect from "effect/Effect";
import { emptyUpdate } from "../../src/contracts/update";
import { makeUpdater } from "../../src/services/update/updater";
import { makeUpdateStorage } from "../../src/services/update/storage";
import {
  openUpdateStorage,
  installationIdentity,
} from "../../src/platform/update-storage";
import {
  executableVersion,
  extractExecutable,
  hashFile,
  supportedPlatform,
  writableTarget,
} from "../../src/platform/update-files";
import { makeDiscovery } from "../../src/services/update/discovery";
const directories: string[] = [];
function temporary() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "framio-update-")));
  directories.push(dir);
  return dir;
}
function executable(file: string, version: string) {
  writeFileSync(file, `#!/bin/sh\nprintf 'framio ${version}\\n'\n`);
  chmodSync(file, 0o755);
}
function run<A, E>(effect: Effect.Effect<A, E, import("effect/Scope").Scope>) {
  return Effect.runPromise(Effect.scoped(effect));
}
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
test("custom canonical installations share staged state, install atomically and retain rollback", async () => {
  const dir = temporary(),
    target = join(dir, "custom-framio"),
    data = join(dir, "updates");
  executable(target, "1.0.0");
  const identity = installationIdentity(target),
    files = join(data, identity.id);
  mkdirSync(files, { recursive: true });
  executable(join(files, "staged"), "2.0.0");
  await run(
    Effect.gen(function* () {
      const updater = yield* makeUpdater({
        directory: data,
        target,
        development: false,
        version: "1.0.0",
        platform: "darwin-arm64",
      });
      const hash = yield* hashFile(join(files, "staged"));
      yield* updater.store.write(updater.key, {
        ...emptyUpdate,
        phase: "ready",
        stagedHash: hash,
        release: {
          version: "2.0.0",
          tag: "v2.0.0",
          description: "Faster canvas",
          notesUrl:
            "https://github.com/C-W-D-Harshit/framio/releases/tag/v2.0.0",
          assetId: 1,
          assetName: "framio-darwin-arm64.tar.gz",
          assetUrl:
            "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/1",
          assetSize: 100,
          checksumUrl:
            "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/2",
          requiresProjectUpdate: false,
        },
      });
    }),
  );
  await run(
    Effect.gen(function* () {
      const updater = yield* makeUpdater({
        directory: data,
        target,
        development: false,
        version: "1.0.0",
        platform: "darwin-arm64",
      });
      expect((yield* updater.status()).phase).toBe("ready");
      yield* updater.install();
      const state = yield* updater.status();
      expect(state.installedVersion).toBe("2.0.0");
      expect(state.runningVersion).toBe("1.0.0");
      expect(state.restartNeeded).toBe(true);
      expect(yield* executableVersion(updater.backup)).toBe("1.0.0");
      executable(target, "unreadable");
      expect((yield* updater.status()).installedVersion).toBeNull();
      yield* updater.install(true);
      expect((yield* updater.status()).installedVersion).toBe("1.0.0");
    }),
  );
});
test("interrupted operations reconcile files, while live owners never expire", async () => {
  const dir = temporary(),
    target = join(dir, "framio");
  executable(target, "1.0.0");
  await run(
    Effect.gen(function* () {
      const updater = yield* makeUpdater({
        directory: join(dir, "state"),
        target,
        development: false,
        version: "1.0.0",
        platform: "darwin-arm64",
      });
      yield* updater.store.write(updater.key, {
        ...emptyUpdate,
        phase: "downloading",
      });
      expect((yield* updater.status()).phase).toBe("download-failed");
      yield* updater.store.write(updater.key, {
        ...emptyUpdate,
        phase: "installing",
        previousVersion: "1.0.0",
        operation: "rollback",
      });
      expect((yield* updater.status()).phase).toBe("idle");
      yield* updater.store.lock(
        updater.key,
        Effect.gen(function* () {
          yield* updater.store.write(updater.key, {
            ...emptyUpdate,
            phase: "downloading",
          });
          expect((yield* updater.status()).phase).toBe("downloading");
        }),
      );
    }),
  );
});
test("cross-process claims are exclusive and dead owners are recoverable", async () => {
  const dir = temporary(),
    adapter = resolve(import.meta.dir, "../../src/platform/update-storage.ts");
  const owner = join(dir, "owner.ts");
  writeFileSync(
    owner,
    `import {openUpdateStorage} from ${JSON.stringify(adapter)}; const db=openUpdateStorage(${JSON.stringify(dir)}); console.log(db.claim("installation")); await Bun.sleep(60000);`,
  );
  const child = Bun.spawn([process.execPath, owner], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const claim = await reader.read();
  expect(new TextDecoder().decode(claim.value).trim()).not.toBe("null");
  const db = openUpdateStorage(dir);
  try {
    expect(db.claim("installation")).toBeNull();
    child.kill("SIGKILL");
    await child.exited;
    expect(db.claim("installation")).not.toBeNull();
  } finally {
    child.kill();
    db.close();
  }
});
test("a reused PID does not keep an abandoned operation locked", () => {
  const dir = temporary();
  const store = openUpdateStorage(dir);
  const database = new Database(join(dir, "updates.sqlite"));
  try {
    expect(processBirth(process.pid)).not.toBeNull();
    database
      .query("INSERT INTO owners VALUES (?,?,?,?)")
      .run("installation", process.pid, "abandoned", "different-process-birth");
    expect(store.owned("installation")).toBe(false);
    expect(store.claim("installation")).not.toBeNull();
    expect(store.owned("installation")).toBe(true);
    expect(store.claim("installation")).toBeNull();
  } finally {
    database.close();
    store.close();
  }
});
test("daily cache uses ETags, keeps offline metadata and respects rate limit backoff", async () => {
  const dir = temporary();
  await run(
    Effect.gen(function* () {
      const store = yield* makeUpdateStorage(dir);
      let calls = 0;
      const request = (_url: string, etag?: string) =>
        Effect.sync(() => {
          calls++;
          expect(etag).toBe("fixture");
          return {
            status: 304,
            etag: "fixture",
            text: "",
            retryAfter: null,
            reset: null,
          };
        });
      yield* store.write("discovery:darwin-arm64", {
        release: null,
        etag: "fixture",
        nextCheck: 0,
        failures: 0,
        error: null,
      });
      const discovery = makeDiscovery(store, "darwin-arm64", request);
      yield* discovery.check();
      yield* discovery.check();
      expect(calls).toBe(1);
      yield* discovery.check(true);
      expect(calls).toBe(2);
      const limited = makeDiscovery(store, "darwin-arm64", () =>
        Effect.succeed({
          status: 429,
          etag: null,
          text: "",
          retryAfter: "3600",
          reset: null,
        }),
      );
      const result = yield* limited.check(true);
      expect(result.error).toContain("429");
      yield* discovery.check(true);
      expect(calls).toBe(2);
    }),
  );
});
function tar(name: string, body: string, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write("0000755\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
  header.write("00000000000\0", 136);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write("ustar\0", 257);
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(
    Buffer.concat([
      header,
      Buffer.from(body),
      Buffer.alloc(((512 - (body.length % 512)) % 512) + 1024),
    ]),
  );
}
test("archive verification rejects unsafe paths, links, truncation and version failures", async () => {
  const dir = temporary();
  for (const [index, name, type] of [
    [0, "../framio", "0"],
    [1, "framio", "2"],
    [2, "/framio", "0"],
  ] as const) {
    const archive = join(dir, `archive-${index}`);
    writeFileSync(archive, tar(name, "bad", type));
    expect(
      (
        await run(
          extractExecutable(archive, join(dir, `out-${index}`), "framio").pipe(
            Effect.result,
          ),
        )
      )._tag,
    ).toBe("Failure");
  }
  const archive = join(dir, "valid");
  writeFileSync(
    archive,
    tar("framio", "#!/bin/sh\nprintf 'framio 3.0.0\\n'\n"),
  );
  await run(extractExecutable(archive, join(dir, "out"), "framio"));
  expect(await run(executableVersion(join(dir, "out")))).toBe("3.0.0");
  expect(supportedPlatform("darwin", "x64", true)).toBe("darwin-arm64");
  expect(() => supportedPlatform("darwin", "x64")).toThrow();
  executable(join(dir, "bad"), "wrong");
  expect(
    (await run(executableVersion(join(dir, "bad")).pipe(Effect.result)))._tag,
  ).toBe("Failure");
});
test("executable verification accepts the compiled CLI version prefix", async () => {
  const dir = temporary();
  const target = join(dir, "framio");
  executable(target, "v0.0.7");
  expect(await run(executableVersion(target))).toBe("0.0.7");
});
test("source runs and install without staged data cannot mutate the executable", async () => {
  const dir = temporary(),
    target = join(dir, "framio");
  executable(target, "1.0.0");
  const before = readFileSync(target, "utf8");
  await run(
    Effect.gen(function* () {
      const updater = yield* makeUpdater({
        directory: join(dir, "updates"),
        target,
        development: true,
        platform: "darwin-arm64",
      });
      expect((yield* updater.status()).canInstall).toBe(false);
      expect((yield* updater.install().pipe(Effect.result))._tag).toBe(
        "Failure",
      );
      const binary = yield* makeUpdater({
        directory: join(dir, "binary"),
        target,
        development: false,
        platform: "darwin-arm64",
      });
      expect((yield* binary.install().pipe(Effect.result))._tag).toBe(
        "Failure",
      );
    }),
  );
  expect(readFileSync(target, "utf8")).toBe(before);
});

test("staging verifies checksum and executable version, and partial downloads never publish readiness", async () => {
  const { stageRelease } = await import("../../src/services/update/staging");
  const { createHash } = await import("node:crypto");
  const dir = temporary(),
    archive = tar(
      "framio-darwin-arm64",
      "#!/bin/sh\nprintf 'framio 2.0.0\\n'\n",
    ),
    digest = createHash("sha256").update(archive).digest("hex");
  const release = {
    version: "2.0.0",
    tag: "v2.0.0",
    description: "Fixture",
    notesUrl: "https://github.com/C-W-D-Harshit/framio/releases/tag/v2.0.0",
    assetId: 1,
    assetName: "framio-darwin-arm64.tar.gz",
    assetUrl:
      "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/1",
    assetSize: archive.length,
    checksumUrl:
      "https://api.github.com/repos/C-W-D-Harshit/framio/releases/assets/2",
    requiresProjectUpdate: false,
  };
  const original = globalThis.fetch;
  let checksum = digest,
    bytes = archive,
    expected = "2.0.0";
  globalThis.fetch = (async (url: string | URL | Request) => {
    const isChecksum = String(url).endsWith("/2");
    const response = new Response(
      isChecksum ? `${checksum}  framio-darwin-arm64.tar.gz\n` : bytes,
    );
    Object.defineProperty(response, "url", {
      value: "https://release-assets.githubusercontent.com/fixture",
    });
    return response;
  }) as typeof fetch;
  try {
    const progress: number[] = [];
    expect(
      (
        await run(
          stageRelease(release, join(dir, "valid"), (value) =>
            Effect.sync(() => {
              progress.push(value);
            }),
          ),
        )
      ).length,
    ).toBe(64);
    expect(progress.at(-1)).toBe(archive.length);
    checksum = "0".repeat(64);
    expect(
      (
        await run(
          stageRelease(release, join(dir, "checksum"), () => Effect.void).pipe(
            Effect.result,
          ),
        )
      )._tag,
    ).toBe("Failure");
    checksum = digest;
    expect(
      (
        await run(
          stageRelease(
            { ...release, version: "3.0.0" },
            join(dir, "version"),
            () => Effect.void,
          ).pipe(Effect.result),
        )
      )._tag,
    ).toBe("Failure");
    bytes = archive.subarray(0, 20);
    expect(
      (
        await run(
          stageRelease(release, join(dir, "partial"), () => Effect.void).pipe(
            Effect.result,
          ),
        )
      )._tag,
    ).toBe("Failure");
  } finally {
    globalThis.fetch = original;
  }
});

test("unwritable custom targets fail before any executable mutation", async () => {
  const dir = temporary(),
    target = join(dir, "framio");
  executable(target, "1.0.0");
  chmodSync(dir, 0o500);
  try {
    expect((await run(writableTarget(target).pipe(Effect.result)))._tag).toBe(
      "Failure",
    );
  } finally {
    chmodSync(dir, 0o700);
  }
});
