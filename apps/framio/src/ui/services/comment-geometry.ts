import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type { Comment } from "../../contracts/comments";

type Positions = Record<string, { x: number; y: number }>;
/** The scope owns DOM observers; no polling or hidden per-frame timers. */
export const commentGeometry = (
  id: string,
  pins: readonly Comment[],
  previous: Positions,
) =>
  pins.length === 0
    ? Stream.succeed<Positions>({})
    : Stream.callback<Positions>(
        Effect.fnUntraced(function* (queue) {
          let iframe: HTMLIFrameElement | undefined;
          let documentCleanup = () => {};
          let animation: number | undefined;
          const locate = () =>
            [
              ...document.querySelectorAll<HTMLIFrameElement>(
                "iframe[data-frame]",
              ),
            ].find(
              (el) =>
                el.dataset.frame === id && el.style.visibility !== "hidden",
            );
          const measure = () => {
            const positions = Object.fromEntries(
              pins.map((pin) => {
                let { x, y } = previous[pin.id] ?? pin.anchor;
                if (pin.anchor.selector && iframe?.contentDocument) {
                  try {
                    const rect = iframe.contentDocument
                      .querySelector(pin.anchor.selector)
                      ?.getBoundingClientRect();
                    if (rect) {
                      x = rect.x + pin.anchor.x;
                      y = rect.y + pin.anchor.y;
                    }
                  } catch {
                    /* Keep invalid selectors recoverable from their thread. */
                  }
                } else if (!pin.anchor.selector) {
                  x = pin.anchor.x;
                  y = pin.anchor.y;
                }
                return [pin.id, { x, y }];
              }),
            );
            Object.assign(previous, positions);
            Queue.offerUnsafe(queue, positions);
          };
          const schedule = () => {
            if (animation !== undefined) return;
            animation = requestAnimationFrame(() => {
              animation = undefined;
              measure();
            });
          };
          const bindDocument = () => {
            documentCleanup();
            const doc = iframe?.contentDocument;
            if (!doc) {
              measure();
              return;
            }
            const resize = new ResizeObserver(schedule);
            resize.observe(doc.documentElement);
            for (const pin of pins) {
              try {
                const el = pin.anchor.selector
                  ? doc.querySelector(pin.anchor.selector)
                  : null;
                if (el) resize.observe(el);
              } catch {}
            }
            const mutations = new MutationObserver(schedule);
            const root = doc.getElementById("root");
            if (root)
              mutations.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
              });
            doc.addEventListener("load", schedule, true);
            doc.fonts.addEventListener("loadingdone", schedule);
            documentCleanup = () => {
              resize.disconnect();
              mutations.disconnect();
              doc.removeEventListener("load", schedule, true);
              doc.fonts.removeEventListener("loadingdone", schedule);
            };
            schedule();
          };
          const bind = () => {
            const next = locate();
            if (next === iframe) return;
            iframe?.removeEventListener("load", bindDocument);
            documentCleanup();
            documentCleanup = () => {};
            iframe = next;
            iframe?.addEventListener("load", bindDocument);
            bindDocument();
          };
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const mutations = new MutationObserver((records) => {
                if (
                  records.some(
                    (record) =>
                      record.target instanceof HTMLIFrameElement ||
                      [...record.addedNodes, ...record.removedNodes].some(
                        (node) =>
                          node instanceof Element &&
                          (node.tagName === "IFRAME" ||
                            node.querySelector("iframe")),
                      ),
                  )
                )
                  bind();
              });
              if (pins.length)
                mutations.observe(
                  document.querySelector(".react-flow__nodes") ?? document.body,
                  {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ["style"],
                  },
                );
              bind();
              measure();
              return mutations;
            }),
            (mutations) =>
              Effect.sync(() => {
                mutations.disconnect();
                documentCleanup();
                iframe?.removeEventListener("load", bindDocument);
                if (animation !== undefined) cancelAnimationFrame(animation);
              }),
          );
        }),
        { bufferSize: 1, strategy: "sliding" },
      );
