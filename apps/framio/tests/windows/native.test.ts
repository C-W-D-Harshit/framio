import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { processBirth } from "../../src/platform/process-liveness";
import { stopWindowsProcessTree } from "../../src/platform/server-child";
import { isAlive } from "../../src/services/server-registry";
import {
  executableVersion,
  extractExecutable,
  replaceExecutable,
  supportedPlatform,
} from "../../src/platform/update-files";

test("Windows release selection accepts x64 and rejects unsupported architectures", () => {
  expect(supportedPlatform("win32", "x64")).toBe("win32-x64");
  expect(() => supportedPlatform("win32", "arm64")).toThrow();
});

test("process birth identifies a live Windows owner", () => {
  const birth = processBirth(process.pid);
  expect(birth).not.toBeNull();
  expect(processBirth(process.pid)).toBe(birth);
});

test.skipIf(process.platform !== "win32")(
  "Windows cleanup terminates an owned process and its descendant",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "framio tree cleanup "));
    const fixture = join(directory, "tree.ts");
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let descendant: number | undefined;
    try {
      writeFileSync(
        fixture,
        `
        if (process.argv[2] === "leaf") {
          console.log("ready");
          setInterval(() => {}, 1000);
        } else {
          const leaf = Bun.spawn([process.execPath, import.meta.path, "leaf"], { stdout: "pipe" });
          await leaf.stdout.getReader().read();
          console.log(leaf.pid);
          setInterval(() => {}, 1000);
        }
      `,
      );
      child = Bun.spawn([process.execPath, fixture], { stdout: "pipe" });
      if (!child.stdout || typeof child.stdout === "number")
        throw new Error("Missing process tree fixture output");
      const reader = child.stdout.getReader();
      descendant = Number(
        new TextDecoder().decode((await reader.read()).value).trim(),
      );
      reader.releaseLock();
      expect(Number.isInteger(descendant) && descendant > 0).toBe(true);
      expect(isAlive(descendant)).toBe(true);
      expect(await Effect.runPromise(stopWindowsProcessTree(child.pid))).toBe(
        true,
      );
      await child.exited;
      expect(isAlive(child.pid)).toBe(false);
      expect(isAlive(descendant)).toBe(false);
    } finally {
      if (descendant && isAlive(descendant)) process.kill(descendant);
      if (child && child.exitCode === null) {
        child.kill();
        await child.exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15000,
);

test("native archive extraction and replacement keep a running executable alive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "framio native test "));
  const suffix = process.platform === "win32" ? ".exe" : "";
  const target = join(directory, `framio${suffix}`);
  const source = join(directory, `framio-win32-x64${suffix}`);
  const staged = join(directory, `staged${suffix}`);
  const fixture = join(directory, "fixture.ts");
  const archive = join(directory, "release.tar.gz");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    for (const [outfile, version] of [
      [target, "1.0.0"],
      [source, "2.0.0"],
    ]) {
      writeFileSync(
        fixture,
        `if(process.argv[2]==="--version") console.log("framio ${version}"); else {console.log("ready"); setInterval(()=>{},1000)}`,
      );
      const build = await Bun.build({
        entrypoints: [fixture],
        compile: { outfile },
      });
      expect(build.success).toBe(true);
    }
    const tar = Bun.spawn(
      [
        "tar",
        "--format=ustar",
        "-czf",
        archive,
        "-C",
        directory,
        `framio-win32-x64${suffix}`,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    expect(await tar.exited).toBe(0);
    await Effect.runPromise(
      extractExecutable(archive, staged, `framio-win32-x64${suffix}`),
    );
    expect(readFileSync(staged)).toEqual(readFileSync(source));
    child = Bun.spawn([target], { stdout: "pipe", stderr: "inherit" });
    if (!child.stdout || typeof child.stdout === "number")
      throw new Error("Missing fixture output");
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "ready",
    );
    reader.releaseLock();
    await Effect.runPromise(replaceExecutable(staged, target, 0o755));
    expect(await Effect.runPromise(executableVersion(target))).toBe("2.0.0");
    expect(child.exitCode).toBeNull();
    await Effect.runPromise(replaceExecutable(source, target, 0o755));
    expect(await Effect.runPromise(executableVersion(target))).toBe("2.0.0");
  } finally {
    if (child) {
      child.kill();
      await child.exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
