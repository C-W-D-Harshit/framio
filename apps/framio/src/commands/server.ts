import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { launchBrowser } from "../platform/browser-launcher";
import { ServerRegistry } from "../services/server-registry";
import { ServerLauncher } from "../services/server-launcher";
import { projectPaths } from "../lib/paths";
import { requireProject } from "./shared";
import { ServerStartupFailed } from "../domain/errors";

export const openBrowser = Effect.fn("openBrowser")(function* (url: string) {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  yield* launchBrowser(command);
});

export const start = Effect.fn("start")(function* (options: {
  background: boolean;
  noOpen: boolean;
}) {
  const p = projectPaths(yield* requireProject);
  const registry = yield* ServerRegistry;
  const launcher = yield* ServerLauncher;
  if (options.background) {
    const { info, started } = yield* launcher.ensure(p);
    if (started && !options.noOpen) yield* openBrowser(info.url);
    yield* Console.log(
      started
        ? `Framio is running in the background at ${info.url}`
        : `Framio is already running at ${info.url}`,
    );
    return;
  }
  const running = yield* registry.running(p);
  if (running)
    return yield* Console.log(
      `Framio is already running at ${running.url}. Stop it with \`framio stop\` before starting in the foreground.`,
    );
  const code = yield* launcher.foreground(p, !options.noOpen);
  yield* Effect.sync(() => {
    process.exitCode = code;
  });
});

export const stop = Effect.fn("stop")(function* (all: boolean) {
  const registry = yield* ServerRegistry;
  if (all) {
    const servers = yield* registry.list;
    for (const info of servers) {
      yield* registry.stop(info, info.root);
      yield* Console.log(`Stopped framio for ${info.root} (pid ${info.pid}).`);
    }
    if (!servers.length) yield* Console.log("No Framio servers are running.");
    return;
  }
  const p = projectPaths(yield* requireProject);
  const info = yield* registry.read(p);
  if (!info) return yield* Console.log("Framio is not running.");
  yield* registry.stop(info, p.root);
  yield* Console.log(`Stopped framio (pid ${info.pid}).`);
});
export const list = Effect.gen(function* () {
  const registry = yield* ServerRegistry;
  const servers = yield* registry.list;
  if (!servers.length)
    return yield* Console.log("No Framio servers are running.");
  for (const info of servers)
    yield* Console.log(`${info.pid}\t${info.url}\t${info.root}`);
});
export const status = Effect.gen(function* () {
  const p = projectPaths(yield* requireProject);
  const info = yield* (yield* ServerRegistry).running(p);
  if (!info)
    return yield* Console.log(
      "Framio is not running. Start it with `framio start`.",
    );
  yield* Console.log(`Running at ${info.url}\npid:  ${info.pid}`);
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
  yield* Console.log(`Opened ${info.url}`);
});
