import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const skill = resolve(import.meta.dir, "../../src/scaffold/skill");
const workspace = resolve(import.meta.dir, "../../../..");

function files(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(prefix, entry.name);
      return entry.isDirectory() ? files(root, path) : [path];
    },
  );
}

test("both installed agent skills ship the complete canonical guidance", () => {
  const expected = files(skill).sort();
  for (const directory of [".agents/skills/framio", ".claude/skills/framio"]) {
    const installed = join(workspace, directory);
    expect(files(installed).sort()).toEqual(expected);
    for (const path of expected) {
      expect(readFileSync(join(installed, path))).toEqual(
        readFileSync(join(skill, path)),
      );
    }
  }
});

test("local guidance links resolve in the generated skill", () => {
  const available = new Set(files(skill).map((path) => resolve(skill, path)));
  for (const path of files(skill).filter((path) => path.endsWith(".md"))) {
    const content = readFileSync(join(skill, path), "utf8");
    expect(content).not.toContain("\u2014");
    for (const match of content.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)) {
      const target = match[1]!;
      if (/^https?:\/\//.test(target)) continue;
      expect(available.has(resolve(skill, dirname(path), target))).toBe(true);
    }
  }
});

test("default workflow command recipes do not fetch external skills", () => {
  for (const path of ["SKILL.md", "references/process.md"]) {
    const content = readFileSync(join(skill, path), "utf8");
    const recipes = Array.from(
      content.matchAll(/```(?:sh|bash)[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g),
      (match) => match[1] ?? match[2]!,
    );
    for (const recipe of recipes) {
      expect(recipe).not.toMatch(
        /(?:npx|bunx)\s+(?:-\S+\s+)*(?:ui-skills\s+get|skills\s+use)\b/,
      );
    }
  }
});
