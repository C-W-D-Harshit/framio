#!/usr/bin/env bun
import { add } from "./commands/add";
import { init } from "./commands/init";
import { install } from "./commands/install";
import { screenshot } from "./commands/screenshot";
import { list, open, openBrowser, start, status, stop } from "./commands/server";
import { CliError } from "./commands/shared";

declare const FRAMIO_VERSION: string | undefined;
const VERSION = typeof FRAMIO_VERSION === "string" ? FRAMIO_VERSION : "dev";

const HELP = `framio: a design canvas for coding agents

Usage:
  framio init                      Create .framio/ in this directory
  framio start [--no-open]         Run the canvas in the foreground (Ctrl+C stops it)
  framio start --background        Run the canvas in the background
  framio stop [--all]              Stop this project or all registered servers
  framio list                      List running servers across projects
  framio status                    Show whether the canvas is running
  framio open                      Open the canvas in your browser
  framio screenshot <frame>...     Render frames to PNG (--all, --scale=2)
  framio install <package>...      Add npm packages for frames to use
  framio add <registry-item>...    Add shadcn registry components (@react-bits, @aceternity, ...)
`;

const [command = "start", ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "init":
      await init(args);
      break;
    case "start":
      await start(args);
      break;
    case "stop":
      await stop(args);
      break;
    case "list":
      await list();
      break;
    case "status":
      await status();
      break;
    case "open":
      await open();
      break;
    case "screenshot":
      await screenshot(args);
      break;
    case "install":
      await install(args);
      break;
    case "add":
      await add(args);
      break;
    case "__serve": {
      const { runServer } = await import("./server/server");
      const { acquireServerLock, getRunningServer } = await import("./lib/server-state");
      const { projectPaths } = await import("./lib/paths");
      const p = projectPaths(args[0]!);
      if (await getRunningServer(p)) break;
      const release = acquireServerLock(p);
      if (!release) break;
      try { await runServer(p.root, args.includes("--open") ? openBrowser : undefined); }
      catch (err) { release(); throw err; }
      break;
    }
    case "--version":
    case "-v":
      console.log(VERSION);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      process.exitCode = 1;
  }
} catch (err) {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exitCode = 1;
  } else throw err;
}
