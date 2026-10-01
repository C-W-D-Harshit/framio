import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { selfCommand } from "../lib/bun";
import { projectPaths, type ProjectPaths } from "../lib/paths";
import { getRunningServer, isAlive, listRunningServers, stopServer, type ServerInfo } from "../lib/server-state";
import { CliError, requireProject } from "./shared";

export function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

/** Background mode is explicit at the CLI; screenshots own their temporary child. */
export async function ensureServer(p: ProjectPaths, temporary = false): Promise<{ info: ServerInfo; started: boolean; cleanup: () => Promise<void> }> {
  const running = await getRunningServer(p);
  if (running) return { info: running, started: false, cleanup: async () => {} };

  mkdirSync(p.state, { recursive: true });
  const logFd = openSync(p.serverLog, "a");
  const [cmd, ...args] = selfCommand(["__serve", p.root]);
  const child = spawn(cmd!, args, { cwd: p.root, detached: !temporary, stdio: ["ignore", logFd, logFd] });
  closeSync(logFd);
  let spawnError: Error | undefined;
  child.on("error", err => { spawnError = err; });
  const exited = new Promise<void>(resolve => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
  if (!temporary) child.unref();
  const interrupt = () => { child.kill("SIGTERM"); };
  if (temporary) {
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    process.on("SIGHUP", interrupt);
    process.once("exit", interrupt);
  }
  const detachHandlers = () => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    process.off("SIGHUP", interrupt);
    process.off("exit", interrupt);
  };
  const cleanup = async () => {
    detachHandlers();
    if (child.exitCode === null && child.signalCode === null && !spawnError) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await Bun.sleep(100);
    const info = await getRunningServer(p);
    if (info) {
      if (info.pid === child.pid) return { info, started: true, cleanup };
      // A simultaneous launch won the project lock. Reuse its server.
      await cleanup();
      return { info, started: false, cleanup: async () => {} };
    }
    if (spawnError) break;
    if (child.exitCode !== null || child.signalCode !== null) {
      // A competing server may still be starting. Wait only while its lock is live.
      try {
        const pid = Number(readFileSync(`${p.state}/server.lock`, "utf8"));
        if (!Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) break;
      } catch { break; }
    }
  }
  await cleanup();
  throw new CliError(`The framio server did not start${spawnError ? `: ${spawnError.message}` : ""}. See ${p.serverLog}`);
}

export async function start(args: string[]) {
  if (args.some(arg => !["--background", "--no-open"].includes(arg))) throw new CliError("Usage: framio start [--background] [--no-open]");
  const p = projectPaths(requireProject());
  if (args.includes("--background")) {
    const { info, started } = await ensureServer(p);
    if (started && !args.includes("--no-open")) openBrowser(info.url);
    console.log(started ? `Framio is running in the background at ${info.url}` : `Framio is already running at ${info.url}`);
    return;
  }
  const running = await getRunningServer(p);
  if (running) {
    console.log(`Framio is already running at ${running.url}. Stop it with \`framio stop\` before starting in the foreground.`);
    return;
  }
  const child = Bun.spawn(selfCommand(["__serve", p.root, ...(args.includes("--no-open") ? [] : ["--open"])]), {
    cwd: p.root, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  const interrupt = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  process.on("SIGHUP", interrupt);
  process.once("exit", interrupt);
  try { process.exitCode = await child.exited; }
  finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    process.off("SIGHUP", interrupt);
    process.off("exit", interrupt);
  }
}

export async function stop(args: string[] = []) {
  if (args.some(arg => arg !== "--all")) throw new CliError("Usage: framio stop [--all]");
  if (args.includes("--all")) {
    const servers = await listRunningServers();
    for (const info of servers) { await stopServer(info, info.root); console.log(`Stopped framio for ${info.root} (pid ${info.pid}).`); }
    if (!servers.length) console.log("No Framio servers are running.");
    return;
  }
  const p = projectPaths(requireProject());
  const info = await getRunningServer(p);
  if (!info) return console.log("Framio is not running.");
  await stopServer(info, p.root);
  console.log(`Stopped framio (pid ${info.pid}).`);
}

export async function list() {
  const servers = await listRunningServers();
  if (!servers.length) return console.log("No Framio servers are running.");
  for (const info of servers) console.log(`${info.pid}\t${info.url}\t${info.root}`);
}

export async function status() {
  const p = projectPaths(requireProject());
  const info = await getRunningServer(p);
  if (!info) return console.log("Framio is not running. Start it with `framio start`.");
  console.log(`Running at ${info.url}\npid:  ${info.pid}`);
}

export async function open() {
  const p = projectPaths(requireProject());
  const info = await getRunningServer(p);
  if (!info) throw new CliError("Framio is not running. Start it with `framio start`, or use `framio start --background`.");
  openBrowser(info.url);
  console.log(`Opened ${info.url}`);
}
