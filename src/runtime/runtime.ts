/**
 * Injected into every frame document (classic script, runs before the frame bundle).
 * - exposes readiness + content height for screenshots
 * - shows build/runtime errors inside the frame and reports them to the server
 * - in canvas mode: element hover/selection, and forwards wheel events to the canvas
 */
type Boot = { id: string; canvas: boolean; error: string | null };

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

const boot = window.__FRAMIO_BOOT__;
const inCanvas = boot.canvas && window.parent !== window;

function contentHeight() {
  const root = document.getElementById("root");
  const h = root ? Math.ceil(root.getBoundingClientRect().height) : 0;
  return h > 0 ? h : window.innerHeight;
}

function postParent(msg: Record<string, unknown>) {
  if (inCanvas) window.parent.postMessage({ source: "framio", frame: boot.id, ...msg }, "*");
}

function reportStatus(error: string | null) {
  fetch("/api/frame-status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: boot.id, error }),
  }).catch(() => {});
}

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
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const components = (componentStack ?? "")
    .split("\n")
    .map((l) => l.trim().replace(/\s*\(http.*\)$/, ""))
    .filter(Boolean)
    .slice(0, 6);
  return components.length ? `${message}\n\nComponent stack:\n  ${components.join("\n  ")}` : message;
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

window.addEventListener("error", (e) => window.__framio.reportError(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => window.__framio.reportError(e.reason));

if (boot.error) {
  document.addEventListener("DOMContentLoaded", () => showError(boot.error!));
  postParent({ type: "error", error: boot.error });
}

// --- Readiness: rendered, fonts loaded, images decoded, two frames painted ---
async function waitForReady() {
  const root = await new Promise<HTMLElement>((resolve) => {
    const check = () => {
      const el = document.getElementById("root");
      if (el && el.childNodes.length > 0) return resolve(el);
      requestAnimationFrame(check);
    };
    check();
  });
  await document.fonts.ready;
  await Promise.all(
    [...root.querySelectorAll("img")].map((img) => (img.complete ? null : img.decode().catch(() => null))),
  );
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

if (!boot.error) {
  waitForReady().then(() => {
    window.__framio.ready = true;
    if (!window.__framio.error) reportStatus(null);
    postParent({ type: "ready", height: contentHeight() });
  });
}

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
  document.addEventListener("DOMContentLoaded", () => {
    const ro = new ResizeObserver(sendSize);
    ro.observe(document.documentElement);
    const root = document.getElementById("root");
    if (root) ro.observe(root);
  });

  // Wheel events inside an iframe never reach the canvas, so re-dispatch them on the iframe element.
  window.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const frameEl = window.frameElement as HTMLIFrameElement | null;
      if (!frameEl) return;
      const rect = frameEl.getBoundingClientRect();
      const scale = rect.width / window.innerWidth;
      const ParentWheel = (frameEl.ownerDocument.defaultView as typeof window).WheelEvent;
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
          clientX: rect.left + e.clientX * scale,
          clientY: rect.top + e.clientY * scale,
        }),
      );
    },
    { passive: false },
  );

  // Element hover + selection. Mockups are static, so clicks never reach the frame's own handlers.
  const hover = makeOverlay("1px solid #3b82f6", "transparent");
  const selected = makeOverlay("2px solid #3b82f6", "rgba(59,130,246,0.06)");
  let selectedEl: Element | null = null;

  function makeOverlay(border: string, background: string) {
    const el = document.createElement("div");
    el.setAttribute(
      "style",
      `position:absolute;pointer-events:none;z-index:2147483646;box-sizing:border-box;border:${border};background:${background};display:none`,
    );
    document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(el));
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

  const isOwn = (el: Element | null) => !el || el === document.documentElement || el === document.body || el.id === "root";

  document.addEventListener("mousemove", (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    place(hover, isOwn(el) ? null : el);
  });
  document.addEventListener("mouseleave", () => place(hover, null));

  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "submit", "dblclick", "contextmenu"]) {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }
  window.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      selectedEl = isOwn(el) ? null : el;
      place(selected, selectedEl);
      postParent({ type: "select", element: selectedEl ? describe(selectedEl) : null });
    },
    true,
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") postParent({ type: "escape" });
  });
  window.addEventListener("message", (e) => {
    if (e.data?.source !== "framio-canvas") return;
    if (e.data.type === "clear-selection") {
      selectedEl = null;
      place(selected, null);
    }
    if (e.data.type === "css") {
      const link = document.querySelector<HTMLLinkElement>('link[href^="/_theme.css"]');
      if (!link) return;
      const next = link.cloneNode() as HTMLLinkElement;
      next.href = `/_theme.css?v=${e.data.version}`;
      next.onload = () => link.remove();
      link.after(next);
    }
  });
  new ResizeObserver(() => place(selected, selectedEl)).observe(document.documentElement);
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.id !== "root" && node !== document.body) {
    const parent: Element | null = node.parentElement;
    let part = node.tagName.toLowerCase();
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === node!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
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
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    html: html.length > 3000 ? `${html.slice(0, 3000)}…` : html,
    rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
  };
}

export {};
