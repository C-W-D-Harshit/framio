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
type CaptureOptions = {
  layers?: readonly string[];
  inspectOnly?: boolean;
  emitLayers?: boolean;
  generation?: string;
};
export class Screenshots extends Context.Service<
  Screenshots,
  {
    capture: (
      frame: Frame,
      out: string,
      scale?: number,
      options?: CaptureOptions,
    ) => Effect.Effect<Shot, CaptureError>;
    captureUrl: (
      url: string,
      out: string,
      width: number,
      height: number,
      scale?: number,
      viewportOnly?: boolean,
    ) => Effect.Effect<Shot, CaptureError>;
    compare: (
      design: Shot,
      implementation: Shot,
      out: string,
      scale?: number,
    ) => Effect.Effect<Omit<Shot, "error">, CaptureError>;
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
            {
              layers = [],
              inspectOnly = false,
              emitLayers = true,
              generation,
            }: CaptureOptions = {},
          ) =>
            resources.withPage((page) =>
              Effect.gen(function* () {
                const { width, height } = frame.meta;
                yield* chromiumOperation(() =>
                  page.setViewport({ width, height, deviceScaleFactor: scale }),
                );
                if (frame.kind === "image") {
                  if (layers.length)
                    return yield* new CaptureFailed({
                      message: "Image frames have no DOM layers.",
                    });
                  const src = `${baseUrl}/img/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}?${generation ? `g=${generation}` : `v=${Date.now()}`}`;
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
                    `${baseUrl}/f/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}?width=${frame.meta.width}&height=${frame.meta.height}${generation ? `&g=${generation}` : ""}${!emitLayers ? "&preview=1" : ""}`,
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

        const captureUrl = Effect.fn("Screenshots.captureUrl")(
          (
            url: string,
            out: string,
            width: number,
            height: number,
            scale = 1,
            viewportOnly = false,
          ) =>
            resources
              .withPage((page) =>
                Effect.gen(function* () {
                  yield* chromiumOperation(() =>
                    page.setViewport({
                      width,
                      height,
                      deviceScaleFactor: scale,
                    }),
                  );
                  const response = yield* chromiumOperation(() =>
                    page.goto(url, { waitUntil: "load", timeout: 20_000 }),
                  );
                  if (response && response.status() >= 400)
                    return yield* new CaptureFailed({
                      message: `URL returned HTTP ${response.status()}: ${url}`,
                    });
                  yield* chromiumOperation(() =>
                    page.evaluate(async (viewportOnly) => {
                      const pause = (milliseconds: number) =>
                        new Promise<void>((resolve) =>
                          setTimeout(resolve, milliseconds),
                        );
                      const root = document.documentElement;
                      const scrollBehavior =
                        root.style.getPropertyValue("scroll-behavior");
                      const scrollPriority =
                        root.style.getPropertyPriority("scroll-behavior");
                      root.style.setProperty(
                        "scroll-behavior",
                        "auto",
                        "important",
                      );
                      try {
                        // Visit below-fold content so lazy images and entrance effects can appear.
                        const deadline = performance.now() + 8_000;
                        await pause(250);
                        let top = 0;
                        for (
                          let step = 0;
                          step < (viewportOnly ? 0 : 24) &&
                          performance.now() < deadline;
                          step++
                        ) {
                          window.scrollTo(0, top);
                          await pause(120);
                          const bottom = Math.max(
                            root.scrollHeight,
                            document.body?.scrollHeight ?? 0,
                          );
                          if (top + innerHeight >= bottom) break;
                          top = Math.min(
                            top + Math.max(200, innerHeight * 0.8),
                            bottom - innerHeight,
                          );
                        }
                        window.scrollTo(0, 0);
                        await pause(800);
                      } finally {
                        if (scrollBehavior)
                          root.style.setProperty(
                            "scroll-behavior",
                            scrollBehavior,
                            scrollPriority,
                          );
                        else root.style.removeProperty("scroll-behavior");
                      }
                      await document.fonts.ready;
                      await Promise.race([
                        Promise.allSettled(
                          [...document.images].map((img) => img.decode()),
                        ),
                        pause(2_000),
                      ]);
                      await new Promise<void>((resolve) =>
                        requestAnimationFrame(() =>
                          requestAnimationFrame(() => resolve()),
                        ),
                      );
                    }, viewportOnly),
                  ).pipe(
                    Effect.timeout("20 seconds"),
                    Effect.mapError(
                      (error) =>
                        new CaptureFailed({
                          message: `URL did not become ready: ${url}: ${error.message}`,
                        }),
                    ),
                  );
                  const fullHeight = yield* chromiumOperation(() =>
                    page.evaluate(() =>
                      Math.max(
                        innerHeight,
                        document.documentElement.scrollHeight,
                        document.body?.scrollHeight ?? 0,
                      ),
                    ),
                  );
                  yield* write(
                    out,
                    yield* chromiumOperation(() =>
                      page.screenshot({ type: "png", fullPage: !viewportOnly }),
                    ),
                  );
                  return {
                    path: out,
                    width,
                    height: viewportOnly ? height : fullHeight,
                    error: null,
                  };
                }),
              )
              .pipe(
                Effect.mapError(
                  (error) =>
                    new CaptureFailed({
                      message: `Could not capture ${url}: ${error.message}`,
                    }),
                ),
              ),
        );
        const compare = Effect.fn("Screenshots.compare")(
          function* (
            design: Shot,
            implementation: Shot,
            out: string,
            scale = 1,
          ) {
            const sources = yield* Effect.forEach(
              [design, implementation],
              (shot) => fs.readFile(shot.path),
            );
            return yield* resources.withPage((page) =>
              Effect.gen(function* () {
                const width = design.width + implementation.width + 48;
                const height =
                  Math.max(design.height, implementation.height) + 64;
                const html = `<html><body style="margin:0;background:#262626;color:white;font:16px system-ui;display:flex;gap:16px;padding:16px">${[design, implementation].map((shot, i) => `<div><div style="height:32px">${i === 0 ? "Design" : "Implementation"}</div><img style="display:block;width:${shot.width}px;height:${shot.height}px" src="data:image/png;base64,${Buffer.from(sources[i]!).toString("base64")}"></div>`).join("")}</body></html>`;
                yield* chromiumOperation(() =>
                  page.setViewport({ width, height, deviceScaleFactor: scale }),
                );
                yield* chromiumOperation(() =>
                  page.setContent(html, { waitUntil: "load" }),
                );
                yield* chromiumOperation(() =>
                  page.evaluate(async () => {
                    await Promise.all(
                      [...document.images].map((img) => img.decode()),
                    );
                  }),
                );
                yield* write(
                  out,
                  yield* chromiumOperation(() =>
                    page.screenshot({ type: "png" }),
                  ),
                );
                return { path: out, width, height };
              }),
            );
          },
          Effect.mapError(
            (error) => new CaptureFailed({ message: error.message }),
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
        return Screenshots.of({ capture, captureUrl, compare, compose });
      }),
    );
  }
}
