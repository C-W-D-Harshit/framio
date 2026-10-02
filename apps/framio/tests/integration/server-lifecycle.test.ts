import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { FetchHttpClient } from "effect/http";
import { ServerRegistry, isAlive } from "../../src/services/server-registry";
import { projectPaths } from "../../src/lib/paths";

const cli = resolve(import.meta.dir, "../../src/cli.ts");
const projects: string[] = [];
const children: ReturnType<typeof Bun.spawn>[] = [];
function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "framio-lifecycle-")));
  mkdirSync(join(root, ".framio/pages"), { recursive: true });
  writeFileSync(join(root, ".framio/theme.css"), "");
  projects.push(root);
  return root;
}
function launch(root: string, args: string[]) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd: root,
    env: { ...process.env, HOME: join(root, "home") },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  return child;
}
async function run(root: string, args: string[]) {
  const child = launch(root, args);
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: out + err };
}
async function ready(root: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const info = await getRunningServer(projectPaths(root));
    if (info) return info;
    await Bun.sleep(50);
  }
  throw new Error(`Server never became ready for ${root}`);
}
async function gone(pid: number) {
  const deadline = Date.now() + 10_000;
  while (isAlive(pid) && Date.now() < deadline) await Bun.sleep(50);
  expect(isAlive(pid)).toBe(false);
}
afterEach(async () => {
  for (const root of projects) {
    const info = await getRunningServer(projectPaths(root));
    if (info) {
      process.kill(info.pid, "SIGTERM");
      await gone(info.pid);
    }
  }
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await child.exited;
  }
  for (const root of projects.splice(0))
    rmSync(root, { recursive: true, force: true });
});

for (const args of [
  ["start", "--no-open"],
  ["--no-open"],
  ["start", "--no-open", "--verbose"],
])
  test(`foreground ${args.join(" ")} stays attached and Ctrl+C stops its server`, async () => {
    const root = project();
    const child = launch(root, args);
    const info = await ready(root);
    expect(child.exitCode).toBeNull();
    child.kill("SIGINT");
    expect(await child.exited).toBe(0);
    const output = await new Response(child.stdout).text();
    expect(output).toContain(info.url);
    expect(output).toContain("Ctrl+C to stop");
    expect(output).toContain("Canvas stopped");
    if (args.includes("--verbose"))
      expect(output).toContain("frames, generation");
    else expect(output).not.toContain("INFO (#");
    await gone(info.pid);
    expect(await readServerInfo(projectPaths(root))).toBeNull();
    expect(existsSync(join(root, ".framio/.state/server.lock"))).toBe(false);
  }, 20_000);

test("an older healthy server cannot be borrowed but can still be stopped", async () => {
  const root = project();
  const state = join(root, ".framio/.state");
  mkdirSync(state, { recursive: true });
  const fixture = join(root, "old-server.ts");
  writeFileSync(
    fixture,
    `
    const root = ${JSON.stringify(root)};
    const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:() => Response.json({ok:true,root,pid:process.pid})});
    await Bun.write(${JSON.stringify(join(state, "server.json"))}, JSON.stringify({pid:process.pid,port:server.port,url:"http://127.0.0.1:"+server.port,startedAt:new Date().toISOString()}));
    process.on("SIGTERM", () => {server.stop(true);process.exit(0)});
  `,
  );
  const child = Bun.spawn([process.execPath, fixture], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  for (
    let attempt = 0;
    attempt < 100 && !existsSync(join(state, "server.json"));
    attempt++
  )
    await Bun.sleep(20);
  expect(existsSync(join(state, "server.json"))).toBe(true);
  const status = await run(root, ["status"]);
  expect(status.code).toBe(1);
  expect(status.output).toContain("older internal protocol");
  const stopped = await run(root, ["stop"]);
  expect(stopped.code).toBe(0);
  expect(await child.exited).toBe(0);
  await gone(child.pid);
}, 20_000);

test("concurrent background starts create one server, list it, and stop --all works outside a project", async () => {
  const root = project();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      run(root, ["start", "--background", "--no-open"]),
    ),
  );
  expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0]);
  expect(
    results.filter((r) => r.output.includes("running in the background")),
  ).toHaveLength(1);
  const info = await ready(root);
  const registry = join(root, "home/.framio/servers");
  const files = Array.from(new Bun.Glob("*.json").scanSync(registry));
  expect(files).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(registry, files[0]!), "utf8")).pid).toBe(
    info.pid,
  );
  expect((await run(root, ["list"])).output).toContain(
    `${info.pid}\t${info.url}\t${root}`,
  );
  const stop = Bun.spawn([process.execPath, cli, "stop", "--all"], {
    cwd: tmpdir(),
    env: { ...process.env, HOME: join(root, "home") },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await stop.exited).toBe(0);
  await gone(info.pid);
  expect((await run(root, ["list"])).output).toContain("No Framio servers");
}, 30_000);

test("screenshots clean up a temporary server on success and failure", async () => {
  const root = project();
  const success = await run(root, ["screenshot", "--all"]);
  expect(success.code).toBe(0);
  expect(await readServerInfo(projectPaths(root))).toBeNull();
  expect(existsSync(join(root, ".framio/.state/server.lock"))).toBe(false);
  const failure = await run(root, ["screenshot", "missing/frame"]);
  expect(failure.code).toBe(1);
  expect(failure.output).toContain("error");
  expect(await readServerInfo(projectPaths(root))).toBeNull();
  expect(existsSync(join(root, ".framio/.state/server.lock"))).toBe(false);
}, 30_000);

test("screenshots reuse an existing server without stopping it, and open does not launch one", async () => {
  const root = project();
  expect((await run(root, ["open"])).code).toBe(1);
  expect(await readServerInfo(projectPaths(root))).toBeNull();
  expect((await run(root, ["start", "--background", "--no-open"])).code).toBe(
    0,
  );
  const info = await ready(root);
  expect((await run(root, ["screenshot", "--all"])).code).toBe(0);
  expect((await ready(root)).pid).toBe(info.pid);
  expect((await run(root, ["stop"])).code).toBe(0);
  await gone(info.pid);
}, 20_000);

test("a crashed server's stale lock is recovered without duplicate launches", async () => {
  const root = project();
  expect((await run(root, ["start", "--background", "--no-open"])).code).toBe(
    0,
  );
  const crashed = await ready(root);
  process.kill(crashed.pid, "SIGKILL");
  await gone(crashed.pid);
  expect(existsSync(join(root, ".framio/.state/server.lock"))).toBe(true);
  const restarts = await Promise.all(
    Array.from({ length: 4 }, () =>
      run(root, ["start", "--background", "--no-open"]),
    ),
  );
  expect(restarts.map((r) => r.code)).toEqual([0, 0, 0, 0]);
  expect(
    restarts.filter((r) => r.output.includes("running in the background")),
  ).toHaveLength(1);
  expect((await ready(root)).pid).not.toBe(crashed.pid);
}, 20_000);

const RegistryLayer = ServerRegistry.layer.pipe(
  Layer.provide(Layer.merge(BunFileSystem.layer, FetchHttpClient.layer)),
);
function getRunningServer(p: ReturnType<typeof projectPaths>) {
  return Effect.runPromise(
    Effect.flatMap(ServerRegistry, (registry) => registry.running(p)).pipe(
      Effect.provide(RegistryLayer),
    ),
  );
}
function readServerInfo(p: ReturnType<typeof projectPaths>) {
  return Effect.runPromise(
    Effect.flatMap(ServerRegistry, (registry) => registry.read(p)).pipe(
      Effect.provide(RegistryLayer),
    ),
  );
}

test("browser launchers survive the short-lived open command scope", async () => {
  if (process.platform === "win32")
    throw new Error("This POSIX launcher fixture requires macOS or Linux");
  const root = project();
  expect((await run(root, ["start", "--background", "--no-open"])).code).toBe(
    0,
  );
  const bin = join(root, "bin");
  mkdirSync(bin);
  const opener = join(bin, process.platform === "darwin" ? "open" : "xdg-open");
  const marker = join(root, "opened");
  const release = join(root, "release-opener");
  const pidFile = join(root, "opener-pid");
  writeFileSync(
    opener,
    `#!${process.execPath}\nimport {existsSync,writeFileSync} from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nconst timer=setInterval(()=>{if(existsSync(${JSON.stringify(release)})){writeFileSync(${JSON.stringify(marker)},process.argv[2]);clearInterval(timer)}},20);`,
  );
  chmodSync(opener, 0o755);
  let openerPid: number | undefined;
  try {
    const child = Bun.spawn([process.execPath, cli, "open"], {
      cwd: root,
      env: {
        ...process.env,
        HOME: join(root, "home"),
        PATH: `${bin}:${process.env.PATH}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    children.push(child);
    expect(await child.exited).toBe(0);
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await Bun.sleep(20);
    expect(existsSync(pidFile)).toBe(true);
    openerPid = Number(readFileSync(pidFile, "utf8"));
    expect(isAlive(openerPid)).toBe(true);
    writeFileSync(release, "go");
    for (let i = 0; i < 100 && !existsSync(marker); i++) await Bun.sleep(20);
    expect(readFileSync(marker, "utf8")).toBe((await ready(root)).url);
    await gone(openerPid);
  } finally {
    if (openerPid && isAlive(openerPid)) process.kill(openerPid, "SIGKILL");
  }
}, 20_000);
