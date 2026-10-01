import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
} from "@puppeteer/browsers";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { BrowserUnavailable } from "../domain/errors";
import { BROWSERS_DIR } from "./paths";
const BROWSER = Browser.CHROMEHEADLESSSHELL;
const BUILD_ID = "154.0.8037.57";
export function browserExecutablePath() {
  return computeExecutablePath({
    browser: BROWSER,
    buildId: BUILD_ID,
    cacheDir: BROWSERS_DIR,
  });
}
export const isBrowserInstalled = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.exists(browserExecutablePath()),
);
/** The upstream downloader is the only native Promise operation in discovery. */
export const ensureBrowser = Effect.fn("Browser.ensure")(
  function* () {
    if (yield* isBrowserInstalled) return browserExecutablePath();
    const platform = detectBrowserPlatform();
    if (!platform)
      return yield* new BrowserUnavailable({
        message: "Unsupported platform for the screenshot browser.",
      });
    const installed = yield* Effect.tryPromise({
      try: () =>
        install({
          browser: BROWSER,
          buildId: BUILD_ID,
          cacheDir: BROWSERS_DIR,
          platform,
        }),
      catch: (cause) => new BrowserUnavailable({ message: String(cause) }),
    });
    return installed.executablePath;
  },
  Effect.mapError((error) =>
    error._tag === "BrowserUnavailable"
      ? error
      : new BrowserUnavailable({ message: error.message }),
  ),
);
