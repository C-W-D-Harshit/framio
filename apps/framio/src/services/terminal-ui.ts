import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import {
  renderBanner,
  renderTask,
  terminalStyle,
  terminalText,
  type TerminalLevel,
  type TerminalTask,
} from "../domain/terminal";
import { TerminalOutput } from "../platform/terminal-output";

export interface TaskOptions {
  readonly done?: string;
  readonly failed?: string;
  readonly warningOnFailure?: boolean;
}
export interface TerminalTasks {
  readonly run: <A, E, R>(
    label: string,
    work: Effect.Effect<A, E, R>,
    options?: TaskOptions,
  ) => Effect.Effect<A, E, R>;
}

export class TerminalUI extends Context.Service<
  TerminalUI,
  {
    readonly interactive: boolean;
    readonly banner: (context?: string) => Effect.Effect<void>;
    readonly message: (
      level: TerminalLevel,
      message: string,
    ) => Effect.Effect<void>;
    readonly row: (label: string, value: string) => Effect.Effect<void>;
    readonly next: (
      title: string,
      commands: readonly string[],
    ) => Effect.Effect<void>;
    readonly tasks: <A, E, R>(
      use: (tasks: TerminalTasks) => Effect.Effect<A, E, R>,
      options?: { live?: boolean },
    ) => Effect.Effect<A, E, R>;
  }
>()("framio/services/TerminalUI") {
  static layer(version: string) {
    return Layer.effect(TerminalUI, makeTerminalUI(version)).pipe(
      Layer.provide(TerminalOutput.layer),
    );
  }
}

export const makeTerminalUI = Effect.fnUntraced(function* (version = "") {
  const output = yield* TerminalOutput;
  const lock = yield* Semaphore.make(1);
  const write = (text: string, stream: "stdout" | "stderr" = "stdout") =>
    output.write(text, stream).pipe(Semaphore.withPermits(lock, 1));
  const message = Effect.fnUntraced(function* (
    level: TerminalLevel,
    text: string,
  ) {
    const stream =
      level === "error" || level === "warning" ? "stderr" : "stdout";
    const capabilities = output.capabilities(stream);
    const symbol =
      level === "success"
        ? capabilities.unicode
          ? "✓"
          : "+"
        : level === "error"
          ? "error:"
          : level === "warning"
            ? "warning:"
            : capabilities.unicode
              ? "•"
              : ">";
    const code =
      level === "error"
        ? 31
        : level === "warning"
          ? 33
          : level === "success"
            ? 32
            : 94;
    const lines = text.split("\n").map(terminalText);
    yield* write(
      `  ${terminalStyle(symbol, code, capabilities)} ${lines.join("\n    ")}\n`,
      stream,
    );
  });
  // A session owns its cursor region and the resources acquired by its tasks.
  // Use live: false for work that writes subprocess logs directly to the terminal.
  const tasks = <A, E, R>(
    use: (tasks: TerminalTasks) => Effect.Effect<A, E, R>,
    options: { live?: boolean } = {},
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const rows = yield* Ref.make<readonly TerminalTask[]>([]);
        const drawn = yield* Ref.make(0);
        const live =
          output.capabilities().interactive && options.live !== false;
        const initialSize = { ...output.capabilities() };
        const animated = yield* Ref.make(live);
        const draw = Effect.gen(function* () {
          const current = yield* Ref.get(rows);
          if (!current.length) return;
          const capabilities = output.capabilities();
          if (!(yield* Ref.get(animated))) return;
          if (
            !capabilities.interactive ||
            capabilities.columns !== initialSize.columns ||
            capabilities.rows !== initialSize.rows
          ) {
            // Resizing can reflow old lines. Stop moving the cursor rather than erase unrelated output.
            yield* Ref.set(animated, false);
            yield* output.write("\x1b[?25h\n");
            return;
          }
          const visible = current.slice(-Math.max(1, capabilities.rows - 6));
          const now = yield* Clock.currentTimeMillis;
          const previous = yield* Ref.get(drawn);
          const clear = previous ? `\x1b[${previous}A\r\x1b[J` : "";
          yield* output.write(
            clear +
              visible
                .map((row) =>
                  renderTask(
                    row,
                    now,
                    Math.floor(now / 100),
                    capabilities,
                    output.measure,
                  ),
                )
                .join("\n") +
              "\n",
          );
          yield* Ref.set(drawn, visible.length);
        }).pipe(Semaphore.withPermits(lock, 1));
        const publish = Effect.fnUntraced(function* (row: TerminalTask) {
          if (yield* Ref.get(animated)) yield* draw;
          if (!(yield* Ref.get(animated)))
            yield* write(
              renderTask(
                row,
                yield* Clock.currentTimeMillis,
                0,
                { ...output.capabilities(), interactive: false },
                output.measure,
              ) + "\n",
            );
        });
        if (live) {
          yield* Effect.acquireRelease(write("\x1b[?25l"), () =>
            write("\x1b[?25h"),
          );
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              while (true) {
                yield* Effect.sleep(100);
                if (
                  (yield* Ref.get(rows)).some((row) => row.status === "running")
                )
                  yield* draw;
              }
            }),
          );
        }
        const run: TerminalTasks["run"] = (label, work, taskOptions = {}) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const startedAt = yield* Clock.currentTimeMillis;
              const row = yield* Ref.modify(rows, (current) => {
                const row: TerminalTask = {
                  id: current.length,
                  label,
                  detail: "Working",
                  status: "running",
                  startedAt,
                };
                return [row, [...current, row]];
              });
              yield* publish(row);
              return yield* restore(work).pipe(
                Effect.onExit((exit) =>
                  Effect.gen(function* () {
                    const endedAt = yield* Clock.currentTimeMillis;
                    const cancelled =
                      Exit.isFailure(exit) &&
                      Cause.hasInterruptsOnly(exit.cause);
                    const status = Exit.isSuccess(exit)
                      ? "done"
                      : cancelled
                        ? "cancelled"
                        : taskOptions.warningOnFailure
                          ? "warning"
                          : "failed";
                    const detail = Exit.isSuccess(exit)
                      ? (taskOptions.done ?? "Complete")
                      : cancelled
                        ? "Cancelled"
                        : (taskOptions.failed ?? "Failed");
                    const settled: TerminalTask = {
                      ...row,
                      status,
                      detail,
                      endedAt,
                    };
                    yield* Ref.update(rows, (current) =>
                      current.map((value) =>
                        value.id === row.id ? settled : value,
                      ),
                    );
                    yield* publish(settled);
                  }),
                ),
              );
            }),
          );
        return yield* use({ run });
      }),
    );
  return TerminalUI.of({
    interactive: output.capabilities().interactive,
    banner: (context = "") =>
      write(renderBanner(context, version, output.capabilities())),
    message,
    row: (label, value) =>
      write(
        `  ${terminalStyle(terminalText(label).padEnd(10), 2, output.capabilities())}${label === "Canvas" ? terminalStyle(terminalText(value), 94, output.capabilities()) : terminalText(value)}\n`,
      ),
    next: (title, commands) =>
      write(
        `\n  ${terminalStyle(terminalText(title), 1, output.capabilities())}\n\n${commands.map((command) => `    ${terminalStyle(terminalText(command), 94, output.capabilities())}`).join("\n")}\n\n`,
      ),
    tasks,
  });
});
