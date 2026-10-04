import type { CaptureResult } from "posthog-js";
import { scrubTelemetryText } from "../../contracts/telemetry-privacy";

// Page hashes and LAN addresses describe the user's project, not the studio.
const scrubUrl = (value: unknown, chunk = false) => {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    return `${url.protocol}//studio${chunk ? url.pathname : "/"}`;
  } catch {
    return "studio";
  }
};
export const scrub = (event: CaptureResult | null) => {
  if (!event) return null;
  for (const [key, value] of Object.entries(event.properties)) {
    if (typeof value !== "string") continue;
    if (/title|raw_user_agent/.test(key)) {
      delete event.properties[key];
      continue;
    }
    if (/pathname/.test(key)) event.properties[key] = "/";
    else if (/host|domain/.test(key))
      event.properties[key] = value.startsWith("$") ? value : "studio";
    else if (/url|referrer/.test(key) || /^[a-z]+:\/\//i.test(value))
      event.properties[key] = value.startsWith("$") ? value : scrubUrl(value);
  }
  if (Array.isArray(event.properties.$exception_list)) {
    for (const exception of event.properties.$exception_list) {
      exception.value = scrubTelemetryText(
        String(exception.value ?? "Studio failure"),
      );
      if (
        ["unhandled_error", "unhandled_rejection"].includes(
          String(event.properties.category),
        ) &&
        exception.mechanism
      )
        exception.mechanism.handled = false;
      exception.type = scrubTelemetryText(String(exception.type ?? "Error"));
      const frames = exception.stacktrace?.frames;
      if (Array.isArray(frames))
        exception.stacktrace.frames = frames
          .filter(
            (frame: { filename?: string }) =>
              typeof frame.filename === "string" &&
              /^(?:https?:\/\/[^/]+)?\/(?:index|chunk|posthog)[^/]*\.js(?:[?#]|$)/.test(
                frame.filename,
              ),
          )
          .map(
            (frame: {
              filename: string;
              function?: string;
              lineno?: number;
              colno?: number;
            }) => ({
              filename: scrubUrl(frame.filename, true),
              function: scrubTelemetryText(frame.function ?? "anonymous"),
              lineno: frame.lineno,
              colno: frame.colno,
              chunk_id: "chunk_id" in frame ? frame.chunk_id : undefined,
            }),
          );
    }
  }
  for (const key of ["$exception_message", "$exception_type"])
    if (typeof event.properties[key] === "string")
      event.properties[key] = scrubTelemetryText(event.properties[key]);
  delete event.properties.$exception_steps;
  delete event.properties.$raw_user_agent;
  event.properties.$geoip_disable = true;
  event.properties.$process_person_profile = false;
  // Super properties added by the SDK can include the host in this field.
  if ("$pathname" in event.properties) event.properties.$pathname = "/";
  return event;
};
