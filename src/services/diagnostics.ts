import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
export const Diagnostics = {
  builds: Metric.counter("framio.builds"),
  buildDuration: Metric.timer("framio.build.duration"),
  pendingFiles: Metric.gauge("framio.build.pending_files"),
  captureDuration: Metric.timer("framio.capture.duration"),
  captures: Metric.counter("framio.captures"),
  activeCaptures: Metric.gauge("framio.capture.active"),
  cleanupFailures: Metric.counter("framio.cleanup.failures"),
};
export const measure = <A, E, R>(
  timer: Metric.Metric<Duration.Duration, unknown>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    return yield* effect.pipe(
      Effect.ensuring(
        Effect.flatMap(Clock.currentTimeMillis, (end) =>
          Metric.update(timer, Duration.millis(end - start)),
        ),
      ),
    );
  });
