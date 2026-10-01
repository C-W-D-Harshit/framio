import { captureFrameLayers, type LayerShot } from "../server/layers/capture";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Frame } from "../domain/project";
import { makeCaptureResources } from "./capture-resources";
import {
  acquireChromium,
  chromiumOperation,
  closeChromiumPage,
} from "../platform/chromium";
import {
  composePageHtml,
  type PageShotFrame,
} from "../server/page-composition";
import { BrowserUnavailable, CaptureFailed } from "../domain/errors";

type Shot = LayerShot;
type CaptureError = CaptureFailed | BrowserUnavailable;
export class Screenshots extends Context.Service<
  Screenshots,
  {
    capture: (
      frame: Frame,
      out: string,
      scale?: number,
      layers?: readonly string[],
      width?: number,
      inspectOnly?: boolean,
      emitLayers?: boolean,
    ) => Effect.Effect<Shot, CaptureError>;
    compose: (
      frames: readonly PageShotFrame[],
      positions: Record<string, { x: number; y: number }>,
      out: string,
      scale?: number,
    ) => Effect.Effect<Omit<Shot, "error">, CaptureError>;
  }
>()("framio/services/Screenshots") {
  static layer(baseUrl: string) {
    return Layer.effect(
      Screenshots,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const resources = yield* makeCaptureResources({
          acquireBrowser: acquireChromium.pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
          ),
          openPage: (browser) => chromiumOperation(() => browser.newPage()),
          closePage: closeChromiumPage,
          isConnected: (browser) => browser.connected,
        });
        const write = Effect.fn("Screenshots.write")(
          function* (out: string, bytes: Uint8Array) {
            yield* fs.makeDirectory(dirname(out), { recursive: true });
            const temporary = `${out}.${randomUUID()}.tmp`;
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  fs
                    .remove(temporary, { force: true })
                    .pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(
                          "Screenshot temporary file cleanup failed",
                          error.message,
                        ),
                      ),
                    ),
                );
                yield* fs.writeFile(temporary, bytes);
                yield* fs.rename(temporary, out);
              }),
            );
          },
          Effect.mapError(
            (cause) =>
              new CaptureFailed({
                message: `Could not write screenshot: ${cause.message}`,
              }),
          ),
        );

        const capture = Effect.fn("Screenshots.capture")(
          (
            frame: Frame,
            out: string,
            scale = 1,
            layers: readonly string[] = [],
            viewportWidth = frame.meta.width,
            inspectOnly = false,
            emitLayers = true,
          ) =>
            resources.withPage((page) =>
              Effect.gen(function* () {
                const { height } = frame.meta;
                const width = viewportWidth; // TODO responsive frames: wire CLI --width and per-width filenames.
                yield* chromiumOperation(() =>
                  page.setViewport({ width, height, deviceScaleFactor: scale }),
                );
                if (frame.kind === "image") {
                  const src = `${baseUrl}/img/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}?v=${Date.now()}`;
                  yield* chromiumOperation(() =>
                    page.setContent(
                      `<html><body style="margin:0"><img src="${src}" style="display:block;width:${width}px;height:${height}px"></body></html>`,
                    ),
                  );
                  yield* chromiumOperation(() =>
                    page.evaluate(async () => {
                      await document.querySelector("img")!.decode();
                    }),
                  );
                  yield* write(
                    out,
                    yield* chromiumOperation(() =>
                      page.screenshot({ type: "png" }),
                    ),
                  );
                  return {
                    path: out,
                    width,
                    height,
                    error: frame.metaError ?? null,
                  };
                }
                yield* chromiumOperation(() =>
                  page.goto(
                    `${baseUrl}/f/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}`,
                  ),
                );
                yield* chromiumOperation(() =>
                  page.waitForFunction(
                    "window.__framio && (window.__framio.ready || window.__framio.error)",
                    { timeout: 20_000 },
                  ),
                );
                const state = yield* chromiumOperation(() =>
                  page.evaluate(() => ({
                    error: window.__framio.error,
                    height: window.__framio.contentHeight(),
                  })),
                );
                const fullHeight = Math.max(
                  1,
                  Math.ceil(state.height || height),
                );
                yield* chromiumOperation(() =>
                  page.setViewport({
                    width,
                    height: fullHeight,
                    deviceScaleFactor: scale,
                  }),
                );
                yield* chromiumOperation(() =>
                  page.evaluate(
                    () =>
                      new Promise<void>((resolve) =>
                        requestAnimationFrame(() =>
                          requestAnimationFrame(() => resolve()),
                        ),
                      ),
                  ),
                );
                return yield* captureFrameLayers(
                  page,
                  out,
                  width,
                  fullHeight,
                  state.error,
                  layers,
                  inspectOnly,
                  write,
                  emitLayers,
                );
              }),
            ),
        );

        const compose = Effect.fn("Screenshots.compose")(
          (
            frames: readonly PageShotFrame[],
            positions: Record<string, { x: number; y: number }>,
            out: string,
            scale = 1,
          ) =>
            resources.withPage((page) =>
              Effect.gen(function* () {
                const rendered = composePageHtml(
                  baseUrl,
                  frames,
                  positions,
                  scale,
                );
                yield* chromiumOperation(() =>
                  page.setViewport({
                    width: rendered.width,
                    height: rendered.height,
                    deviceScaleFactor: rendered.scale,
                  }),
                );
                yield* chromiumOperation(() =>
                  page.setContent(rendered.html, { waitUntil: "load" }),
                );
                yield* write(
                  out,
                  yield* chromiumOperation(() =>
                    page.screenshot({ type: "png" }),
                  ),
                );
                return {
                  path: out,
                  width: Math.round(rendered.width * rendered.scale),
                  height: Math.round(rendered.height * rendered.scale),
                };
              }),
            ),
        );
        return Screenshots.of({ capture, compose });
      }),
    );
  }
}
