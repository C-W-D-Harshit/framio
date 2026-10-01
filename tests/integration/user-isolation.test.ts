import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import baseline from "../../docs/effect-v4-baseline.json";

test("user code stays byte-identical and contains no Effect dependency", () => {
  const updatedSkillFiles = new Set([
    "src/scaffold/skill/SKILL.md",
    "src/scaffold/skill/references/process.md",
    "src/scaffold/skill/references/skills.md",
  ]);
  for (const [file, hash] of Object.entries(baseline.scaffold)) {
    if (updatedSkillFiles.has(file)) continue;
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
