import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { stripVTControlCharacters } from "node:util";
import type { TerminalCapabilities } from "../../src/domain/terminal";
import {
  TerminalOutput,
  terminalCapabilities,
} from "../../src/platform/terminal-output";
import { makeTerminalUI } from "../../src/services/terminal-ui";

function terminal(interactive = true) {
  const writes: { stream: string; text: string }[] = [];
  const capabilities: TerminalCapabilities = {
    interactive,
    color: interactive,
    unicode: interactive,
    columns: 80,
    rows: 24,
  };
  const output = TerminalOutput.of({
    capabilities: () => capabilities,
    measure: (text) => [...text].length,
    write: (text, stream = "stdout") =>
      Effect.sync(() => {
        writes.push({ stream, text });
      }),
  });
  return {
    writes,
    capabilities,
    make: makeTerminalUI("0.0.7").pipe(
      Effect.provideService(TerminalOutput, output),
    ),
  };
}

describe("terminal lifecycle", () => {
  it.effect(
    "settles concurrent tasks independently and stops the ticker at session end",
    () =>
      Effect.gen(function* () {
        const terminalState = terminal();
        const ui = yield* terminalState.make;
        const first = yield* Deferred.make<void>();
        const second = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const session = yield* ui
          .tasks((tasks) =>
            Effect.all(
              [
                tasks.run("Packages", Deferred.await(first), {
                  done: "Installed",
                }),
                tasks.run(
                  "Screenshot browser",
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(second)),
                  ),
                  { done: "Installed" },
                ),
              ],
              { concurrency: 2 },
            ),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        yield* TestClock.adjust(500);
        yield* Deferred.succeed(first, undefined);
        yield* Effect.yieldNow;
        yield* TestClock.adjust(100);
        const frame = terminalState.writes.at(-1)!.text;
        assert.include(
          stripVTControlCharacters(frame),
          "✓ Packages  Installed",
        );
        assert.match(
          stripVTControlCharacters(frame),
          /Screenshot browser  Working  0\.6s/,
        );
        yield* Deferred.succeed(second, undefined);
        yield* Fiber.join(session);
        assert.strictEqual(terminalState.writes.at(-1)!.text, "\x1b[?25h");
        const count = terminalState.writes.length;
        yield* TestClock.adjust(1000);
        assert.strictEqual(terminalState.writes.length, count);
      }),
  );

  it.effect("interruption cancels active tasks and restores the cursor", () =>
    Effect.gen(function* () {
      const state = terminal();
      const ui = yield* state.make;
      const entered = yield* Deferred.make<void>();
      const session = yield* ui
        .tasks((tasks) =>
          tasks.run(
            "Packages",
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(session);
      assert.include(
        stripVTControlCharacters(
          state.writes.map((entry) => entry.text).join(""),
        ),
        "Packages  Cancelled",
      );
      assert.strictEqual(state.writes.at(-1)!.text, "\x1b[?25h");
      const count = state.writes.length;
      yield* TestClock.adjust(500);
      assert.strictEqual(state.writes.length, count);
    }),
  );

  it.effect(
    "plain output keeps failures and optional warnings without cursor escapes",
    () =>
      Effect.gen(function* () {
        const state = terminal(false);
        const ui = yield* state.make;
        const result = yield* ui
          .tasks((tasks) =>
            tasks.run("Packages", Effect.fail("registry offline")),
          )
          .pipe(Effect.result);
        assert.strictEqual(result._tag, "Failure");
        const optional = yield* ui
          .tasks((tasks) =>
            tasks.run("Browser", Effect.fail("offline"), {
              warningOnFailure: true,
              failed: "Unavailable",
            }),
          )
          .pipe(Effect.result);
        assert.strictEqual(optional._tag, "Failure");
        yield* ui.message(
          "error",
          "registry offline\nRetry with framio install",
        );
        const text = state.writes.map((entry) => entry.text).join("");
        assert.include(text, "x Packages  Failed");
        assert.include(text, "! Browser  Unavailable");
        assert.include(text, "Retry with framio install");
        assert.notInclude(text, "\x1b");
        assert.strictEqual(state.writes.at(-1)!.stream, "stderr");
      }),
  );

  it.effect("verbose sessions do not redraw over subprocess logs", () =>
    Effect.gen(function* () {
      const state = terminal();
      const ui = yield* state.make;
      yield* ui.tasks((tasks) => tasks.run("Packages", Effect.void), {
        live: false,
      });
      const text = state.writes.map((entry) => entry.text).join("");
      assert.include(stripVTControlCharacters(text), "Packages  Complete");
      assert.notInclude(text, "\x1b[?25");
      assert.notInclude(text, "\x1b[J");
    }),
  );

  it.effect.each([false, true])(
    "a resized terminal stops cursor movement and retains completion details, tick first: %s",
    (tickFirst) =>
      Effect.gen(function* () {
        const state = terminal();
        const ui = yield* state.make;
        const gate = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        const session = yield* ui
          .tasks((tasks) =>
            tasks.run(
              "Packages",
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
              ),
              { done: "A long completion message that must remain readable" },
            ),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        Object.assign(state.capabilities, { columns: 32 });
        if (tickFirst) yield* TestClock.adjust(100);
        const index = state.writes.length;
        yield* Deferred.succeed(gate, undefined);
        yield* Fiber.join(session);
        const text = state.writes
          .slice(index)
          .map((entry) => entry.text)
          .join("");
        assert.notInclude(text, "\x1b[J");
        assert.include(
          text,
          "A long completion message that must remain readable",
        );
      }),
  );

  it.effect(
    "untrusted filenames and diagnostics cannot inject terminal controls",
    () =>
      Effect.gen(function* () {
        const state = terminal(false);
        const ui = yield* state.make;
        yield* ui.banner("project\x1b[2J\nforged");
        yield* ui.message("error", "bad\x1b[31m registry\x07\nRetry safely");
        const text = state.writes.map((entry) => entry.text).join("");
        assert.notInclude(text, "\x1b");
        assert.notInclude(text, "\x07");
        assert.include(text, "Retry safely");
      }),
  );
});

describe("terminal capabilities", () => {
  it("keeps NO_COLOR animation separate from CI, dumb and redirected output", () => {
    assert.deepStrictEqual(
      terminalCapabilities({ isTTY: true }, { NO_COLOR: "", LANG: "C" }),
      {
        interactive: true,
        color: false,
        unicode: false,
        columns: 80,
        rows: 24,
      },
    );
    for (const env of [{ CI: "true" }, { TERM: "dumb" }]) {
      assert.isFalse(terminalCapabilities({ isTTY: true }, env).interactive);
      assert.isFalse(terminalCapabilities({ isTTY: true }, env).color);
    }
    assert.isFalse(
      terminalCapabilities({ isTTY: false }, { FORCE_COLOR: "1" }).color,
    );
  });
});
