/**
 * Injected into every frame document (classic script, runs before the frame bundle).
 * - exposes readiness + content height for screenshots
 * - shows build/runtime errors inside the frame and reports them to the server
 * - in canvas mode: element hover/selection, and forwards wheel events to the canvas
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { CanvasMessage } from "../contracts/frame-message";
const BootSchema = Schema.Struct({
  id: Schema.String,
  canvas: Schema.Boolean,
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
      const observers: ResizeObserver[] = [];
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
            { source: "framio", frame: boot.id, ...msg },
            "*",
          );
      }

      function reportStatus(error: string | null) {
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
                  version: boot.version,
                  error,
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
          reportStatus(null);
          postParent({ type: "ready", height: contentHeight() });
        }
      }).pipe(
        Effect.timeout("20 seconds"),
        Effect.catch((error) =>
          Effect.sync(() => window.__framio.reportError(error)),
        ),
      );
      if (!boot.error) yield* Effect.forkScoped(waitForReady);

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
          { passive: false },
        );

        // Canvas shortcuts (V, H, Space, Shift+1, Cmd+=...) must work while the pointer is over a frame.
        for (const phase of ["keydown", "keyup"] as const) {
          windowEvents.addEventListener(phase, (e) => {
            const zoomKey =
              (e.metaKey || e.ctrlKey) && ["=", "+", "-", "0"].includes(e.key);
            if (e.code === "Space" || zoomKey || (e.metaKey && e.key === "a"))
              e.preventDefault();
            postParent({
              type: "key",
              phase,
              key: e.key,
              code: e.code,
              repeat: e.repeat,
              shiftKey: e.shiftKey,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              altKey: e.altKey,
            });
          });
        }

        // Middle-button drag pans the canvas, even when it starts over a frame.
        let middleDown = false;
        windowEvents.addEventListener("pointermove", (e) => {
          if (middleDown)
            postParent({
              type: "pan-move",
              screenX: e.screenX,
              screenY: e.screenY,
            });
        });
        windowEvents.addEventListener("pointerup", (e) => {
          if (middleDown && e.button === 1) {
            middleDown = false;
            postParent({ type: "pan-end" });
          }
        });

        // Element hover + selection. Mockups are static, so clicks never reach the frame's own handlers.
        const hover = makeOverlay("1px solid #3b82f6", "transparent");
        const selected = makeOverlay(
          "2px solid #3b82f6",
          "rgba(59,130,246,0.06)",
        );
        let selectedEl: Element | null = null;

        function makeOverlay(border: string, background: string) {
          const el = document.createElement("div");
          el.setAttribute(
            "style",
            `position:absolute;pointer-events:none;z-index:2147483646;box-sizing:border-box;border:${border};background:${background};display:none`,
          );
          documentEvents.addEventListener("DOMContentLoaded", () =>
            document.documentElement.appendChild(el),
          );
          return el;
        }

        function place(overlay: HTMLElement, el: Element | null) {
          if (!el) {
            overlay.style.display = "none";
            return;
          }
          const r = el.getBoundingClientRect();
          Object.assign(overlay.style, {
            display: "block",
            left: `${r.left + window.scrollX}px`,
            top: `${r.top + window.scrollY}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
          });
        }

        const isOwn = (el: Element | null) =>
          !el ||
          el === document.documentElement ||
          el === document.body ||
          el.id === "root";

        documentEvents.addEventListener("mousemove", (e) => {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          place(hover, isOwn(el) ? null : el);
        });
        documentEvents.addEventListener("mouseleave", () => place(hover, null));

        for (const type of [
          "pointerdown",
          "mousedown",
          "pointerup",
          "mouseup",
          "submit",
          "auxclick",
        ]) {
          windowEvents.addEventListener(
            type as
              | "pointerdown"
              | "mousedown"
              | "pointerup"
              | "mouseup"
              | "submit"
              | "auxclick",
            (e) => {
              e.preventDefault();
              e.stopPropagation();
            },
            true,
          );
        }
        windowEvents.addEventListener(
          "pointerdown",
          (e) => {
            if (e.button !== 1) return;
            middleDown = true;
            postParent({
              type: "pan-start",
              screenX: e.screenX,
              screenY: e.screenY,
            });
          },
          true,
        );
        windowEvents.addEventListener(
          "dblclick",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            postParent({ type: "dblclick" });
          },
          true,
        );
        windowEvents.addEventListener(
          "contextmenu",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            const at = toParent(e.clientX, e.clientY);
            postParent({ type: "contextmenu", clientX: at.x, clientY: at.y });
          },
          true,
        );
        windowEvents.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.button !== 0) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            selectedEl = isOwn(el) ? null : el;
            place(selected, selectedEl);
            postParent({
              type: "select",
              element: selectedEl ? describe(selectedEl) : null,
            });
          },
          true,
        );
        windowEvents.addEventListener("message", (e) => {
          if (e.source !== window.parent || e.origin !== location.origin)
            return;
          const decoded = Schema.decodeUnknownResult(CanvasMessage)(e.data);
          if (Result.isFailure(decoded)) return;
          const message = decoded.success;
          if (message.type === "clear-selection") {
            selectedEl = null;
            place(selected, null);
          }
          if (message.type === "css") {
            if (message.version <= latestCssVersion) return;
            latestCssVersion = message.version;
            Queue.offerUnsafe(cssVersions, message.version);
          }
        });
        observe(() => place(selected, selectedEl)).observe(
          document.documentElement,
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
