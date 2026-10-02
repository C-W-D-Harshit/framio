import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cli = resolve(import.meta.dir, "../../src/cli.ts");
const shadcn = fileURLToPath(import.meta.resolve("shadcn"));
const roots: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const custom = (name: string) => `export const custom = "${name}";\n`;
const upstream = (name: string) => `export const upstream = "${name}";\n`;

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "framio-registry-")));
  roots.push(root);
  const directory = join(root, ".framio");
  mkdirSync(join(directory, "components/ui"), { recursive: true });
  mkdirSync(join(root, "home"));
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "registry-fixture",
      private: true,
      devDependencies: { tailwindcss: "4.3.3" },
    }),
  );
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    }),
  );
  writeFileSync(
    join(directory, "components.json"),
    JSON.stringify({
      style: "base-vega",
      rsc: false,
      tsx: true,
      tailwind: {
        config: "",
        css: "theme.css",
        baseColor: "neutral",
        cssVariables: true,
      },
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
        ui: "@/components/ui",
        lib: "@/lib",
        hooks: "@/hooks",
      },
    }),
  );
  writeFileSync(join(directory, "theme.css"), '@import "tailwindcss";\n');
  symlinkSync(shadcn, join(root, "bin/shadcn"));
  writeFileSync(join(root, "bin/npx"), '#!/bin/sh\nshift 3\nexec "$@"\n');
  chmodSync(join(root, "bin/npx"), 0o755);
  return { root, directory };
}

function registry(items: Record<string, Record<string, unknown>>) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const name = new URL(request.url).pathname
        .slice(1)
        .replace(/\.json$/, "");
      const item = items[name];
      return item
        ? Response.json({ name, type: "registry:block", ...item })
        : new Response("Unknown registry item", { status: 404 });
    },
  });
  servers.push(server);
  return server.url.href;
}

function file(
  name: string,
  target = `@ui/${name}.tsx`,
  type = "registry:component",
) {
  return { path: `${name}.tsx`, type, target, content: upstream(name) };
}

async function add(root: string, items: string[], flags: string[] = []) {
  const command = process.env.FRAMIO_TEST_BINARY
    ? [process.env.FRAMIO_TEST_BINARY]
    : [process.execPath, cli];
  const child = Bun.spawn([...command, "add", ...items, ...flags], {
    cwd: root,
    env: {
      ...process.env,
      HOME: join(root, "home"),
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      CI: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr, output: stdout + stderr };
}

function fakeInstaller(root: string, body: string) {
  const executable = join(root, "bin/npx");
  writeFileSync(
    executable,
    `#!/usr/bin/env node\nconst { writeFileSync } = require("node:fs");\nconst { createHash } = require("node:crypto");\nconst request = JSON.parse(process.argv.at(-1));\n${body}\n`,
  );
  chmodSync(executable, 0o755);
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("two customized dependencies stay intact while the parent installs and repeat installs skip", async () => {
  const { root, directory } = fixture();
  for (const name of ["button", "input"])
    writeFileSync(join(directory, `components/ui/${name}.tsx`), custom(name));
  const items: Record<string, Record<string, unknown>> = {
    hero: { files: [file("hero", "@components/hero.tsx")] },
    button: { files: [file("button")] },
    input: { files: [file("input")] },
  };
  const url = registry(items);
  items.hero!.registryDependencies = [`${url}button.json`, `${url}input.json`];
  const first = await add(root, [`${url}hero.json`]);
  expect(first.code).toBe(0);
  expect(first.stdout).toContain(
    "Components: 1 installed, 2 skipped, 0 failed.",
  );
  expect(
    readFileSync(join(directory, "components/hero.tsx"), "utf8"),
  ).toContain('"hero"');
  for (const name of ["button", "input"])
    expect(
      readFileSync(join(directory, `components/ui/${name}.tsx`), "utf8"),
    ).toBe(custom(name));
  const repeat = await add(root, [`${url}hero.json`]);
  expect(repeat.code).toBe(0);
  expect(repeat.stdout).toContain(
    "Components: 0 installed, 3 skipped, 0 failed.",
  );
  for (const name of ["button", "input"])
    expect(
      readFileSync(join(directory, `components/ui/${name}.tsx`), "utf8"),
    ).toBe(custom(name));
}, 30_000);

test("explicit overwrite replaces customized source and reports the update", async () => {
  const { root, directory } = fixture();
  writeFileSync(join(directory, "components/ui/button.tsx"), custom("button"));
  const url = registry({ button: { files: [file("button")] } });
  const result = await add(root, [`${url}button.json`], ["--overwrite"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(
    "Installed: components/ui/button.tsx. Existing file updated.",
  );
  expect(
    readFileSync(join(directory, "components/ui/button.tsx"), "utf8"),
  ).toContain("upstream");
}, 15_000);

test("registry pages retain source under app for adaptation into a frame", async () => {
  const { root, directory } = fixture();
  const url = registry({
    page: {
      type: "registry:page",
      files: [file("page", "app/page.tsx", "registry:page")],
    },
  });
  const result = await add(root, [`${url}page.json`]);
  expect(result).toMatchObject({ code: 0 });
  expect(result.stdout).toContain("Installed: app/page.tsx.");
  expect(readFileSync(join(directory, "app/page.tsx"), "utf8")).toContain(
    "upstream",
  );
}, 15_000);

test("styles and environment changes receive verified file receipts", async () => {
  const { root, directory } = fixture();
  const url = registry({
    theme: {
      type: "registry:theme",
      cssVars: { light: { background: "red" } },
      envVars: { REGISTRY_FIXTURE: "enabled" },
    },
  });
  const result = await add(root, [`${url}theme.json`]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Installed: theme.css.");
  expect(result.stdout).toContain("Installed: .env.local.");
  expect(readFileSync(join(directory, "theme.css"), "utf8")).toContain("red");
  expect(readFileSync(join(directory, ".env.local"), "utf8")).toBe(
    "REGISTRY_FIXTURE=enabled\n",
  );
}, 15_000);

test("unknown registry items and invalid config cannot report verified success", async () => {
  const { root, directory } = fixture();
  const url = registry({});
  const unknown = await add(root, [`${url}missing.json`]);
  expect(unknown.code).toBe(1);
  expect(unknown.output).not.toContain("Components: ");
  writeFileSync(join(directory, "components.json"), "{invalid");
  const invalid = await add(root, [`${url}missing.json`]);
  expect(invalid.code).toBe(1);
  expect(invalid.output).not.toContain("Components: ");
}, 15_000);

test("configured CSS outside .framio is refused before any source or CSS write", async () => {
  const { root, directory } = fixture();
  const config = JSON.parse(
    readFileSync(join(directory, "components.json"), "utf8"),
  );
  config.tailwind.css = "../outside.css";
  writeFileSync(join(directory, "components.json"), JSON.stringify(config));
  writeFileSync(join(root, "outside.css"), "original outside styles\n");
  const url = registry({
    hero: {
      files: [file("hero", "@components/hero.tsx")],
      cssVars: { light: { background: "red" } },
    },
  });
  const result = await add(root, [`${url}hero.json`]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Registry destination is outside .framio");
  expect(readFileSync(join(root, "outside.css"), "utf8")).toBe(
    "original outside styles\n",
  );
  expect(existsSync(join(directory, "components/hero.tsx"))).toBe(false);
}, 15_000);

test("existing links cannot direct CSS, environment, or component writes outside .framio", async () => {
  for (const target of [
    "theme.css",
    ".env.local",
    "components/ui/button.tsx",
  ]) {
    const { root, directory } = fixture();
    writeFileSync(join(root, "outside"), "original outside content\n");
    rmSync(join(directory, target), { force: true });
    symlinkSync(join(root, "outside"), join(directory, target));
    const url = registry({
      button: {
        files: [file("button")],
        envVars: { REGISTRY_FIXTURE: "enabled" },
        cssVars: { light: { background: "red" } },
      },
    });
    const result = await add(root, [`${url}button.json`], ["--overwrite"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Registry destination follows a link outside .framio",
    );
    expect(readFileSync(join(root, "outside"), "utf8")).toBe(
      "original outside content\n",
    );
  }
}, 30_000);

test("a zero exit without a completion receipt is a failed install", async () => {
  const { root } = fixture();
  fakeInstaller(root, "console.log('upstream incomplete');");
  const result = await add(root, ["button"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("without a completion receipt");
  expect(result.stderr).toContain("upstream incomplete");
  expect(result.output).not.toContain("Components: ");
});

test("missing outputs and mismatched hashes cannot pass receipt verification", async () => {
  for (const createFile of [false, true]) {
    const { root } = fixture();
    fakeInstaller(
      root,
      `${createFile ? 'writeFileSync("components/ui/button.tsx", "different bytes");' : ""}
      writeFileSync(request.receipt, JSON.stringify({ completed: true, error: null, files: [{ path: "components/ui/button.tsx", before: null, after: "claimed digest", preserve: true, issue: null }] }));`,
    );
    const result = await add(root, ["button"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "File does not match the installer receipt",
    );
    expect(result.output).not.toContain("Components: ");
  }
});

test("partial failure reports created files and expected missing outputs honestly", async () => {
  const { root } = fixture();
  fakeInstaller(
    root,
    `
    const content = "partial installed source";
    writeFileSync("components/ui/button.tsx", content);
    writeFileSync(request.receipt, JSON.stringify({ completed: false, error: "Fixture failed after first write", files: [
      { path: "components/ui/button.tsx", before: null, after: createHash("sha256").update(content).digest("hex"), preserve: true, issue: null },
      { path: "components/ui/input.tsx", before: null, after: null, preserve: true, issue: null }
    ] }));
    process.exitCode = 1;
  `,
  );
  const result = await add(root, ["hero"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("Installed: components/ui/button.tsx.");
  expect(result.stderr).toContain(
    "Failed: components/ui/input.tsx. Expected file was not installed.",
  );
  expect(result.stderr).toContain("1 installed, 0 skipped, 1 failed");
  expect(result.stderr).toContain("Fixture failed after first write");
  expect(result.output).not.toContain("Components: ");
}, 15_000);

test("a native CSS failure retains the receipt for source files already created", async () => {
  const { root, directory } = fixture();
  writeFileSync(
    join(directory, "theme.css"),
    '@import "tailwindcss";\n.invalid {\n',
  );
  const url = registry({
    partial: {
      files: [file("button")],
      cssVars: { light: { background: "red" } },
    },
  });
  const result = await add(root, [`${url}partial.json`]);
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("Installed: components/ui/button.tsx.");
  expect(result.stderr).toContain("1 installed, 0 skipped, 0 failed");
  expect(
    readFileSync(join(directory, "components/ui/button.tsx"), "utf8"),
  ).toContain("upstream");
  expect(result.output).not.toContain("Components: ");
}, 15_000);

test("receipt verification refuses outside paths and linked outputs", async () => {
  for (const linked of [false, true]) {
    const { root, directory } = fixture();
    const content = "outside content";
    writeFileSync(join(root, "outside"), content);
    if (linked)
      symlinkSync(
        join(root, "outside"),
        join(directory, "components/ui/button.tsx"),
      );
    fakeInstaller(
      root,
      `writeFileSync(request.receipt, JSON.stringify({ completed: true, error: null, files: [{ path: ${JSON.stringify(linked ? "components/ui/button.tsx" : "../outside")}, before: null, after: createHash("sha256").update(${JSON.stringify(content)}).digest("hex"), preserve: true, issue: null }] }));`,
    );
    const result = await add(root, ["button"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      linked
        ? "Receipt destination follows a link outside .framio."
        : "Receipt destination is outside .framio.",
    );
    expect(readFileSync(join(root, "outside"), "utf8")).toBe(content);
  }
});
