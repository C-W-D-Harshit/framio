import { randomUUID } from "node:crypto";
import {
  Cause,
  Clock,
  Context,
  DateTime,
  Effect,
  Exit,
  Layer,
  Logger,
  Predicate,
  Random,
  Ref,
  Semaphore,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { scrubTelemetryText } from "../contracts/telemetry-privacy";

export { scrubTelemetryText };
export const retryDelayMs = (failures: number, random: number) => {
  const ceiling = Math.min(300_000, 2_000 * 2 ** (failures - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * random);
};
export function exceptionProperties(
  error: unknown,
  category: string,
  message?: string,
) {
  const object = Predicate.isObject(error)
    ? (error as Record<string, unknown>)
    : {};
  const type =
    typeof object._tag === "string"
      ? object._tag
      : error instanceof Error
        ? error.name
        : "Error";
  const value = scrubTelemetryText(
    message ??
      (typeof object.message === "string"
        ? object.message
        : "Unexpected application failure"),
  );
  const frames = (
    typeof object.stack === "string" ? object.stack.split("\n").slice(1) : []
  )
    .flatMap((line) => {
      const match = line.match(/(?:at\s+(?:(.*?)\s+\()?)(.*?):(\d+):(\d+)\)?$/);
      if (!match) return [];
      // Keep product source locations only. User frames and source context never leave the machine.
      const product = match[2]!
        .replaceAll("\\", "/")
        .match(
          /(?:apps\/framio\/)?(src\/(?:services|server|commands|domain|contracts|lib)\/[^\s]+|src\/cli\.ts)/,
        );
      const filename =
        product?.[1] ?? (match[2]!.includes("$bunfs") ? "framio" : undefined);
      if (!filename) return [];
      return [
        {
          filename,
          function: scrubTelemetryText(match[1] ?? "anonymous"),
          lineno: Number(match[3]),
          colno: Number(match[4]),
          in_app: true,
        },
      ];
    })
    .slice(0, 30)
    .reverse();
  return {
    category,
    $exception_list: [
      {
        type: scrubTelemetryText(type),
        value,
        mechanism: { type: category, handled: category !== "cli_top_level" },
        stacktrace: { type: "raw", frames },
      },
    ],
    $exception_level: "error",
  };
}
export class Analytics extends Context.Service<
  Analytics,
  {
    record: (
      event: string,
      properties?: Record<string, unknown>,
    ) => Effect.Effect<void>;
    exception: (error: unknown, category: string) => Effect.Effect<void>;
    flush: Effect.Effect<void>;
    logger: Logger.Logger<unknown, void>;
  }
>()("framio/Analytics") {
  static readonly layerTest = Layer.succeed(Analytics, {
    record: () => Effect.void,
    exception: () => Effect.void,
    flush: Effect.void,
    logger: Logger.make(() => {}),
  });
}
type Event = {
  uuid: string;
  event: string;
  timestamp: string;
  properties: Record<string, unknown>;
};
export const makeAnalytics = Effect.fn("Analytics.make")(function* (config: {
  key: string;
  host: string;
  distinctId: string;
  common: Record<string, unknown>;
  maxBuffer?: number;
  batchSize?: number;
}) {
  const client = yield* HttpClient.HttpClient;
  const queue = yield* Ref.make<Event[]>([]);
  const delivery = yield* Ref.make({
    batch: [] as Event[],
    attempts: 0,
    failures: 0,
    retryAt: 0,
  });
  const lock = yield* Semaphore.make(1);
  const limit = Math.max(1, config.maxBuffer ?? 1000);
  const batchSize = Math.max(1, Math.min(limit, config.batchSize ?? 20));
  const enqueue = (
    event: string,
    properties: Record<string, unknown>,
    timestamp: string,
  ) =>
    Ref.update(queue, (events) => {
      const capacity = limit - Ref.getUnsafe(delivery).batch.length;
      if (capacity <= 0) return [];
      return [
        ...events,
        { uuid: randomUUID(), event, timestamp, properties },
      ].slice(-capacity);
    });
  const record = (event: string, properties: Record<string, unknown> = {}) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        enqueue(event, properties, DateTime.formatIso(now)),
      ),
    );
  const flush = Effect.gen(function* () {
    while (true) {
      const state = yield* Ref.get(delivery);
      const batch = state.batch.length
        ? state.batch
        : yield* Ref.modify(queue, (events) => [
            events.slice(0, batchSize),
            events.slice(batchSize),
          ]);
      if (!batch.length) return;
      yield* Ref.set(delivery, { ...state, batch });
      const sent = yield* Effect.exit(
        HttpClientRequest.post(`${config.host.replace(/\/$/, "")}/batch/`).pipe(
          HttpClientRequest.bodyJson({
            api_key: config.key,
            batch: batch.map((event) => ({
              ...event,
              distinct_id: config.distinctId,
              properties: {
                ...event.properties,
                ...config.common,
                $process_person_profile: false,
                $geoip_disable: true,
              },
            })),
          }),
          Effect.flatMap(client.execute),
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.timeout("10 seconds"),
        ),
      );
      if (Exit.isSuccess(sent)) {
        yield* Ref.set(delivery, {
          batch: [],
          attempts: 0,
          failures: 0,
          retryAt: 0,
        });
        continue;
      }
      const failures = state.failures + 1;
      const attempts = state.attempts + 1;
      yield* Ref.set(delivery, {
        batch: attempts < 5 ? batch : [],
        attempts: attempts < 5 ? attempts : 0,
        failures,
        retryAt:
          (yield* Clock.currentTimeMillis) +
          retryDelayMs(failures, yield* Random.next),
      });
      return;
    }
  }).pipe(lock.withPermit);
  yield* Effect.sleep("1 second").pipe(
    Effect.andThen(
      Effect.gen(function* () {
        if (
          (yield* Clock.currentTimeMillis) >= (yield* Ref.get(delivery)).retryAt
        )
          yield* flush;
      }),
    ),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() =>
    flush.pipe(Effect.timeoutOption("750 millis"), Effect.asVoid),
  );
  const logger = Logger.make<unknown, void>((options) => {
    if (options.logLevel !== "Error" && options.logLevel !== "Fatal") return;
    const messages = Array.isArray(options.message)
      ? options.message
      : [options.message];
    const reason = options.cause.reasons.find(
      (r) => !Cause.isInterruptReason(r),
    );
    const error = reason
      ? Cause.isFailReason(reason)
        ? reason.error
        : Cause.isDieReason(reason)
          ? reason.defect
          : undefined
      : messages.find((x) => x instanceof Error);
    const message =
      typeof messages[0] === "string" ? messages[0] : "Application error log";
    Effect.runSync(
      enqueue(
        "$exception",
        {
          ...exceptionProperties(error, "effect_log", message),
          log_level: options.logLevel,
        },
        options.date.toISOString(),
      ),
    );
  });
  return Analytics.of({
    record,
    flush,
    logger,
    exception: (error, category) =>
      record("$exception", exceptionProperties(error, category)),
  });
});
export const analyticsLogger = Logger.layer(
  [Effect.map(Analytics, (service) => service.logger)],
  { mergeWithExisting: true },
);
export const recordIfAvailable = (
  event: string,
  properties: Record<string, unknown>,
) =>
  Effect.serviceOption(Analytics).pipe(
    Effect.flatMap((service) =>
      service._tag === "Some"
        ? service.value.record(event, properties)
        : Effect.void,
    ),
  );
