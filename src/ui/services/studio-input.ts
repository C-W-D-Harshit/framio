import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Keep trackpad pinches owned by the canvas even over chrome or during selection. */
export const studioInputLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(() => {
      const controller = new AbortController();
      window.addEventListener(
        "wheel",
        (event) => {
          // Browsers encode trackpad pinch as Ctrl+wheel. Leave propagation intact
          // so React Flow still zooms, and leave ordinary panel scrolling alone.
          if (event.ctrlKey) event.preventDefault();
        },
        { capture: true, passive: false, signal: controller.signal },
      );
      return controller;
    }),
    (controller) => Effect.sync(() => controller.abort()),
  ),
);
