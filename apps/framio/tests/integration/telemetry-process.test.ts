import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../../src/cli.ts");
test("CLI and supervised server share identity, deliver anonymous batches and respect opt-out", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-telemetry-process-"));
  const batches: Array<{
    batch: Array<{
      event: string;
      uuid: string;
      distinct_id: string;
      properties: Record<string, unknown>;
    }>;
  }> = [];
  const receiver = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      batches.push(await request.json());
      return Response.json({ status: 1 });
    },
  });
  const reserve = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reserve.port!;
  reserve.stop(true);
  const env = {
    ...process.env,
    HOME: join(root, "home"),
    DO_NOT_TRACK: "0",
    FRAMIO_TELEMETRY: "1",
    FRAMIO_TELEMETRY_HOST: receiver.url.origin,
    FRAMIO_SERVER_PORT: String(port),
  };
  const run = async (args: string[], extra = {}) => {
    const child = Bun.spawn([process.execPath, cli, ...args], {
      cwd: root,
      env: { ...env, ...extra },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, output: stdout + stderr };
  };
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let output: Promise<string[]> | undefined;
  try {
    mkdirSync(join(root, ".framio/pages"), { recursive: true });
    writeFileSync(join(root, ".framio/theme.css"), "");
    const first = await run(["--version"]);
    expect(first.code).toBe(0);
    expect(first.output).toContain("anonymous usage");
    const second = await run(["--version"]);
    expect(second.output).not.toContain("anonymous usage");
    expect((await run(["invalid-private-project-name"])).code).toBe(1);
    server = Bun.spawn(
      [process.execPath, cli, "start", "--no-open", "--host", "127.0.0.1"],
      { cwd: root, env, stdout: "pipe", stderr: "pipe" },
    );
    output = Promise.all([
      new Response(server.stdout as ReadableStream).text(),
      new Response(server.stderr as ReadableStream).text(),
    ]);
    const deadline = Date.now() + 15000;
    let html = "";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`);
        if (response.ok) {
          html = await response.text();
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    expect(html).toContain('name="framio-telemetry"');
    const badSave = await fetch(`http://127.0.0.1:${port}/api/canvas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "missing-private-page", positions: {} }),
    });
    expect(badSave.status).toBe(404);
    while (
      !batches.some((b) => b.batch.some((e) => e.event === "server started")) &&
      Date.now() < deadline
    )
      await Bun.sleep(100);
    expect((await run(["stop"])).code).toBe(0);
    await server.exited;
    await output;
    const events = batches.flatMap((b) => b.batch);
    expect(events.filter((e) => e.event === "install")).toHaveLength(1);
    expect(
      events.some(
        (e) =>
          e.event === "cli command" &&
          e.properties.outcome === "failure" &&
          e.properties.command === "unknown",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.event === "server started" && e.properties.app === "server",
      ),
    ).toBe(true);
    expect(events.some((e) => e.event === "$exception")).toBe(true);
    expect(
      events.some(
        (e) =>
          e.event === "$exception" &&
          e.properties.app === "server" &&
          ["server_http", "server_request"].includes(
            String(e.properties.category),
          ),
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("missing-private-page");
    const identity = JSON.parse(
      readFileSync(join(root, "home/.framio/telemetry.json"), "utf8"),
    );
    expect(new Set(events.map((e) => e.distinct_id))).toEqual(
      new Set([identity.id]),
    );
    expect(new Set(events.map((e) => e.uuid)).size).toBe(events.length);
    expect(JSON.stringify(events)).not.toContain(root);
    expect(JSON.stringify(events)).not.toContain(
      "invalid-private-project-name",
    );
    const count = batches.length;
    expect((await run(["telemetry", "off"])).code).toBe(0);
    expect((await run(["--version"], { FRAMIO_TELEMETRY: "0" })).code).toBe(0);
    expect(batches.length).toBe(count);
  } finally {
    if (server?.exitCode === null) {
      await run(["stop"]);
      server.kill("SIGTERM");
      await server.exited;
    }
    receiver.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
