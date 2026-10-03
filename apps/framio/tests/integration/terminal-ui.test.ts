import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

const cli = resolve(import.meta.dir, "../../src/cli.ts");
const installer = resolve(import.meta.dir, "../../../../install.sh");
const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "framio-terminal-")));
  roots.push(root);
  mkdirSync(join(root, "home"));
  return root;
}
async function run(
  root: string,
  args: string[],
  extraEnv: Record<string, string> = {},
) {
  const child = Bun.spawn(args, {
    cwd: root,
    env: { ...process.env, HOME: join(root, "home"), CI: "true", ...extraEnv },
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
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("setup explains skipped dependencies and package output is quiet unless requested", async () => {
  const root = fixture();
  const init = await run(root, [
    process.execPath,
    cli,
    "init",
    "--skip-install",
  ]);
  expect(init.code).toBe(0);
  expect(init.stdout).toContain("Canvas files");
  expect(init.stdout).toContain("Agent skills");
  expect(init.stdout).toContain("Package installation was skipped");
  expect(init.stdout).toContain("framio install");
  expect(init.stdout).not.toContain("\x1b");
  for (const owner of [".agents", ".claude"]) {
    expect(readdirSync(join(root, owner, "skills")).sort()).toEqual(["framio"]);
    const shipped = join(root, owner, "skills/framio/references");
    expect(readdirSync(shipped).sort()).toEqual([
      "comments.md",
      "copy.md",
      "design-md.md",
      "evidence.md",
      "handoff.md",
      "process.md",
    ]);
  }
  expect(
    JSON.parse(readFileSync(join(root, ".framio/components.json"), "utf8"))
      .registries,
  ).toEqual({
    "@rareui": "https://rareui.com/r/{name}.json",
  });
  expect(
    JSON.parse(readFileSync(join(root, ".framio/evidence.json"), "utf8")),
  ).toEqual({ version: 1, reviews: [] });
  const help = await run(root, [process.execPath, cli, "--help"]);
  expect(help.code).toBe(0);
  expect(help.output).not.toMatch(/references/);
  const removed = await run(root, [process.execPath, cli, "references"]);
  expect(removed.code).not.toBe(0);
  writeFileSync(
    join(root, ".framio/package.json"),
    '{"name":"terminal-fixture","private":true}',
  );
  const install = await run(root, [process.execPath, cli, "install"]);
  expect(install.code).toBe(0);
  expect(install.stdout).toContain("Packages ready");
  expect(install.output).not.toContain("bun install v");
  const verbose = await run(root, [
    process.execPath,
    cli,
    "install",
    "--verbose",
  ]);
  expect(verbose.code).toBe(0);
  expect(verbose.output).toContain("bun install v");
  expect(verbose.output).not.toContain("\x1b[?25");
  const repeat = await run(root, [
    process.execPath,
    cli,
    "init",
    "--skip-install",
  ]);
  expect(repeat.code).toBe(1);
  expect(repeat.stderr).toContain("error: .framio already exists");
}, 20_000);

test("package failures keep diagnostics and an actionable retry", async () => {
  const root = fixture();
  mkdirSync(join(root, ".framio"));
  writeFileSync(join(root, ".framio/package.json"), "{invalid");
  const result = await run(root, [process.execPath, cli, "install"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("Packages  Failed");
  expect(result.stderr).toContain("package.json");
  expect(result.stderr).toContain("framio install --verbose");
  expect(result.output).not.toContain("Packages ready");
  expect(result.output).not.toContain("\x1b");
});

test("a failed optional browser download leaves a usable canvas with an explicit warning", async () => {
  const root = fixture();
  mkdirSync(join(root, "home/.framio"));
  writeFileSync(
    join(root, "home/.framio/browsers"),
    "a file blocks the browser cache",
  );
  const runner = join(root, "setup.ts");
  writeFileSync(
    runner,
    `
    import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
    import * as BunServices from ${JSON.stringify(import.meta.resolve("@effect/platform-bun/BunServices"))};
    import * as BunRuntime from ${JSON.stringify(import.meta.resolve("@effect/platform-bun/BunRuntime"))};
    import { ChildProcess, ChildProcessSpawner } from ${JSON.stringify(import.meta.resolve("effect/process"))};
    import { init } from ${JSON.stringify(resolve(import.meta.dir, "../../src/commands/init.ts"))};
    import { TerminalUI } from ${JSON.stringify(resolve(import.meta.dir, "../../src/services/terminal-ui.ts"))};
    Effect.scoped(Effect.gen(function* () {
      const native = yield* ChildProcessSpawner.ChildProcessSpawner;
      const packageFixture = ChildProcessSpawner.ChildProcessSpawner.of({
        ...native,
        spawn: () => native.spawn(ChildProcess.make(process.execPath, ["-e", "process.exit(0)"])),
      });
      yield* init(false).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, packageFixture));
    })).pipe(Effect.provide(BunServices.layer), Effect.provide(TerminalUI.layer("test")), BunRuntime.runMain);
  `,
  );
  const result = await run(root, [process.execPath, runner]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Packages  Installed");
  expect(result.stdout).toContain("Screenshot browser  Unavailable");
  expect(result.stderr).toContain("Canvas ready. Screenshots unavailable");
  expect(result.stderr).toContain("retry on your first screenshot");
  expect(result.stdout).not.toContain("Your canvas is ready");
  expect(result.stdout).toContain("framio start");
  expect(existsSync(join(root, ".framio/package.json"))).toBe(true);
}, 60_000);

test("registry commands suppress successful upstream logs and retain failure details", async () => {
  const root = fixture();
  mkdirSync(join(root, ".framio"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const npx = join(bin, "npx");
  writeFileSync(
    npx,
    `#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const request = JSON.parse(process.argv.at(-1));
console.log("upstream registry output");
if (process.env.FRAMIO_FIXTURE_EXIT === "1") process.exit(1);
const path = "button.tsx";
const before = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
writeFileSync(path, "export const Button = () => null;\\n");
const after = createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(request.receipt, JSON.stringify({ completed: true, error: null, files: [{ path, before, after, issue: null, preserve: true }] }));
`,
  );
  chmodSync(npx, 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const success = await run(
    root,
    [process.execPath, cli, "add", "button"],
    env,
  );
  expect(success.code).toBe(0);
  expect(success.stdout).toContain(
    "Components: 1 installed, 0 skipped, 0 failed.",
  );
  expect(success.output).not.toContain("upstream registry output");
  const verbose = await run(
    root,
    [process.execPath, cli, "add", "button", "--verbose"],
    env,
  );
  expect(verbose.code).toBe(0);
  expect(verbose.output).toContain("upstream registry output");
  const failure = await run(root, [process.execPath, cli, "add", "button"], {
    ...env,
    FRAMIO_FIXTURE_EXIT: "1",
  });
  expect(failure.code).toBe(1);
  expect(failure.stderr).toContain("upstream registry output");
  expect(failure.stderr).toContain("framio add button --verbose");
  expect(failure.output).not.toContain("Components ready");
}, 20_000);

function release(root: string, executable: string) {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const name = `framio-${os}-${arch}`;
  const source = join(root, "release");
  mkdirSync(source);
  writeFileSync(join(source, name), executable);
  chmodSync(join(source, name), 0o755);
  const archive = Bun.spawnSync([
    "tar",
    "-czf",
    join(root, `${name}.tar.gz`),
    "-C",
    source,
    name,
  ]);
  expect(archive.exitCode).toBe(0);
  return {
    FRAMIO_DOWNLOAD_URL: new URL(`file://${root}`).href,
    FRAMIO_INSTALL: join(root, "home/.framio"),
    SHELL: "/bin/zsh",
  };
}

test("the POSIX installer handles spaces, preserves shell content and configures PATH once", async () => {
  const root = fixture();
  const directory = join(root, "a project");
  mkdirSync(directory);
  const env = release(directory, '#!/bin/sh\nprintf "0.0.7\\n"\n');
  env.FRAMIO_INSTALL = join(root, "home/a directory/bin-root");
  const rc = join(root, "home/.zshrc");
  const original = `# Existing shell configuration\n# ${env.FRAMIO_INSTALL}/bin\nprintf '%s\\n' '${env.FRAMIO_INSTALL}/bin'\n`;
  writeFileSync(rc, original);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await run(root, ["sh", installer], {
      ...env,
      NO_COLOR: "",
      TERM: "dumb",
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Platform");
    expect(result.stdout).toContain("Download  Complete");
    expect(result.stdout).toContain("Install   0.0.7");
    expect(result.stdout).toContain(
      attempt === 0 ? "Shell     Updated" : "PATH already configured",
    );
    expect(result.stdout).toContain("Installed successfully");
    expect(result.stdout).toContain("framio init");
    expect(result.output).not.toContain("\x1b");
    expect(existsSync(join(env.FRAMIO_INSTALL, "bin/framio"))).toBe(true);
  }
  const contents = readFileSync(rc, "utf8");
  expect(contents.startsWith(original)).toBe(true);
  expect(contents.match(/# framio/g)).toHaveLength(1);
  expect(
    contents.split("\n").filter((line) => line.startsWith("export PATH=")),
  ).toHaveLength(1);
});

test("a broken downloaded executable cannot replace an existing installation", async () => {
  const root = fixture();
  const env = release(root, "#!/bin/sh\nexit 42\n");
  const target = join(env.FRAMIO_INSTALL, "bin/framio");
  mkdirSync(join(env.FRAMIO_INSTALL, "bin"), { recursive: true });
  writeFileSync(target, "existing executable");
  const result = await run(root, ["sh", installer], env);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("could not run on this machine");
  expect(result.stdout).not.toContain("Installed successfully");
  expect(readFileSync(target, "utf8")).toBe("existing executable");
  expect(existsSync(join(root, "home/.zshrc"))).toBe(false);
}, 20_000);

test("a real narrow PTY renders an ASCII mark and restores the cursor", async () => {
  const root = fixture();
  const script = `
import errno, fcntl, json, os, pty, select, struct, subprocess, sys, termios, time
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 60, 0, 0))
env = dict(os.environ, TERM='xterm-256color', LANG='en_US.UTF-8')
env.pop('CI', None)
env.pop('NO_COLOR', None)
child = subprocess.Popen([sys.argv[1], sys.argv[2], 'init', '--skip-install'], stdin=slave, stdout=slave, stderr=slave, env=env)
os.close(slave)
output = bytearray()
deadline = time.monotonic() + 15
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(master, 65536)
                if not chunk: break
                output.extend(chunk)
            except OSError as error:
                if error.errno == errno.EIO: break
                raise
        elif child.poll() is not None: break
    print(json.dumps({'code': child.wait(timeout=2), 'output': output.decode()}))
finally:
    if child.poll() is None: child.kill(); child.wait()
    os.close(master)
`;
  const result = await run(root, [
    "python3",
    "-c",
    script,
    process.execPath,
    cli,
  ]);
  expect(result.code).toBe(0);
  const terminal = JSON.parse(result.stdout) as {
    code: number;
    output: string;
  };
  expect(terminal.code).toBe(0);
  expect(terminal.output).toContain("+--- []");
  expect(terminal.output).toContain("\x1b[?25l");
  expect(terminal.output).toContain("\x1b[?25h");
  expect(terminal.output.lastIndexOf("\x1b[?25h")).toBeGreaterThan(
    terminal.output.lastIndexOf("\x1b[?25l"),
  );
  for (const line of stripVTControlCharacters(terminal.output)
    .split(/\r?\n/)
    .filter((line) => /Canvas files/.test(line)))
    expect(Bun.stringWidth(line)).toBeLessThan(60);
}, 20_000);
