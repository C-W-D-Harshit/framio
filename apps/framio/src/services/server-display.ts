import * as Effect from "effect/Effect";
import type { ServerInfo } from "../contracts/server-info";
import { TerminalUI } from "./terminal-ui";

const labels = { local: "Local", network: "Network", tailscale: "Tailscale" };
export const printServerUrls = Effect.fn("ServerDisplay.urls")(function* (
  info: ServerInfo,
) {
  const ui = yield* TerminalUI;
  if (!info.urls) return yield* ui.row("Canvas", info.url);
  for (const entry of info.urls) yield* ui.row(labels[entry.kind], entry.url);
});
