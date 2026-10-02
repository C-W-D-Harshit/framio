import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { launchBrowser } from "../platform/browser-launcher";
import { ServerRegistry } from "../services/server-registry";
import { ServerLauncher } from "../services/server-launcher";
import { displayPath, projectPaths } from "../lib/paths";
import { requireProject } from "./shared";
import { ServerStartupFailed } from "../domain/errors";
import { basename } from "node:path";
import { TerminalUI } from "../services/terminal-ui";
import { canOpenBrowser } from "../platform/network-addresses";
import { defaultHost } from "../domain/server-addresses";
import { printServerUrls } from "../services/server-display";

export const openBrowser = Effect.fn("openBrowser")(function* (url: string) {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  yield* launchBrowser(command);
});

export const tryOpenBrowser = Effect.fn("tryOpenBrowser")(function* (
  url: string,
) {
  if (!canOpenBrowser()) return;
  yield* openBrowser(url).pipe(
    Effect.catch(() =>
      Effect.flatMap(TerminalUI, (ui) =>
        ui.message(
          "warning",
          `Could not open a browser. Open ${url} on your computer.`,
        ),
      ),
    ),
  );
});

export const start = Effect.fn("start")(function* (options: {
  background: boolean;
  noOpen: boolean;
  verbose?: boolean;
  host?: string;
}) {
  const p = projectPaths(yield* requireProject);
  const registry = yield* ServerRegistry;
  const launcher = yield* ServerLauncher;
  const ui = yield* TerminalUI;
  if (options.background) {
    yield* ui.banner(basename(p.root));
    const { info, started } = yield* ui.tasks((tasks) =>
      tasks.run(
        "Canvas",
        launcher.ensure(p, false, options.host ?? defaultHost),
        { done: "Ready" },
      ),
    );
    if (started && !options.noOpen) yield* tryOpenBrowser(info.url);
    yield* ui.message(
      "success",
      started
        ? `Framio is running in the background at ${info.url}`
        : `Framio is already running at ${info.url}`,
    );
    yield* printServerUrls(info);
    yield* ui.row("Files", displayPath(p.framio));
    yield* ui.row("Logs", displayPath(p.serverLog));
    yield* ui.next("Stop this canvas", ["framio stop"]);
    return;
  }
  const running = yield* registry.running(p);
  if (running) {
    yield* ui.message(
      "info",
      `Framio is already running at ${running.url}. Stop it with \`framio stop\` before starting in the foreground.`,
    );
    yield* printServerUrls(running);
    return;
  }
  const code = yield* launcher.foreground(
    p,
    !options.noOpen && canOpenBrowser(),
    options.verbose,
    options.host,
  );
  yield* Effect.sync(() => {
    process.exitCode = code;
  });
});

export const stop = Effect.fn("stop")(function* (all: boolean) {
  const registry = yield* ServerRegistry;
  const ui = yield* TerminalUI;
  if (all) {
    const servers = yield* registry.list;
    for (const info of servers) {
      yield* registry.stop(info, info.root);
      yield* ui.message(
        "success",
        `Stopped framio for ${info.root} (pid ${info.pid}).`,
      );
    }
    if (!servers.length)
      yield* ui.message("info", "No Framio servers are running.");
    return;
  }
  const p = projectPaths(yield* requireProject);
  const info = yield* registry.read(p);
  if (!info) return yield* ui.message("info", "Framio is not running.");
  yield* registry.stop(info, p.root);
  yield* ui.message("success", `Stopped framio (pid ${info.pid}).`);
});
export const list = Effect.gen(function* () {
  const registry = yield* ServerRegistry;
  const servers = yield* registry.list;
  const ui = yield* TerminalUI;
  if (!servers.length)
    return yield* ui.message("info", "No Framio servers are running.");
  if (ui.interactive) {
    for (const info of servers) {
      yield* ui.row("Project", info.root);
      yield* printServerUrls(info);
      yield* ui.row("PID", String(info.pid));
    }
    return;
  }
  for (const info of servers)
    yield* Console.log(`${info.pid}\t${info.url}\t${info.root}`);
});
export const status = Effect.gen(function* () {
  const p = projectPaths(yield* requireProject);
  const info = yield* (yield* ServerRegistry).running(p);
  const ui = yield* TerminalUI;
  if (!info)
    return yield* ui.message(
      "info",
      "Framio is not running. Start it with `framio start`.",
    );
  yield* printServerUrls(info);
  yield* ui.row("Status", "Running");
  yield* ui.row("Files", displayPath(p.framio));
  yield* ui.row("PID", String(info.pid));
});
export const open = Effect.gen(function* () {
  const p = projectPaths(yield* requireProject);
  const info = yield* (yield* ServerRegistry).running(p);
  if (!info)
    return yield* new ServerStartupFailed({
      message:
        "Framio is not running. Start it with `framio start`, or use `framio start --background`.",
    });
  yield* openBrowser(info.url);
  yield* (yield* TerminalUI).message("success", `Opened ${info.url}`);
});
