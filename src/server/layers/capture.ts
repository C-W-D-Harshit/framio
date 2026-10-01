import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { dirname, basename, join } from "node:path";
import { chromiumOperation } from "../../platform/chromium";
import { layerCrop, resolveLayer } from "../../domain/layers";
import { CaptureFailed } from "../../domain/errors";
import type { LayerReport } from "../../contracts/layers";
export type LayerShot = {
  path: string;
  width: number;
  height: number;
  error: string | null;
  report?: LayerReport;
  crops?: {
    path: string;
    layer: string;
    width: number;
    height: number;
    scale: number;
  }[];
};
export const captureFrameLayers = Effect.fn("Layers.capture")(function* (
  page: Page,
  out: string,
  width: number,
  fullHeight: number,
  error: string | null,
  layers: readonly string[],
  inspectOnly: boolean,
  write: (out: string, bytes: Uint8Array) => Effect.Effect<void, CaptureFailed>,
  emitLayers = true,
) {
  if (!emitLayers) {
    yield* write(
      out,
      yield* chromiumOperation(() => page.screenshot({ type: "png" })),
    );
    return { path: out, width, height: fullHeight, error };
  }
  const report = yield* chromiumOperation(() =>
    page.evaluate((width) => window.__framio.layers(width), width),
  );
  const missing = layers.find((path) => !resolveLayer(report.tree, path));
  if (missing)
    return {
      path: "",
      width,
      height: fullHeight,
      error: `No layer "${missing}".`,
      report,
      crops: [],
    };
  const chosen = layers.length
    ? layers.map((path) => resolveLayer(report.tree, path)!)
    : report.tree;
  const crops: NonNullable<LayerShot["crops"]> = [];
  if (!inspectOnly) {
    if (!layers.length)
      yield* write(
        out,
        yield* chromiumOperation(() => page.screenshot({ type: "png" })),
      );
    const directory = join(dirname(out), `${basename(out, ".png")}.layers`);
    for (const [index, node] of chosen.entries()) {
      const crop = layerCrop(node.box, width, fullHeight);
      yield* chromiumOperation(() =>
        page.setViewport({
          width,
          height: fullHeight,
          deviceScaleFactor: crop.scale,
        }),
      );
      const safeName =
        node.path
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 100) || "layer";
      const path = join(
        directory,
        `${String(index + 1).padStart(2, "0")}-${safeName}.png`,
      );
      yield* write(
        path,
        yield* chromiumOperation(() =>
          page.screenshot({ type: "png", clip: crop.clip }),
        ),
      );
      crops.push({
        path,
        layer: node.path,
        width: Math.round(crop.clip.width * crop.scale),
        height: Math.round(crop.clip.height * crop.scale),
        scale: crop.scale,
      });
    }
  }
  return {
    path: layers.length || inspectOnly ? "" : out,
    width,
    height: fullHeight,
    error,
    report,
    crops,
  };
});
