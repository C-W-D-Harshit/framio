import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { GLOBAL_DIR, projectPaths, type ProjectPaths } from "./paths";

export type ServerInfo = { pid: number; port: number; url: string; startedAt: string };
export type RegisteredServer = ServerInfo & { root: string };
const registry = join(GLOBAL_DIR, "servers");
const registryFile = (root: string) => join(registry, `${createHash("sha256").update(root).digest("hex")}.json`);

export function readServerInfo(p: ProjectPaths): ServerInfo | null {
  try {
    const info = JSON.parse(readFileSync(p.serverFile, "utf8"));
    return Number.isInteger(info.pid) && info.pid > 0 && typeof info.url === "string" ? info : null;
  } catch { return null; }
}

export function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
}

async function isHealthy(info: ServerInfo, root: string) {
  try {
    const res = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json()) as { root?: string; pid?: number };
    return res.ok && body.root === root && body.pid === info.pid;
  } catch { return false; }
}

export async function getRunningServer(p: ProjectPaths): Promise<ServerInfo | null> {
  const info = readServerInfo(p);
  if (!info) return null;
  if (isAlive(info.pid)) return await isHealthy(info, p.root) ? info : null;
  rmSync(p.serverFile, { force: true });
  return null;
}

/** A process holds this exclusive lock throughout startup and serving. */
export function acquireServerLock(p: ProjectPaths): (() => void) | null {
  mkdirSync(p.state, { recursive: true });
  const file = join(p.state, "server.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx" });
      const release = () => {
        try { if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file, { force: true }); } catch {}
      };
      process.once("exit", release);
      return release;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let pid: number;
      try { pid = Number(readFileSync(file, "utf8")); } catch { continue; }
      // An empty lock can mean another process has just created it.
      if (!Number.isInteger(pid) || pid <= 0 || isAlive(pid)) return null;
      // Serialize stale-lock recovery, then recheck: another starter may already own it.
      const recovery = `${file}.recovery`;
      try { writeFileSync(recovery, String(process.pid), { flag: "wx" }); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
        throw err;
      }
      try {
        const current = Number(readFileSync(file, "utf8"));
        if (Number.isInteger(current) && current > 0 && !isAlive(current)) rmSync(file, { force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      } finally { rmSync(recovery, { force: true }); }
    }
  }
  return null;
}

export function registerServer(p: ProjectPaths, info: ServerInfo) {
  mkdirSync(registry, { recursive: true });
  writeFileSync(registryFile(p.root), JSON.stringify({ ...info, root: p.root }));
  const cleanup = () => {
    for (const file of [p.serverFile, registryFile(p.root)]) {
      try { if (JSON.parse(readFileSync(file, "utf8")).pid === info.pid) rmSync(file, { force: true }); } catch {}
    }
  };
  process.once("exit", cleanup);
}

export async function listRunningServers(): Promise<RegisteredServer[]> {
  if (!existsSync(registry)) return [];
  const results = await Promise.all(readdirSync(registry).filter(f => f.endsWith(".json")).map(async file => {
    const path = join(registry, file);
    try {
      const entry = JSON.parse(readFileSync(path, "utf8")) as RegisteredServer;
      if (typeof entry.root !== "string" || !Number.isInteger(entry.pid) || entry.pid <= 0) return null;
      if (!isAlive(entry.pid)) { rmSync(path, { force: true }); return null; }
      const info = await getRunningServer(projectPaths(entry.root));
      return info?.pid === entry.pid ? { ...info, root: entry.root } : null;
    } catch { return null; }
  }));
  return results.filter((info): info is RegisteredServer => info !== null);
}

export async function stopServer(info: ServerInfo, root: string) {
  if (!isAlive(info.pid)) return;
  if (!await isHealthy(info, root)) throw new Error(`Cannot verify Framio pid ${info.pid} for ${root}; refusing to stop it.`);
  process.kill(info.pid, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (isAlive(info.pid) && Date.now() < deadline) await Bun.sleep(50);
  if (isAlive(info.pid)) throw new Error(`Framio pid ${info.pid} did not stop within 10 seconds.`);
}
