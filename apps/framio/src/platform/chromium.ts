import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import { Diagnostics } from "../services/diagnostics";
import puppeteer, { type Page } from "puppeteer-core";
import { ensureBrowser } from "../lib/browser";
import { BrowserUnavailable, CaptureFailed } from "../domain/errors";

export const chromiumOperation = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new CaptureFailed({ message: String(cause) }),
  });

const close = (operation: () => Promise<void>) =>
  chromiumOperation(operation).pipe(
    Effect.timeoutOption("10 seconds"),
    Effect.catch((error) =>
      Metric.update(Diagnostics.cleanupFailures, 1).pipe(
        Effect.andThen(
          Effect.logWarning("Chromium cleanup failed", error.message),
        ),
      ),
    ),
    Effect.asVoid,
  );

export const acquireChromium = Effect.acquireRelease(
  Effect.flatMap(ensureBrowser(), (executablePath) =>
    Effect.tryPromise({
      try: () =>
        puppeteer.launch({
          executablePath,
          headless: true,
          args: ["--hide-scrollbars"],
          timeout: 30_000,
        }),
      catch: (cause) =>
        new BrowserUnavailable({
          message: `Could not start the screenshot browser. Live previews still work. Check Chromium's system libraries and sandbox support. ${String(cause)}`,
        }),
    }),
  ),
  (browser) => close(() => browser.close()),
);

export const closeChromiumPage = (page: Page) => close(() => page.close());
