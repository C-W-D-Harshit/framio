import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { selfCommand } from "../lib/bun";
import { projectPaths, type ProjectPaths } from "../lib/paths";
import { getRunningServer, readServerInfo, type ServerInfo } from "../lib/server-state";
import { requireProject } from "./shared";

export function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

/** Starts the detached background server if needed. Returns the server and whether it was just started. */
export async function ensureServer(p: ProjectPaths): Promise<{ info: ServerInfo; started: boolean }> {
  const running = await getRunningServer(p);
  if (running) return { info: running, started: false };

  mkdirSync(p.state, { recursive: true });
  const logFd = openSync(p.serverLog, "a");
  const [cmd, ...args] = selfCommand(["__serve", p.root]);
  const child = spawn(cmd!, args, { cwd: p.root, detached: true, stdio: ["ignore", logFd, logFd] });
  child.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await Bun.sleep(100);
    const info = readServerInfo(p);
    if (info && info.pid === child.pid && (await getRunningServer(p))) return { info, started: true };
    if (child.exitCode !== null) break;
  }
  throw new Error(`The framio server did not start. See ${p.serverLog}`);
}

export async function start(args: string[]) {
  const p = projectPaths(requireProject());
  const { info, started } = await ensureServer(p);
  if (started && !args.includes("--no-open")) openBrowser(info.url);
  console.log(started ? `Framio is running at ${info.url}` : `Framio is already running at ${info.url}`);
  if (!started) console.log("Run `framio open` to open it in the browser.");
}

export async function stop() {
  const p = projectPaths(requireProject());
  const info = await getRunningServer(p);
  if (!info) return console.log("Framio is not running.");
  process.kill(info.pid, "SIGTERM");
  console.log(`Stopped framio (pid ${info.pid}).`);
}

export async function status() {
  const p = projectPaths(requireProject());
  const info = await getRunningServer(p);
  if (!info) return console.log("Framio is not running. Start it with `framio start`.");
  console.log(`Running at ${info.url}\npid:  ${info.pid}\nlogs: ${p.serverLog}`);
}

export async function open() {
  const p = projectPaths(requireProject());
  const { info } = await ensureServer(p);
  openBrowser(info.url);
  console.log(`Opened ${info.url}`);
}
