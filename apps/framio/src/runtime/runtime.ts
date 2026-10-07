import { measureLayers } from "./layers";
import { installCanvasEdits } from "./canvas-edits";
import type { LayerReport } from "../contracts/layers";
/**
 * Injected into every frame document (classic script, runs before the frame bundle).
 * - exposes readiness + content height for screenshots
 * - shows build/runtime errors inside the frame and reports them to the server
 * - in canvas mode: element hover/selection, and forwards wheel events to the canvas
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
const BootSchema = Schema.Struct({
  id: Schema.String,
  canvas: Schema.Boolean,
  preview: Schema.optional(Schema.Boolean),
  width: Schema.optional(Schema.Finite),
  viewportId: Schema.optional(Schema.String),
  error: Schema.NullOr(Schema.String),
  version: Schema.optional(Schema.Finite),
});
type Boot = typeof BootSchema.Type;

declare global {
  interface Window {
    __FRAMIO_BOOT__: Boot;
    __framio: {
      ready: boolean;
      error: string | null;
      contentHeight(): number;
      layers(width?: number): LayerReport;
      reportError(error: unknown, componentStack?: string): void;
    };
  }
}

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* Effect.acquireRelease(
        Effect.sync(() => new AbortController()),
        (controller) => Effect.sync(() => controller.abort()),
      );
      const observers: { disconnect(): void }[] = [];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const observer of observers) observer.disconnect();
        }),
      );
      const windowEvents = {
        addEventListener<K extends keyof WindowEventMap>(
          type: K,
          listener: (event: WindowEventMap[K]) => void,
          options?: boolean | AddEventListenerOptions,
        ) {
          window.addEventListener(type, listener, {
            ...(typeof options === "boolean" ? { capture: options } : options),
            signal: controller.signal,
          });
        },
      };
      const documentEvents = {
        addEventListener<K extends keyof DocumentEventMap>(
          type: K,
          listener: (event: DocumentEventMap[K]) => void,
          options?: boolean | AddEventListenerOptions,
        ) {
          document.addEventListener(type, listener, {
            ...(typeof options === "boolean" ? { capture: options } : options),
            signal: controller.signal,
          });
        },
      };
      const observe = (callback: ResizeObserverCallback) => {
        const observer = new ResizeObserver(callback);
        observers.push(observer);
        return observer;
      };
      const statuses = yield* Queue.sliding<string | null>(1);
      const cssVersions = yield* Queue.sliding<number>(1);
      let latestCssVersion = -1;
      yield* Effect.forever(
        Effect.gen(function* () {
          const version = yield* Queue.take(cssVersions);
          yield* Effect.callback<void>((resume) => {
            const previous = [
              ...document.querySelectorAll<HTMLLinkElement>(
                'link[href^="/_theme.css"]',
              ),
            ];
            if (!previous.length) {
              resume(Effect.void);
              return;
            }
            const next = previous[0]!.cloneNode() as HTMLLinkElement;
            // Load without applying until the newest requested stylesheet is ready.
            next.media = "not all";
            next.href = `/_theme.css?v=${version}`;
            let committed = false;
            const dispose = () => {
              next.onload = null;
              next.onerror = null;
              if (!committed) next.remove();
            };
            next.onload = () => {
              if (version === latestCssVersion) {
                next.media = previous[0]!.media;
                committed = true;
                for (const link of previous) link.remove();
                Queue.offerUnsafe(layerUpdates, undefined);
              }
              dispose();
              resume(Effect.void);
            };
            next.onerror = () => {
              dispose();
              resume(Effect.void);
            };
            previous[0]!.after(next);
            return Effect.sync(dispose);
          }).pipe(
            Effect.timeout("8 seconds"),
            Effect.catch(() => Effect.void),
          );
        }),
      ).pipe(Effect.forkScoped);
      const boot = yield* Schema.decodeUnknownEffect(BootSchema)(
        window.__FRAMIO_BOOT__,
      );
      const inCanvas = boot.canvas && window.parent !== window;

      function contentHeight() {
        const root = document.getElementById("root");
        const h = root
          ? Math.ceil(
              Math.max(root.getBoundingClientRect().height, root.scrollHeight),
            )
          : 0;
        return h > 0 ? h : Math.max(window.innerHeight, 1);
      }

      function postParent(msg: Record<string, unknown>) {
        if (inCanvas)
          window.parent.postMessage(
            { source: "framio", frame: boot.viewportId ?? boot.id, ...msg },
            "*",
          );
      }

      let latestReport: LayerReport | undefined;
      let canvasEdits: ReturnType<typeof installCanvasEdits> | undefined;
      function reportStatus(error: string | null) {
        if (boot.preview) return;
        Queue.offerUnsafe(statuses, error);
      }
      yield* Effect.forever(
        Effect.gen(function* () {
          const error = yield* Queue.take(statuses);
          yield* Effect.tryPromise({
            try: (signal) =>
              fetch("/api/frame-status", {
                method: "POST",
                signal,
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  id: boot.id,
                  width: boot.width,
                  version: boot.version,
                  error,
                  warnings: window.__framio?.ready
                    ? latestReport?.warnings
                    : undefined,
                }),
              }),
            catch: (cause) => cause,
          }).pipe(Effect.catch(() => Effect.void));
        }),
      ).pipe(Effect.forkScoped);

      function showError(message: string) {
        let el = document.getElementById("__framio_error");
        if (!el) {
          el = document.createElement("pre");
          el.id = "__framio_error";
          el.setAttribute(
            "style",
            "position:fixed;inset:0;margin:0;padding:32px;background:#1a0f0f;color:#ffb4b4;font:13px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow:auto;z-index:2147483647",
          );
          document.documentElement.appendChild(el);
        }
        el.textContent = `Frame error: ${boot.id}\n\n${message}`;
      }

      /** Bundled stack traces point at generated code, so report the message plus React's component stack. */
      function errorMessage(error: unknown, componentStack?: string) {
        const message =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error);
        const components = (componentStack ?? "")
          .split("\n")
          .map((l) => l.trim().replace(/\s*\(http.*\)$/, ""))
          .filter(Boolean)
          .slice(0, 6);
        return components.length
          ? `${message}\n\nComponent stack:\n  ${components.join("\n  ")}`
          : message;
      }

      window.__framio = {
        ready: false,
        error: boot.error,
        contentHeight,
        layers: measureLayers,
        reportError(error, componentStack) {
          if (window.__framio.error) return;
          const message = errorMessage(error, componentStack);
          window.__framio.error = message;
          showError(message);
          reportStatus(message);
          postParent({ type: "error", error: message });
        },
      };

      windowEvents.addEventListener("error", (e) =>
        window.__framio.reportError(e.error ?? e.message),
      );
      windowEvents.addEventListener("unhandledrejection", (e) =>
        window.__framio.reportError(e.reason),
      );

      if (boot.error) {
        documentEvents.addEventListener("DOMContentLoaded", () =>
          showError(boot.error!),
        );
        postParent({ type: "error", error: boot.error });
      }

      // --- Readiness: rendered, fonts loaded, images decoded, two frames painted ---
      const painted = Effect.callback<void>((resume) => {
        const id = requestAnimationFrame(() => resume(Effect.void));
        return Effect.sync(() => cancelAnimationFrame(id));
      });
      const waitForReady = Effect.gen(function* () {
        let root = document.getElementById("root");
        while (!root || root.childNodes.length === 0) {
          yield* painted;
          root = document.getElementById("root");
        }
        yield* Effect.tryPromise(() => document.fonts.ready);
        yield* Effect.forEach(
          [...root.querySelectorAll("img")],
          (img) =>
            Effect.tryPromise({
              try: () => img.decode(),
              catch: () =>
                new Error(
                  `Image failed to decode: ${img.getAttribute("src") ?? "unknown source"}`,
                ),
            }),
          { concurrency: 8, discard: true },
        );
        yield* painted;
        yield* painted;
        if (!window.__framio.error) {
          window.__framio.ready = true;
          postParent({ type: "ready", height: contentHeight() });
          canvasEdits?.ready();
          publishLayers();
        }
      }).pipe(
        Effect.timeout("20 seconds"),
        Effect.catch((error) =>
          Effect.sync(() => window.__framio.reportError(error)),
        ),
      );
      if (!boot.error) yield* Effect.forkScoped(waitForReady);

      function publishLayers() {
        if (boot.preview) return;
        const report = (latestReport = measureLayers());
        postParent({ type: "layers", report });
        reportStatus(window.__framio.error);
      }
      const layerUpdates = yield* Queue.sliding<void>(1);
      yield* Effect.forever(
        Effect.gen(function* () {
          yield* Queue.take(layerUpdates);
          yield* Effect.sleep(500);
          if (window.__framio.ready) publishLayers();
        }),
      ).pipe(Effect.forkScoped);
      documentEvents.addEventListener("DOMContentLoaded", () => {
        const root = document.getElementById("root");
        if (!root || boot.preview) return;
        const observer = new MutationObserver(() =>
          Queue.offerUnsafe(layerUpdates, undefined),
        );
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            "class",
            "style",
            "hidden",
            "src",
            "width",
            "height",
            "open",
            "aria-label",
            "data-layer",
            "data-layer-path",
            "role",
            "aria-hidden",
            "data-framio-layer",
            "data-framio-name",
          ],
          characterData: true,
        });
        observers.push(observer);
        observe(() => Queue.offerUnsafe(layerUpdates, undefined)).observe(root);
      });

      // --- Canvas mode ---
      if (inCanvas) {
        let lastHeight = 0;
        const sendSize = () => {
          const height = contentHeight();
          if (height !== lastHeight) {
            lastHeight = height;
            postParent({ type: "size", height });
          }
        };
        documentEvents.addEventListener("DOMContentLoaded", () => {
          const ro = observe(sendSize);
          ro.observe(document.documentElement);
          const root = document.getElementById("root");
          if (root) ro.observe(root);
        });

        /** Converts a point in this frame to client coordinates of the canvas page. */
        const toParent = (x: number, y: number) => {
          const frameEl = window.frameElement as HTMLIFrameElement | null;
          if (!frameEl) return { x, y };
          const rect = frameEl.getBoundingClientRect();
          const scale = rect.width / window.innerWidth;
          return { x: rect.left + x * scale, y: rect.top + y * scale };
        };

        // Capture before design content can stop propagation and let a pinch zoom the browser.
        // Wheel events inside an iframe never reach the canvas, so re-dispatch them on the iframe element.
        windowEvents.addEventListener(
          "wheel",
          (e) => {
            e.preventDefault();
            const frameEl = window.frameElement as HTMLIFrameElement | null;
            if (!frameEl) return;
            const at = toParent(e.clientX, e.clientY);
            const ParentWheel = (
              frameEl.ownerDocument.defaultView as typeof window
            ).WheelEvent;
            frameEl.dispatchEvent(
              new ParentWheel("wheel", {
                bubbles: true,
                cancelable: true,
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                deltaMode: e.deltaMode,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
                clientX: at.x,
                clientY: at.y,
              }),
            );
          },
          { passive: false, capture: true },
        );

        canvasEdits = installCanvasEdits({
          events: windowEvents,
          observe,
          registerObserver: (observer) => observers.push(observer),
          post: postParent,
          describe,
          toParent,
          updateCss(version) {
            if (version <= latestCssVersion) return;
            latestCssVersion = version;
            Queue.offerUnsafe(cssVersions, version);
          },
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => canvasEdits?.dispose()),
        );
      }

      function cssPath(el: Element): string {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node.id !== "root" && node !== document.body) {
          const parent: Element | null = node.parentElement;
          let part = node.tagName.toLowerCase();
          if (parent) {
            const same = [...parent.children].filter(
              (c) => c.tagName === node!.tagName,
            );
            if (same.length > 1)
              part += `:nth-of-type(${same.indexOf(node) + 1})`;
          }
          parts.unshift(part);
          node = parent;
        }
        return ["#root", ...parts].join(" > ");
      }

      function describe(el: Element) {
        const r = el.getBoundingClientRect();
        const html = el.outerHTML;
        return {
          selector: cssPath(el),
          tag: el.tagName.toLowerCase(),
          className: el.getAttribute("class") ?? "",
          dataSlot: el.getAttribute("data-slot") ?? undefined,
          text: (el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300),
          html: html.length > 3000 ? `${html.slice(0, 3000)}…` : html,
          rect: {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
        };
      }

      // Host unload only signals the scope; fibers, RAFs, observers and listeners release there.
      yield* Effect.callback<void>((resume) => {
        const done = () => resume(Effect.void);
        window.addEventListener("pagehide", done, { once: true });
        return Effect.sync(() => window.removeEventListener("pagehide", done));
      });
    }),
  ).pipe(
    Effect.catch((error) => Effect.logError("Frame runtime failed", error)),
  ),
);
export {};
