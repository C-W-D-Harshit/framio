import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BROWSERS_DIR } from "../../src/lib/paths";
import { Effect } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { ensureBrowser as ensureBrowserEffect } from "../../src/lib/browser";
import { imageSize } from "../../src/server/image-size";

test("actual React and image captures preserve dimensions and clean temporary servers", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-capture-"));
  const dir = join(root, ".framio/pages/01-test");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, ".framio/theme.css"), "body { margin: 0; }");
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(root, ".framio/node_modules"),
  );
  writeFileSync(
    join(dir, "overflow.tsx"),
    'import { createElement } from "react"; export const meta = { name: "Overflow", width: 390, height: 844 }; export default function Frame() { return createElement("div", { style: { height: 900, background: "#336699" } }, "Capture fixture"); }',
  );
  writeFileSync(
    join(dir, "reference.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 844"><rect width="390" height="844" fill="#669933"/></svg>',
  );
  await ensureBrowser();
  mkdirSync(join(root, "home/.framio"), { recursive: true });
  symlinkSync(BROWSERS_DIR, join(root, "home/.framio/browsers"));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const run = async (args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, "../../src/cli.ts"), ...args],
      {
        cwd: root,
        env: { ...process.env, HOME: join(root, "home") },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    children.push(child);
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, output: out + err };
  };
  try {
    const result = await run([
      "screenshot",
      "01-test/overflow",
      "01-test/reference.svg",
      "--scale=2",
    ]);
    expect(result.code).toBe(0);
    expect(
      imageSize(
        new Uint8Array(
          readFileSync(
            join(root, ".framio/.state/screenshots/01-test/overflow.png"),
          ),
        ),
        "png",
      ),
    ).toEqual({ width: 780, height: 1800 });
    expect(
      imageSize(
        new Uint8Array(
          readFileSync(
            join(root, ".framio/.state/screenshots/01-test/reference.svg.png"),
          ),
        ),
        "png",
      ),
    ).toEqual({ width: 780, height: 1688 });
    expect(existsSync(join(root, ".framio/.state/server.json"))).toBe(false);
    expect(existsSync(join(root, ".framio/.state/server.lock"))).toBe(false);

    writeFileSync(
      join(dir, "broken.tsx"),
      'export default function Broken() { throw new Error("intentional render failure"); }',
    );
    const failed = await run(["screenshot", "01-test/broken"]);
    expect(failed.code).toBe(1);
    expect(failed.output).toContain("intentional render failure");
    expect(existsSync(join(root, ".framio/.state/server.json"))).toBe(false);
    expect(existsSync(join(root, ".framio/.state/server.lock"))).toBe(false);
  } finally {
    await run(["stop"]);
    for (const child of children)
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await child.exited;
      }
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);

function ensureBrowser() {
  return Effect.runPromise(
    ensureBrowserEffect().pipe(Effect.provide(BunFileSystem.layer)),
  );
}
