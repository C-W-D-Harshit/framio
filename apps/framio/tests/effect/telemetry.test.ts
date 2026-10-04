import { assert, it } from "@effect/vitest";
import { scrub } from "../../src/ui/services/analytics-privacy";
import type { CaptureResult } from "posthog-js";
import { telemetryEnabled } from "../../src/services/telemetry";
import { Cause, Effect, Fiber, Logger } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  exceptionProperties,
  makeAnalytics,
  retryDelayMs,
  scrubTelemetryText,
} from "../../src/services/analytics";

const harness = (
  options: { fail?: boolean; maxBuffer?: number; batchSize?: number } = {},
) => {
  const requests: Array<{
    batch: Array<{
      uuid: string;
      event: string;
      properties: Record<string, unknown>;
    }>;
  }> = [];
  let failing = options.fail ?? false;
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag !== "Uint8Array")
        throw new Error("Expected JSON body");
      requests.push(JSON.parse(new TextDecoder().decode(request.body.body)));
      return HttpClientResponse.fromWeb(
        request,
        new Response("{}", { status: failing ? 503 : 200 }),
      );
    }),
  );
  return {
    requests,
    succeed: () => {
      failing = false;
    },
    make: makeAnalytics({
      key: "test",
      host: "http://localhost",
      distinctId: "anonymous",
      common: { app: "cli" },
      ...options,
    }).pipe(Effect.provideService(HttpClient.HttpClient, http)),
  };
};
it.effect(
  "batches events, preserves original uuid on retry and drops after five attempts",
  () =>
    Effect.gen(function* () {
      const h = harness({ fail: true, batchSize: 2 });
      const service = yield* h.make;
      yield* service.record("one");
      yield* service.record("two");
      yield* service.record("three");
      for (let i = 0; i < 5; i++) yield* service.flush;
      assert.strictEqual(h.requests.length, 5);
      const uuid = h.requests[0]!.batch[0]!.uuid;
      assert.match(uuid, /^[0-9a-f-]{36}$/);
      assert.strictEqual(
        new Set(h.requests.map((r) => r.batch[0]!.uuid)).size,
        1,
      );
      assert.notStrictEqual(uuid, h.requests[0]!.batch[1]!.uuid);
      h.succeed();
      yield* service.flush;
      assert.deepStrictEqual(
        h.requests[5]!.batch.map((e) => e.event),
        ["three"],
      );
      assert.strictEqual(
        h.requests[5]!.batch[0]!.properties.$process_person_profile,
        false,
      );
      assert.strictEqual(
        h.requests[5]!.batch[0]!.properties.$geoip_disable,
        true,
      );
    }),
);
it.effect("bounds the buffer and keeps the newest queued events", () =>
  Effect.gen(function* () {
    const h = harness({ maxBuffer: 3, batchSize: 2 });
    const service = yield* h.make;
    for (const name of ["a", "b", "c", "d", "e"]) yield* service.record(name);
    yield* service.flush;
    assert.deepStrictEqual(
      h.requests.flatMap((r) => r.batch.map((e) => e.event)),
      ["c", "d", "e"],
    );
  }),
);
it.effect(
  "background delivery respects backoff instead of sending every second",
  () =>
    Effect.gen(function* () {
      const h = harness({ fail: true });
      const service = yield* h.make;
      yield* service.record("one");
      yield* TestClock.adjust("1 second");
      assert.strictEqual(h.requests.length, 1);
      yield* TestClock.adjust("500 millis");
      assert.strictEqual(h.requests.length, 1);
      yield* TestClock.adjust("2500 millis");
      assert.isAtLeast(h.requests.length, 2);
    }),
);
it.effect("shutdown is bounded even when a request never completes", () =>
  Effect.gen(function* () {
    const http = HttpClient.make(() => Effect.never);
    const fiber = yield* Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeAnalytics({
          key: "test",
          host: "http://localhost",
          distinctId: "test",
          common: {},
        });
        yield* service.record("one");
      }),
    ).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.forkChild,
    );
    yield* TestClock.adjust("1 second");
    yield* Fiber.join(fiber);
  }),
);
it.effect(
  "the logger captures Error and Fatal, ignores warnings and never includes user diagnostics",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const service = yield* h.make;
      yield* Effect.gen(function* () {
        yield* Effect.logWarning("ignored");
        yield* Effect.logError(
          "Project rebuild failed",
          new Error("secret design code"),
        );
        yield* Effect.logFatal("Server failed");
      }).pipe(
        Effect.provide(
          Logger.layer([service.logger], { mergeWithExisting: true }),
        ),
      );
      yield* service.flush;
      assert.strictEqual(h.requests[0]!.batch.length, 2);
      assert.notInclude(JSON.stringify(h.requests), "secret design code");
    }),
);
it("scrubs POSIX and Windows paths, URLs, quoted user values, multiline source excerpts and secrets", () => {
  const value = scrubTelemetryText(
    "Failed /Users/alice/design.ts C:\\Users\\alice\\design.ts https://127.0.0.1:4000/f/secret 'private layer' phc_secret\nconst code = private",
  );
  for (const secret of [
    "alice",
    "phc_secret",
    "private",
    "design.ts",
    "127.0.0.1",
  ])
    assert.notInclude(value, secret);
  assert.isAtMost(scrubTelemetryText("x".repeat(1000)).length, 300);
});
it("maps tagged errors and native stacks without source context or user frame paths", () => {
  const value = exceptionProperties(
    {
      _tag: "ProjectFailure",
      message: "Cannot read /home/alice/private",
      stack:
        "Error\n    at handler (/home/alice/framio/apps/framio/src/services/project-state.ts:10:2)\n    at design (/home/alice/project/frame.tsx:4:5)",
    },
    "cli_top_level",
  );
  assert.strictEqual(value.$exception_list[0]!.type, "ProjectFailure");
  assert.strictEqual(
    value.$exception_list[0]!.stacktrace.frames[0]!.filename,
    "src/services/project-state.ts",
  );
  assert.notInclude(JSON.stringify(value), "alice");
  assert.notInclude(JSON.stringify(value), "frame.tsx");
  assert.strictEqual(value.$exception_list[0]!.mechanism.handled, false);
  assert.isTrue(Cause.interrupt().reasons.every(Cause.isInterruptReason));
});
it("backoff grows with bounded jitter", () => {
  assert.strictEqual(retryDelayMs(1, 0), 1000);
  assert.strictEqual(retryDelayMs(2, 0.5), 3000);
  assert.strictEqual(retryDelayMs(100, 1), 300000);
});

it("opt-out precedence keeps source tests offline", () => {
  assert.isFalse(telemetryEnabled({}));
  assert.isFalse(
    telemetryEnabled({ DO_NOT_TRACK: "TRUE", FRAMIO_TELEMETRY: "1" }, true),
  );
  assert.isTrue(telemetryEnabled({ FRAMIO_TELEMETRY: "1" }, false));
  assert.isFalse(telemetryEnabled({ FRAMIO_TELEMETRY: "off" }, true));
});
it("browser scrubbing preserves symbolication ids and drops user stack context", () => {
  const event = {
    event: "$exception",
    properties: {
      category: "unhandled_error",
      $current_url: "http://192.168.1.2:4000/#private",
      $session_entry_url: "http://192.168.1.2:4000/?private#private",
      $session_entry_host: "192.168.1.2:4000",
      $session_entry_title: "private project",
      $session_entry_pathname: "/private",
      $lib_custom_api_host: "http://192.168.1.2:4000",
      $referrer: "file:///Users/alice/project",
      $raw_user_agent: "private",
      $pathname: "/private",
      $exception_list: [
        {
          type: "Error",
          value: "Failed /Users/alice/private project/file.tsx",
          mechanism: { handled: true },
          stacktrace: {
            frames: [
              {
                filename: "http://192.168.1.2:4000/chunk-abc.js",
                lineno: 1,
                colno: 22,
                chunk_id: "test-chunk",
                context_line: "private code",
                pre_context: ["secret"],
                post_context: ["secret"],
              },
              {
                filename: "http://192.168.1.2:4000/f/private.tsx",
                context_line: "private code",
              },
            ],
          },
        },
      ],
    },
  } as unknown as CaptureResult;
  const result = scrub(event)!;
  const text = JSON.stringify(result);
  for (const secret of ["alice", "192.168", "private", "secret"])
    assert.notInclude(text, secret);
  assert.include(text, "test-chunk");
  assert.strictEqual(
    result.properties.$exception_list[0].mechanism.handled,
    false,
  );
  assert.strictEqual(
    result.properties.$exception_list[0].stacktrace.frames.length,
    1,
  );
});
