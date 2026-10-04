import { scrub } from "./analytics-privacy";
import * as Schema from "effect/Schema";
import type { PostHog } from "posthog-js";
import { StudioTelemetry } from "../../contracts/telemetry";

type Properties = Record<string, string | number | boolean | null>;

// The server omits the meta tag when telemetry is off, so nothing loads then.
const config = (() => {
  const content = document.querySelector<HTMLMetaElement>(
    'meta[name="framio-telemetry"]',
  )?.content;
  if (!content) return null;
  const decoded = Schema.decodeUnknownResult(
    Schema.fromJsonString(StudioTelemetry),
  )(content);
  return decoded._tag === "Success" ? decoded.success : null;
})();

let client: PostHog | null = null;
const pending: Array<[string, Properties | undefined]> = [];
const earlyErrors: Array<[unknown, Properties]> = [];
let starting = false;

export function reportError(category: string, properties: Properties = {}) {
  if (!config) return;
  const error = new Error(`Framio ${category} failed`);
  if (client) client.captureException(error, { category, ...properties });
  else if (earlyErrors.length < 50)
    earlyErrors.push([error, { category, ...properties }]);
}
const earlyError = (event: ErrorEvent) => {
  const error =
    event.error instanceof Error
      ? event.error
      : new Error("Studio unhandled error");
  if (client) client.captureException(error, { category: "unhandled_error" });
  else if (earlyErrors.length < 50)
    earlyErrors.push([error, { category: "unhandled_error" }]);
};
const earlyRejection = (event: PromiseRejectionEvent) => {
  const error =
    event.reason instanceof Error
      ? event.reason
      : new Error("Studio unhandled rejection");
  if (client)
    client.captureException(error, { category: "unhandled_rejection" });
  else if (earlyErrors.length < 50)
    earlyErrors.push([error, { category: "unhandled_rejection" }]);
};
if (config) {
  window.addEventListener("error", earlyError);
  window.addEventListener("unhandledrejection", earlyRejection);
}

export function startAnalytics() {
  if (!config || starting) return;
  starting = true;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(config.key, {
        api_host: config.host,
        defaults: "2026-05-30",
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        persistence: "memory",
        bootstrap: { distinctID: config.distinctId },
        person_profiles: "never",
        // Designs are the user's work: no replays, no element text, and no
        // attributes that echo layer names, comment bodies, or frame URLs.
        disable_session_recording: true,
        disable_surveys: true,
        mask_all_text: true,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        // Local listeners cover the import window and avoid a second remote script.
        capture_exceptions: false,
        before_send: scrub,
      });
      posthog.register({
        app: "studio",
        framio_version: config.version,
        os: config.os,
        arch: config.arch,
        compiled: config.compiled,
      });
      client = posthog;
      for (const [error, properties] of earlyErrors.splice(0))
        posthog.captureException(error, properties);
      for (const [event, properties] of pending.splice(0))
        posthog.capture(event, properties);
    })
    .catch(() => {
      pending.length = 0;
      earlyErrors.length = 0;
      window.removeEventListener("error", earlyError);
      window.removeEventListener("unhandledrejection", earlyRejection);
    });
}

export function track(event: string, properties?: Properties) {
  if (!config) return;
  if (client) client.capture(event, properties);
  else if (pending.length < 100) pending.push([event, properties]);
}
