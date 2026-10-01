import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
} from "@puppeteer/browsers";
import { existsSync } from "node:fs";
import { BROWSERS_DIR } from "./paths";

/**
 * Framio downloads its own headless Chromium into ~/.framio/browsers so screenshots
 * never depend on which browser (if any) the user has installed.
 * Pinned to the revision puppeteer-core is tested against.
 */
const BROWSER = Browser.CHROMEHEADLESSSHELL;
const BUILD_ID = "154.0.8037.57";

export function browserExecutablePath() {
  return computeExecutablePath({ browser: BROWSER, buildId: BUILD_ID, cacheDir: BROWSERS_DIR });
}

export function isBrowserInstalled() {
  return existsSync(browserExecutablePath());
}

export async function ensureBrowser(): Promise<string> {
  if (isBrowserInstalled()) return browserExecutablePath();
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Unsupported platform for the screenshot browser.");
  const installed = await install({ browser: BROWSER, buildId: BUILD_ID, cacheDir: BROWSERS_DIR, platform });
  return installed.executablePath;
}
