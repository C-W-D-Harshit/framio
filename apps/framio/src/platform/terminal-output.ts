import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { TerminalCapabilities } from "../domain/terminal";

export function terminalCapabilities(
  stream: { isTTY?: boolean; columns?: number; rows?: number },
  env: NodeJS.ProcessEnv,
): TerminalCapabilities {
  const interactive = !!stream.isTTY && !env.CI && env.TERM !== "dumb";
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return {
    interactive,
    color: interactive && env.NO_COLOR === undefined,
    unicode: interactive && locale !== "C" && locale !== "POSIX",
    columns: Math.max(1, stream.columns ?? 80),
    rows: Math.max(1, stream.rows ?? 24),
  };
}

export class TerminalOutput extends Context.Service<
  TerminalOutput,
  {
    readonly capabilities: (
      stream?: "stdout" | "stderr",
    ) => TerminalCapabilities;
    readonly measure: (text: string) => number;
    readonly write: (
      text: string,
      stream?: "stdout" | "stderr",
    ) => Effect.Effect<void>;
  }
>()("framio/platform/TerminalOutput") {
  static readonly layer = Layer.sync(TerminalOutput, () =>
    TerminalOutput.of({
      capabilities: (stream = "stdout") =>
        terminalCapabilities(process[stream], process.env),
      measure: (text) => Bun.stringWidth(text),
      write: (text, stream = "stdout") =>
        Effect.sync(() => {
          process[stream].write(text);
        }),
    }),
  );
}
