import { Console, Effect } from "effect";
import {
  readTelemetry,
  setTelemetry,
  telemetryEnabled,
} from "../services/telemetry";
import { InvalidInput } from "../domain/errors";

export const telemetry = Effect.fn("telemetry")(function* (
  action: "status" | "on" | "off",
) {
  if (action !== "status" && !(yield* setTelemetry(action === "on")))
    return yield* new InvalidInput({
      message: "Could not save telemetry preference",
    });
  const saved = yield* readTelemetry();
  const enabled = telemetryEnabled(process.env, saved?.enabled);
  yield* Console.log(
    `Telemetry: ${enabled ? "on" : "off"}. Saved preference: ${saved?.enabled === undefined ? "default" : saved.enabled ? "on" : "off"}. Environment variables override the preference. Source checkouts require FRAMIO_TELEMETRY=1. Restart running servers after changing telemetry.`,
  );
});
