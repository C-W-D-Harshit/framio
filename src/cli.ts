#!/usr/bin/env bun
import { init } from "./commands/init";
import { install } from "./commands/install";
import { screenshot } from "./commands/screenshot";
import { open, start, status, stop } from "./commands/server";
import { CliError } from "./commands/shared";

const HELP = `framio: a design canvas for coding agents

Usage:
  framio init                      Create .framio/ in this directory
  framio start [--no-open]         Start the canvas in the background (default command)
  framio stop                      Stop the background server
  framio status                    Show whether the canvas is running
  framio open                      Open the canvas in your browser
  framio screenshot <frame>...     Render frames to PNG (--all, --scale=2)
  framio install <package>...      Add npm packages for frames to use
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
      await stop();
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
    case "__serve": {
      const { runServer } = await import("./server/server");
      await runServer(args[0]!);
      break;
    }
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
