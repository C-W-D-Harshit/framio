import { gunzipSync } from "node:zlib";
import { expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUi } from "../../scripts/services/ui-build";

test("UI publication retains loaded bytes without retaining build trees", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-ui-build-"));
  try {
    for (const dir of ["src/ui", "src/runtime", "src/scaffold"])
      mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "src/scaffold/example.txt"), "scaffold");
    const build = () =>
      Effect.runPromise(
        Effect.scoped(buildUi(root)).pipe(Effect.provide(BunServices.layer)),
      );
    const manifest = join(root, "src/generated/assets.js");
    let first:
      | { uiFiles: Record<string, Uint8Array>; runtimeFile: Uint8Array }
      | undefined;
    for (let i = 0; i < 3; i++) {
      writeFileSync(
        join(root, "src/ui/index.html"),
        `<html><body>UI ${i}<script type="module" src="./index.ts"></script></body></html>`,
      );
      writeFileSync(join(root, "src/ui/index.ts"), `console.log("ui ${i}")`);
      writeFileSync(
        join(root, "src/runtime/runtime.ts"),
        `globalThis.console.log("runtime ${i}");`,
      );
      await build();
      const assets = await import(`${manifest}?build=${i}`);
      expect(new TextDecoder().decode(assets.uiFiles["index.html"])).toContain(
        `UI ${i}`,
      );
      expect(new TextDecoder().decode(assets.runtimeFile)).toContain(
        `runtime ${i}`,
      );
      expect(gunzipSync(assets.uiGzipFiles["index.html"])).toEqual(
        Buffer.from(assets.uiFiles["index.html"]),
      );
      expect(gunzipSync(assets.runtimeGzipFile)).toEqual(
        Buffer.from(assets.runtimeFile),
      );
      first ??= assets;
      expect(readdirSync(join(root, "dist"))).toEqual(["sourcemaps"]);
      expect(
        Object.keys(assets.uiFiles).some((name) => name.endsWith(".map")),
      ).toBe(false);
      const maps = readdirSync(join(root, "dist/sourcemaps"));
      expect(maps.some((name) => name.endsWith(".js.map"))).toBe(true);
      for (const name of maps.filter((name) => name.endsWith(".js")))
        expect(readFileSync(join(root, "dist/sourcemaps", name))).toEqual(
          Buffer.from(assets.uiFiles[name]),
        );
    }
    expect(new TextDecoder().decode(first!.uiFiles["index.html"])).toContain(
      "UI 0",
    );
    expect(new TextDecoder().decode(first!.runtimeFile)).toContain("runtime 0");
    const previous = readFileSync(manifest, "utf8");
    writeFileSync(join(root, "src/runtime/runtime.ts"), "export function (");
    await expect(build()).rejects.toThrow();
    expect(readFileSync(manifest, "utf8")).toBe(previous);
    expect(readdirSync(join(root, "dist"))).toEqual(["sourcemaps"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
