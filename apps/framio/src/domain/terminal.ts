import { stripVTControlCharacters } from "node:util";

export type TaskStatus =
  "running" | "done" | "failed" | "warning" | "cancelled";
export type TerminalLevel = "info" | "success" | "warning" | "error";
export interface TerminalCapabilities {
  readonly interactive: boolean;
  readonly color: boolean;
  readonly unicode: boolean;
  readonly columns: number;
  readonly rows: number;
}
export interface TerminalTask {
  readonly id: number;
  readonly label: string;
  readonly detail: string;
  readonly status: TaskStatus;
  readonly startedAt: number;
  readonly endedAt?: number;
}

export const terminalText = (text: string) =>
  stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, "");

export const terminalStyle = (
  text: string,
  code: number,
  capabilities: TerminalCapabilities,
) => (capabilities.color ? `\x1b[${code}m${text}\x1b[0m` : text);

export const elapsed = (millis: number) =>
  `${(Math.max(0, millis) / 1000).toFixed(1)}s`;

export function fitTerminalLine(
  text: string,
  columns: number,
  measure: (text: string) => number,
) {
  const limit = Math.max(1, columns - 1);
  if (measure(text) <= limit) return text;
  let result = "";
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text)) {
    if (measure(result + segment + "...") > limit) break;
    result += segment;
  }
  return limit < 3 ? ".".repeat(limit) : result + "...";
}

export function renderTask(
  task: TerminalTask,
  now: number,
  tick: number,
  capabilities: TerminalCapabilities,
  measure: (text: string) => number,
) {
  const symbols = capabilities.unicode
    ? {
        running: ["◐", "◓", "◑", "◒"][tick % 4]!,
        done: "✓",
        failed: "✕",
        warning: "!",
        cancelled: "○",
      }
    : {
        running: ["|", "/", "-", "\\"][tick % 4]!,
        done: "+",
        failed: "x",
        warning: "!",
        cancelled: "-",
      };
  const symbol =
    task.status === "running" && !capabilities.interactive
      ? ">"
      : symbols[task.status];
  const label = terminalText(task.label);
  const detail = terminalText(task.detail);
  const duration = elapsed((task.endedAt ?? now) - task.startedAt);
  const text = `  ${symbol} ${label}${detail ? `  ${detail}` : ""}  ${duration}`;
  const fitted = capabilities.interactive
    ? fitTerminalLine(text, capabilities.columns, measure)
    : text;
  const code =
    task.status === "done"
      ? 32
      : task.status === "failed"
        ? 31
        : task.status === "warning"
          ? 33
          : task.status === "cancelled"
            ? 2
            : 94;
  if (fitted.length < 4) return terminalStyle(fitted, code, capabilities);
  return `  ${terminalStyle(symbol, code, capabilities)} ${terminalStyle(fitted.slice(4, 4 + label.length), 1, capabilities)}${terminalStyle(fitted.slice(4 + label.length), 2, capabilities)}`;
}

export function renderBanner(
  context: string,
  version: string,
  capabilities: TerminalCapabilities,
) {
  const separator = capabilities.unicode ? " · " : " / ";
  const name = terminalStyle("framio", 1, capabilities);
  const meta = terminalStyle(
    [version, terminalText(context)].filter(Boolean).join(separator),
    2,
    capabilities,
  );
  if (!capabilities.interactive || capabilities.columns < 56)
    return `\n  ${name}${meta ? `  ${meta}` : ""}\n\n`;
  const mark = (text: string) => terminalStyle(text, 94, capabilities);
  return `\n  ${mark("+--- []")}\n  ${mark("| +--")}   ${name}${meta ? `  ${meta}` : ""}\n  ${mark("| |")}     A design canvas for coding agents\n\n`;
}
