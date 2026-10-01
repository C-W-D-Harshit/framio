import { existsSync, readFileSync, rmSync } from "node:fs";
import type { ProjectPaths } from "./paths";

export type ServerInfo = { pid: number; port: number; url: string; startedAt: string };

export function readServerInfo(p: ProjectPaths): ServerInfo | null {
  if (!existsSync(p.serverFile)) return null;
  try {
    return JSON.parse(readFileSync(p.serverFile, "utf8"));
  } catch {
    return null;
  }
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isHealthy(info: ServerInfo, root: string) {
  try {
    const res = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(1000) });
    const body = (await res.json()) as { root?: string };
    return res.ok && body.root === root;
  } catch {
    return false;
  }
}

/** Returns the running server for this project, cleaning up stale state if the process is gone. */
export async function getRunningServer(p: ProjectPaths): Promise<ServerInfo | null> {
  const info = readServerInfo(p);
  if (!info) return null;
  if (isAlive(info.pid) && (await isHealthy(info, p.root))) return info;
  rmSync(p.serverFile, { force: true });
  return null;
}
