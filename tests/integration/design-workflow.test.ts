import { BunFileSystem } from "@effect/platform-bun";
import { Effect } from "effect";
import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectPaths } from "../../src/lib/paths";
import { readDesignCss as readDesignCssEffect } from "../../src/server/design-md";
import { imageSize } from "../../src/server/image-size";
import { scanProject as scanProjectEffect } from "../../src/server/project";
import { buildThemeCss as buildThemeCssEffect } from "../../src/server/tailwind";
import { layoutFrames } from "../../src/ui/layout";

const scanProject = (p: Parameters<typeof scanProjectEffect>[0]) =>
  Effect.runPromise(
    scanProjectEffect(p).pipe(Effect.provide(BunFileSystem.layer)),
  );
const readDesignCss = (p: string, theme: string) =>
  Effect.runPromise(
    readDesignCssEffect(p, theme).pipe(Effect.provide(BunFileSystem.layer)),
  );
const buildThemeCss = (p: Parameters<typeof buildThemeCssEffect>[0]) =>
  Effect.runPromise(
    buildThemeCssEffect(p).pipe(Effect.provide(BunFileSystem.layer)),
  );
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function project() {
  const root = mkdtempSync(join(tmpdir(), "framio-test-"));
  dirs.push(root);
  const p = projectPaths(root);
  mkdirSync(join(p.pages, "01-moodboard"), { recursive: true });
  return p;
}
function design(p: ReturnType<typeof project>, yaml: string) {
  writeFileSync(p.designMd, `---\n${yaml}\n---\n`);
}
const svg = (attrs: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`,
  );

function portraitWebp(chunk: "VP8 " | "VP8L" | "VP8X") {
  const buf = new Uint8Array(30);
  const view = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode("RIFF"));
  buf.set(new TextEncoder().encode(`WEBP${chunk}`), 8);
  if (chunk === "VP8 ") {
    view.setUint16(26, 390, true);
    view.setUint16(28, 844, true);
  } else if (chunk === "VP8L") {
    view.setUint32(21, 389 | (843 << 14), true);
  } else {
    view.setUint16(24, 389, true);
    view.setUint16(27, 843, true);
  }
  return buf;
}

test("raster dimensions follow file signatures rather than filename extensions", async () => {
  for (const chunk of ["VP8 ", "VP8L", "VP8X"] as const) {
    for (const ext of ["png", "jpg", "webp"]) {
      expect(imageSize(portraitWebp(chunk), ext)).toEqual({
        width: 390,
        height: 844,
      });
    }
  }
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 390);
  view.setUint32(20, 844);
  expect(imageSize(png, "webp")).toEqual({ width: 390, height: 844 });
});

test("WebP references saved as PNG keep portrait proportions and width overrides", async () => {
  const p = project();
  const file = join(p.pages, "01-moodboard", "mobile.png");
  writeFileSync(file, portraitWebp("VP8 "));
  expect((await scanProject(p))[0]!.frames[0]!.meta).toMatchObject({
    width: 390,
    height: 844,
  });
  writeFileSync(`${file}.json`, JSON.stringify({ width: 195 }));
  expect((await scanProject(p))[0]!.frames[0]!.meta).toMatchObject({
    width: 195,
    height: 422,
  });
});

test("image dimensions read a viewBox with decimals and preserve its aspect ratio", async () => {
  expect(imageSize(svg('viewBox="-10 -20 390.5 844"'), "svg")).toEqual({
    width: 390.5,
    height: 844,
  });
  expect(
    imageSize(svg('width="100%" height="100%" viewBox="0,0,4e2,2e2"'), "svg"),
  ).toEqual({ width: 400, height: 200 });
  expect(imageSize(svg('width="0" height="0"'), "svg")).toBeNull();
  expect(imageSize(new Uint8Array(4), "png")).toBeNull();
});

test("bad image sidecars report errors without losing frames or their dimensions", async () => {
  const p = project();
  const file = join(p.pages, "01-moodboard", "reference.svg");
  writeFileSync(file, svg('viewBox="0 0 800 400"'));
  for (const sidecar of [
    "null",
    "[]",
    '{"name":42,"width":-100,"note":{},"variationOf":7}',
  ]) {
    writeFileSync(`${file}.json`, sidecar);
    const frame = (await scanProject(p))[0]!.frames[0]!;
    expect(frame.metaError).toContain("reference.svg.json");
    expect(frame.meta).toMatchObject({
      name: "reference",
      width: 800,
      height: 400,
    });
    expect(frame.note).toBeUndefined();
  }
});

test("image width overrides keep aspect ratio and moodboards form a grid", async () => {
  const p = project();
  for (let i = 0; i < 5; i++) {
    const file = join(p.pages, "01-moodboard", `ref-${i}.svg`);
    writeFileSync(file, svg('viewBox="0 0 3200 1600"'));
    writeFileSync(
      `${file}.json`,
      JSON.stringify({
        name: `Reference ${i}`,
        width: 600,
        note: "Borrow the hierarchy",
      }),
    );
  }
  const frames = (await scanProject(p))[0]!.frames.map((f) => ({
    ...f,
    version: 1,
    error: null,
  }));
  expect(
    frames.every(
      (f) =>
        f.kind === "image" && f.meta.width === 600 && f.meta.height === 300,
    ),
  ).toBe(true);
  const positions = layoutFrames(frames, {}, { "ref-0.svg": { x: 80, y: 90 } });
  expect(positions[frames[0]!.id]).toEqual({ x: 80, y: 90 });
  expect(positions[frames[1]!.id]!.y).toBe(positions[frames[2]!.id]!.y);
  expect(positions[frames[1]!.id]!.x).toBeLessThan(positions[frames[2]!.id]!.x);
  expect(positions[frames[3]!.id]!.y).toBeGreaterThan(
    positions[frames[1]!.id]!.y,
  );
});

test("DESIGN.md tokens override the base theme and generate working Tailwind utilities", async () => {
  const p = project();
  writeFileSync(
    p.theme,
    '@import "tailwindcss";\n:root { --primary: #000; }\n@theme inline { --color-primary: var(--primary); --radius-lg: 1rem; }',
  );
  // Resolve Tailwind from this repository while the rest of the fixture is isolated.
  symlinkSync(
    join(import.meta.dir, "../../node_modules"),
    join(p.framio, "node_modules"),
  );
  writeFileSync(
    join(p.pages, "01-moodboard", "tile.tsx"),
    '<div className="bg-primary bg-brand type-display rounded-lg font-sans font-heading" />',
  );
  design(
    p,
    'colors:\n  primary: "#B8422E"\n  primary-dark: "#E0694F"\n  brand: "{colors.primary}"\nrounded:\n  lg: 14px\ntypography:\n  display:\n    fontFamily: Fraunces\n    fontSize: 56px\n    fontWeight: 600\n  body-md:\n    fontFamily: Public Sans\n    fontSize: 15px',
  );
  const result = await buildThemeCss(p);
  expect(result.error).toBeNull();
  expect(result.css).toContain("--primary: #B8422E");
  expect(result.css).toContain("--primary: #E0694F");
  expect(result.css).toContain(".bg-brand");
  expect(result.css).toContain(".type-display");
  expect(result.css).toContain("font-size: 56px");
  expect(result.css).toContain("border-radius: 14px");
  expect(result.css).toContain('font-family: "Public Sans"');
});

test("invalid DESIGN.md tokens are rejected and the base theme survives", async () => {
  const p = project();
  writeFileSync(p.theme, ":root { --primary: #123456; }");
  for (const yaml of [
    "colors: [red, blue]",
    "colors:\n  primary: { value: red }",
    'rounded:\n  lg: "{rounded.md}"\n  md: "{rounded.lg}"',
    'colors:\n  primary: "{colors.primary}"',
    'colors:\n  primary: "{colors.missing}"',
    'typography:\n  body-md:\n    fontFamily: system-ui\n    fontSize: "calc("',
    "colors: [",
  ]) {
    design(p, yaml);
    const result = await buildThemeCss(p);
    expect(result.error).toStartWith("DESIGN.md");
    expect(result.css).toContain("#123456");
    expect(result.css).not.toContain("[object Object]");
  }
});

test("system fonts do not fetch Google Fonts", async () => {
  const p = project();
  design(
    p,
    "typography:\n  body-md:\n    fontFamily: system-ui\n    fontSize: 16px",
  );
  expect((await readDesignCss(p.designMd, ""))!.imports).toBe("");
});

test("font imports include weights not already loaded by the base theme", async () => {
  const p = project();
  design(
    p,
    "typography:\n  body-md:\n    fontFamily: Inter\n    fontWeight: 900",
  );
  expect(
    (await readDesignCss(
      p.designMd,
      '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap");',
    ))!.imports,
  ).toContain("Inter:wght@900");
});

test("dark aliases use the CSS variable that exists in the dark theme", async () => {
  const p = project();
  design(
    p,
    'colors:\n  background: "#FFFFFF"\n  background-dark: "#111111"\n  primary-dark: "{colors.background-dark}"',
  );
  const css = (await readDesignCss(p.designMd, ""))!.rules;
  expect(css).toContain("--primary: var(--background)");
  expect(css).not.toContain("var(--background-dark)");
});

test("metadata is literal data and never executes calls or getters", async () => {
  const p = project();
  const file = join(p.pages, "01-moodboard", "safe.tsx");
  writeFileSync(
    file,
    'export const meta = { name: `Literal`, width: "390", height: 844, theme: "dark" } as const;',
  );
  expect((await scanProject(p))[0]!.frames[0]!.meta).toEqual({
    name: "Literal",
    width: 390,
    height: 844,
    theme: "dark",
  });
  for (const source of [
    'export const meta = { get name() { throw new Error("executed"); }, width:390 };',
    'export const meta = { name: (() => { throw new Error("executed"); })() };',
  ]) {
    writeFileSync(file, source);
    const frame = (await scanProject(p))[0]!.frames[0]!;
    expect(frame.metaError?.includes("literal")).toBe(true);
    expect(frame.metaError?.includes("executed")).toBe(false);
  }
});
