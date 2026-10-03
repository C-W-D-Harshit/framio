import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import baseline from "../fixtures/effect-v4-baseline.json";

test("scaffold changes are limited to registry configuration, layer examples and agent guidance, with no Effect imports", () => {
  const layerUpdates = new Set([
    "src/scaffold/pages/00-example/sign-in.tsx",
    "src/scaffold/pages/00-example/sign-in--split.tsx",
  ]);
  for (const [file, hash] of Object.entries(baseline.scaffold)) {
    if (file === "src/scaffold/components.json") {
      const config = JSON.parse(
        readFileSync(resolve(import.meta.dir, "../..", file), "utf8"),
      );
      expect(config.registries).toBeUndefined();
      expect(
        createHash("sha256")
          .update(`${JSON.stringify(config, null, 2)}\n`)
          .digest("hex"),
      ).toBe(hash);
      continue;
    }
    if (file === "src/scaffold/evidence.json") {
      expect(
        JSON.parse(
          readFileSync(resolve(import.meta.dir, "../..", file), "utf8"),
        ),
      ).toEqual({ version: 1, reviews: [] });
      continue;
    }
    if (file.startsWith("src/scaffold/skill/")) {
      expect(
        readFileSync(resolve(import.meta.dir, "../..", file), "utf8"),
      ).not.toMatch(/from ["'](?:effect|@effect\/)/);
      continue;
    }
    if (layerUpdates.has(file)) {
      const content = readFileSync(
        resolve(import.meta.dir, "../..", file),
        "utf8",
      );
      expect(content).not.toMatch(/from ["'](?:effect|@effect\/)/);
      expect(content).toContain("data-layer");
      continue;
    }
    expect(
      createHash("sha256")
        .update(readFileSync(resolve(import.meta.dir, "../..", file)))
        .digest("hex"),
    ).toBe(hash);
  }
  const scaffold = JSON.parse(
    readFileSync(
      resolve(import.meta.dir, "../../src/scaffold/package.json"),
      "utf8",
    ),
  );
  expect(
    Object.keys({
      ...scaffold.dependencies,
      ...scaffold.devDependencies,
    }).filter((name) => name === "effect" || name.startsWith("@effect/")),
  ).toEqual([]);
});

test("UI types import browser contracts rather than server implementations", () => {
  for (const file of ["app.tsx", "canvas.tsx", "frame-node.tsx", "layout.ts"]) {
    expect(
      readFileSync(resolve(import.meta.dir, "../../src/ui", file), "utf8"),
    ).not.toContain("../server/");
  }
});
