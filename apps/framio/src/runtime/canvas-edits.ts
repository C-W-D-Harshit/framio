import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { CanvasMessage } from "../contracts/frame-message";
import {
  SOURCE_ATTRIBUTE,
  EDIT_ATTRIBUTE,
  LOCK_ATTRIBUTE,
  type EditCapability,
  type EditOperation,
} from "../contracts/edits";
import { findLayerElement, pathForElement } from "./layers";
import {
  changesOrder,
  dropPosition,
  frameScale,
  isQuickEditShortcut,
  selectionPayload,
  singleLineText,
  snapSize,
  sourceAtIndex,
  sourceSelector,
  type DropTarget,
} from "./edit-helpers";

type Events = {
  addEventListener<K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
};
type Options = {
  events: Events;
  observe(callback: ResizeObserverCallback): ResizeObserver;
  registerObserver(observer: MutationObserver): void;
  post(message: Record<string, unknown>): void;
  describe(element: Element): unknown;
  toParent(x: number, y: number): { x: number; y: number };
  updateCss(version: number): void;
};
type ResizeDrag = {
  type: "size";
  element: HTMLElement | SVGElement;
  pointer: number;
  capture: Element;
  x: number;
  y: number;
  width: number;
  height: number;
  nextWidth: number;
  nextHeight: number;
  horizontal: number;
  vertical: number;
  restore(): void;
};
type MoveDrag = {
  type: "move";
  element: Element;
  pointer: number;
  capture: Element;
  x: number;
  y: number;
  active: boolean;
  target: { element: Element; drop: DropTarget } | null;
};
type TextEditing = {
  element: HTMLElement;
  text: string;
  restore(): void;
  restoreAttribute(): void;
};

/** Native DOM adapter. Listeners and observers belong to the frame's Effect scope. */
export function installCanvasEdits(options: Options): {
  dispose(): void;
  ready(): void;
} {
  const { events, post } = options;
  const style = document.createElement("style");
  style.textContent = "html, body { pointer-events: auto !important }";
  document.documentElement.append(style);
  const chrome = document.createElement("div");
  chrome.style.cssText =
    "pointer-events:none;position:absolute;inset:0;z-index:2147483646";
  document.documentElement.append(chrome);
  function overlay(border: string, background = "transparent") {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;pointer-events:none;box-sizing:border-box;border:${border};background:${background};display:none`;
    chrome.append(el);
    return el;
  }
  const hover = overlay("1px solid #3b82f6");
  const selected = overlay("2px solid #3b82f6", "rgba(59,130,246,0.06)");
  const indicator = overlay("0", "#3b82f6");
  const label = overlay("0", "#2563eb");
  label.style.cssText +=
    ";color:white;font:11px/1.4 system-ui;white-space:nowrap;padding:2px 5px;border-radius:3px";
  const handles = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ].map(([horizontal, vertical]) => {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;pointer-events:auto;background:white;border:1px solid #3b82f6;box-sizing:border-box;cursor:${horizontal === 0 ? "ns" : vertical === 0 ? "ew" : horizontal === vertical ? "nwse" : "nesw"}-resize;display:none`;
    chrome.append(el);
    return { el, horizontal: horizontal!, vertical: vertical! };
  });
  let selectedEl: Element | null = null;
  let hoveredEl: Element | null = null;
  let drag: ResizeDrag | MoveDrag | null = null;
  let editing: TextEditing | null = null;
  let middleDown = false;
  let suppressClick = false;
  const suppressedKeys = new Set<string>();
  const reverts = new Map<string, () => void>();
  let pendingSource: { ref: string; index: number } | null = null;
  const scale = () =>
    frameScale(
      window.frameElement?.getBoundingClientRect().width ?? window.innerWidth,
      window.innerWidth,
    );
  const matches = (ref: string) => [
    ...document.querySelectorAll(sourceSelector(ref, CSS.escape)),
  ];
  function source(element: Element | null) {
    if (!element) return undefined;
    const ref = element.getAttribute(SOURCE_ATTRIBUTE);
    return selectionPayload({
      ref,
      element,
      matches: ref ? matches(ref) : [],
      edit: element.getAttribute(EDIT_ATTRIBUTE),
      lock: element.getAttribute(LOCK_ATTRIBUTE),
      hasElementChildren: element.children.length > 0,
    });
  }
  const allows = (capability: EditCapability) =>
    source(selectedEl)?.allowed.includes(capability) ?? false;
  const isOwn = (el: Element | null) =>
    !el ||
    el === document.documentElement ||
    el === document.body ||
    el.id === "root" ||
    chrome.contains(el);
  const atPoint = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return isOwn(el) ? null : el;
  };
  function place(overlayEl: HTMLElement, element: Element | null) {
    if (!element?.isConnected) {
      overlayEl.style.display = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    Object.assign(overlayEl.style, {
      display: rect.width || rect.height ? "block" : "none",
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
  function refresh() {
    place(selected, selectedEl);
    place(hover, editing || drag ? null : hoveredEl);
    const show =
      selectedEl?.isConnected &&
      allows("size") &&
      !editing &&
      selected.style.display !== "none";
    const rect = selectedEl?.getBoundingClientRect();
    const size = 8 / scale();
    for (const handle of handles) {
      if (!show || !rect) {
        handle.el.style.display = "none";
        continue;
      }
      Object.assign(handle.el.style, {
        display: "block",
        width: `${size}px`,
        height: `${size}px`,
        left: `${rect.left + window.scrollX + ((handle.horizontal + 1) * rect.width) / 2 - size / 2}px`,
        top: `${rect.top + window.scrollY + ((handle.vertical + 1) * rect.height) / 2 - size / 2}px`,
      });
    }
    if (drag?.type === "size" && rect) {
      label.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      Object.assign(label.style, {
        display: "block",
        left: `${rect.left + window.scrollX}px`,
        top: `${rect.bottom + window.scrollY + 8 / scale()}px`,
      });
    } else label.style.display = "none";
  }
  const selectedObserver = options.observe(refresh);
  function select(
    element: Element | null,
    clicked = element,
    point?: { x: number; y: number },
    publish = true,
  ) {
    pendingSource = null;
    selectedObserver.disconnect();
    selectedEl = element;
    if (element) selectedObserver.observe(element);
    refresh();
    if (!publish) return;
    const layer = clicked?.closest("[data-layer]") ?? null;
    const path = layer && pathForElement(layer);
    post({
      type: "select",
      element: clicked ? options.describe(clicked) : null,
      layer:
        layer && path
          ? { path, name: layer.getAttribute("data-layer") }
          : undefined,
      sourceSelection: source(element),
      ...point,
    });
  }
  function postEdit(edit: EditOperation, revert: () => void) {
    const id = crypto.randomUUID();
    reverts.set(id, revert);
    refresh();
    post({ type: "edit", id, edit });
  }
  function restoreStyle(
    element: HTMLElement | SVGElement,
    properties: string[],
  ) {
    const values = properties.map((property) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    }));
    return () => {
      for (const { property, value, priority } of values) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    };
  }
  function endText(commit: boolean) {
    const current = editing;
    if (!current) return;
    editing = null;
    const text = singleLineText(current.element.textContent ?? "");
    current.restoreAttribute();
    current.element.blur();
    if (!commit || text === current.text) current.restore();
    else {
      current.element.textContent = text;
      const ref = current.element.getAttribute(SOURCE_ATTRIBUTE)!;
      postEdit({ type: "text", ref, text }, current.restore);
    }
    post({ type: "text-editing", active: false });
    refresh();
  }
  function beginText(): boolean {
    if (editing) return true;
    if (!(selectedEl instanceof HTMLElement) || !allows("text")) return false;
    if (
      ![...selectedEl.childNodes].every(
        (node) =>
          node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement,
      )
    )
      return false;
    const element = selectedEl;
    const original = [...element.childNodes].map((node) =>
      node.cloneNode(true),
    );
    const attribute = element.getAttribute("contenteditable");
    const restoreAttribute = () =>
      attribute === null
        ? element.removeAttribute("contenteditable")
        : element.setAttribute("contenteditable", attribute);
    editing = {
      element,
      text: singleLineText(element.textContent ?? ""),
      restoreAttribute,
      restore() {
        element.replaceChildren(...original);
        restoreAttribute();
      },
    };
    element.setAttribute("contenteditable", "plaintext-only");
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    post({ type: "text-editing", active: true });
    refresh();
    return true;
  }
  const insideEditing = (event: Event) =>
    editing &&
    event.target instanceof Node &&
    editing.element.contains(event.target);
  function capture(element: Element, pointer: number) {
    try {
      element.setPointerCapture(pointer);
    } catch {
      /* A synthetic event has no active pointer. */
    }
  }
  function endDrag(commit: boolean) {
    const current = drag;
    if (!current) return;
    drag = null;
    if (current.capture.hasPointerCapture(current.pointer))
      current.capture.releasePointerCapture(current.pointer);
    indicator.style.display = "none";
    const ref = current.element.getAttribute(SOURCE_ATTRIBUTE)!;
    if (current.type === "size") {
      const width =
        current.horizontal && current.nextWidth !== current.width
          ? current.nextWidth
          : null;
      const height =
        current.vertical && current.nextHeight !== current.height
          ? current.nextHeight
          : null;
      if (commit && (width !== null || height !== null))
        postEdit({ type: "size", ref, width, height }, current.restore);
      else current.restore();
      suppressClick = true;
    } else if (current.active) {
      suppressClick = true;
      const parent = current.element.parentElement;
      const target = current.target;
      const siblings = parent
        ? [...parent.children].filter((el) => el.hasAttribute(SOURCE_ATTRIBUTE))
        : [];
      if (
        commit &&
        parent &&
        target &&
        target.element.parentElement === parent &&
        target.drop.ref !== ref &&
        changesOrder(
          siblings,
          current.element,
          target.element,
          target.drop.position,
        )
      ) {
        const next = current.element.nextSibling;
        parent.insertBefore(
          current.element,
          target.drop.position === "before"
            ? target.element
            : target.element.nextSibling,
        );
        postEdit(
          {
            type: "move",
            ref,
            anchor: target.drop.ref,
            position: target.drop.position,
          },
          () => {
            parent.insertBefore(
              current.element,
              next?.parentNode === parent ? next : null,
            );
          },
        );
      }
    }
    refresh();
  }
  function command(value: "remove" | "duplicate" | "edit-text") {
    if (value === "edit-text") {
      beginText();
      return;
    }
    if (!allows(value) || !selectedEl) return;
    endText(true);
    endDrag(false);
    const element = selectedEl;
    const ref = element.getAttribute(SOURCE_ATTRIBUTE)!;
    if (
      value === "remove" &&
      (element instanceof HTMLElement || element instanceof SVGElement)
    ) {
      const restore = restoreStyle(element, ["display"]);
      element.style.setProperty("display", "none", "important");
      postEdit({ type: "remove", ref }, restore);
    } else if (value === "duplicate") {
      const clone = element.cloneNode(true) as Element;
      for (const node of [clone, ...clone.querySelectorAll("*")])
        for (const attribute of [...node.attributes])
          if (attribute.name.startsWith("data-framio-"))
            node.removeAttribute(attribute.name);
      element.after(clone);
      postEdit({ type: "duplicate", ref }, () => clone.remove());
    }
  }
  for (const phase of ["keydown", "keyup"] as const) {
    events.addEventListener(
      phase,
      (event) => {
        if (suppressedKeys.has(event.code)) {
          if (phase === "keyup") suppressedKeys.delete(event.code);
          event.stopPropagation();
          return;
        }
        if (editing) {
          event.stopPropagation();
          // Native buttons consume Space as activation even when contenteditable.
          if (
            phase === "keydown" &&
            event.key === " " &&
            editing.element instanceof HTMLButtonElement &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.isComposing
          ) {
            event.preventDefault();
            document.execCommand("insertText", false, " ");
            return;
          }
          if (
            phase === "keydown" &&
            !event.isComposing &&
            (event.key === "Enter" || event.key === "Escape")
          ) {
            event.preventDefault();
            suppressedKeys.add(event.code);
            endText(event.key === "Enter");
          }
          return;
        }
        if (drag && phase === "keydown" && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          suppressedKeys.add(event.code);
          endDrag(false);
          return;
        }
        const zoomKey =
          (event.metaKey || event.ctrlKey) &&
          ["=", "+", "-", "0"].includes(event.key);
        if (
          phase === "keydown" &&
          selectedEl?.hasAttribute(SOURCE_ATTRIBUTE) &&
          isQuickEditShortcut(event)
        )
          event.preventDefault();
        if (
          event.code === "Space" ||
          zoomKey ||
          (event.metaKey && event.key === "a")
        )
          event.preventDefault();
        post({
          type: "key",
          phase,
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
        });
      },
      true,
    );
  }
  events.addEventListener(
    "beforeinput",
    (event) => {
      if (
        editing &&
        ["insertParagraph", "insertLineBreak"].includes(event.inputType)
      )
        event.preventDefault();
    },
    true,
  );
  events.addEventListener(
    "pointerdown",
    (event) => {
      if (insideEditing(event)) return;
      if (editing) endText(true);
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
      if (event.button === 1) {
        middleDown = true;
        post({
          type: "pan-start",
          screenX: event.screenX,
          screenY: event.screenY,
        });
        return;
      }
      if (event.button !== 0 || drag) return;
      const handle = handles.find(({ el }) => el === event.target);
      if (
        handle &&
        (selectedEl instanceof HTMLElement ||
          selectedEl instanceof SVGElement) &&
        allows("size")
      ) {
        window.focus();
        const computed = getComputedStyle(selectedEl);
        const rect = selectedEl.getBoundingClientRect();
        const width = Number.parseFloat(computed.width) || rect.width;
        const height = Number.parseFloat(computed.height) || rect.height;
        drag = {
          type: "size",
          element: selectedEl,
          pointer: event.pointerId,
          capture: handle.el,
          x: event.clientX,
          y: event.clientY,
          width,
          height,
          nextWidth: width,
          nextHeight: height,
          horizontal: handle.horizontal,
          vertical: handle.vertical,
          restore: restoreStyle(selectedEl, ["width", "height"]),
        };
        capture(handle.el, event.pointerId);
        refresh();
        return;
      }
      const target = atPoint(event.clientX, event.clientY);
      if (
        target &&
        selectedEl?.contains(target) &&
        target.closest(`[${SOURCE_ATTRIBUTE}]`) === selectedEl &&
        allows("move")
      ) {
        window.focus();
        drag = {
          type: "move",
          element: selectedEl,
          pointer: event.pointerId,
          capture: selectedEl,
          x: event.clientX,
          y: event.clientY,
          active: false,
          target: null,
        };
        capture(selectedEl, event.pointerId);
      }
    },
    true,
  );
  events.addEventListener(
    "pointermove",
    (event) => {
      if (middleDown)
        post({
          type: "pan-move",
          screenX: event.screenX,
          screenY: event.screenY,
        });
      if (insideEditing(event)) return;
      if (drag && event.pointerId === drag.pointer) {
        event.preventDefault();
        event.stopPropagation();
        if (drag.type === "size") {
          if (drag.horizontal) {
            drag.nextWidth = snapSize(
              drag.width + (event.clientX - drag.x) * drag.horizontal,
              event.shiftKey,
            );
            drag.element.style.setProperty(
              "width",
              `${drag.nextWidth}px`,
              "important",
            );
          }
          if (drag.vertical) {
            drag.nextHeight = snapSize(
              drag.height + (event.clientY - drag.y) * drag.vertical,
              event.shiftKey,
            );
            drag.element.style.setProperty(
              "height",
              `${drag.nextHeight}px`,
              "important",
            );
          }
        } else {
          if (
            Math.hypot(event.clientX - drag.x, event.clientY - drag.y) *
              scale() >
            4
          )
            drag.active = true;
          const parent = drag.element.parentElement;
          if (drag.active && parent) {
            const siblings = [...parent.children].filter(
              (el) => el !== drag!.element && el.hasAttribute(SOURCE_ATTRIBUTE),
            );
            const layout = getComputedStyle(parent);
            const drop = dropPosition(
              siblings.map((el) => {
                const rect = el.getBoundingClientRect();
                return {
                  ref: el.getAttribute(SOURCE_ATTRIBUTE)!,
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height,
                };
              }),
              { x: event.clientX, y: event.clientY },
              {
                display: layout.display,
                direction: layout.flexDirection,
                wrap: layout.flexWrap,
              },
            );
            drag.target = drop
              ? { element: siblings[drop.index]!, drop }
              : null;
            if (drag.target) {
              const rect = drag.target.element.getBoundingClientRect();
              const before = drop!.position === "before";
              const reverse =
                layout.display.includes("flex") &&
                layout.flexDirection.endsWith("reverse");
              const leading = reverse ? !before : before;
              Object.assign(
                indicator.style,
                drop!.axis === "horizontal"
                  ? {
                      display: "block",
                      left: `${(leading ? rect.left : rect.right) + window.scrollX - 1}px`,
                      top: `${rect.top + window.scrollY}px`,
                      width: "2px",
                      height: `${rect.height}px`,
                    }
                  : {
                      display: "block",
                      left: `${rect.left + window.scrollX}px`,
                      top: `${(leading ? rect.top : rect.bottom) + window.scrollY - 1}px`,
                      width: `${rect.width}px`,
                      height: "2px",
                    },
              );
            } else indicator.style.display = "none";
          }
        }
        refresh();
        return;
      }
      hoveredEl = atPoint(event.clientX, event.clientY);
      refresh();
    },
    true,
  );
  events.addEventListener(
    "pointerup",
    (event) => {
      if (insideEditing(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (middleDown && event.button === 1) {
        middleDown = false;
        post({ type: "pan-end" });
      }
      if (drag?.pointer === event.pointerId) endDrag(true);
    },
    true,
  );
  events.addEventListener(
    "pointercancel",
    () => {
      endDrag(false);
      if (middleDown) {
        middleDown = false;
        post({ type: "pan-end" });
      }
    },
    true,
  );
  events.addEventListener(
    "lostpointercapture",
    (event) => {
      if (drag?.pointer === event.pointerId) endDrag(false);
    },
    true,
  );
  for (const type of ["mousedown", "mouseup", "submit", "auxclick"] as const) {
    events.addEventListener(
      type,
      (event) => {
        if (insideEditing(event)) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }
  events.addEventListener(
    "click",
    (event) => {
      if (insideEditing(event)) return;
      if (editing) endText(true);
      event.preventDefault();
      event.stopPropagation();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (event.button !== 0 || chrome.contains(event.target as Node)) return;
      const clicked = atPoint(event.clientX, event.clientY);
      const element =
        clicked?.closest(`[${SOURCE_ATTRIBUTE}]`) ??
        clicked?.closest("[data-layer]") ??
        clicked;
      select(element, clicked, { x: event.clientX, y: event.clientY });
    },
    true,
  );
  events.addEventListener(
    "dblclick",
    (event) => {
      if (insideEditing(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const clicked = atPoint(event.clientX, event.clientY);
      if (clicked && selectedEl?.contains(clicked) && beginText()) return;
      post({ type: "dblclick" });
    },
    true,
  );
  events.addEventListener(
    "contextmenu",
    (event) => {
      if (insideEditing(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const at = options.toParent(event.clientX, event.clientY);
      post({ type: "contextmenu", clientX: at.x, clientY: at.y });
    },
    true,
  );
  events.addEventListener("mouseleave", () => {
    hoveredEl = null;
    refresh();
  });
  events.addEventListener("mousemove", (event) => {
    if (drag || editing) return;
    hoveredEl = atPoint(event.clientX, event.clientY);
    refresh();
  });
  events.addEventListener("scroll", refresh, true);
  events.addEventListener("resize", refresh);
  function restoreSource() {
    if (!pendingSource) return;
    const { ref, index } = pendingSource;
    const element = sourceAtIndex(matches(ref), index);
    if (element || window.__framio.ready) select(element);
  }
  events.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== location.origin)
      return;
    const decoded = Schema.decodeUnknownResult(CanvasMessage)(event.data);
    if (Result.isFailure(decoded)) return;
    const message = decoded.success;
    if (message.type === "css") {
      options.updateCss(message.version);
      return;
    }
    if (message.type === "edit-result") {
      const revert = reverts.get(message.id);
      reverts.delete(message.id);
      if (!message.ok) {
        revert?.();
        refresh();
      }
      return;
    }
    if (message.type === "layer-hover") {
      hoveredEl = message.path ? findLayerElement(message.path) : null;
      refresh();
    }
    if (message.type === "command") command(message.command);
    if (message.type === "clear-selection") {
      endText(false);
      endDrag(false);
      select(null, null, undefined, false);
    }
    if (message.type === "layer-select") {
      endText(true);
      endDrag(false);
      const element = findLayerElement(message.path);
      select(element?.closest(`[${SOURCE_ATTRIBUTE}]`) ?? element, element);
    }
    if (message.type === "select-source") {
      endText(true);
      endDrag(false);
      pendingSource = { ref: message.ref, index: message.index };
      restoreSource();
    }
  });
  const mutations = new MutationObserver((records) => {
    if (records.every((record) => chrome.contains(record.target))) return;
    restoreSource();
    refresh();
  });
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      SOURCE_ATTRIBUTE,
      EDIT_ATTRIBUTE,
      LOCK_ATTRIBUTE,
      "class",
      "style",
    ],
  });
  options.registerObserver(mutations);
  options.observe(refresh).observe(document.documentElement);
  const frame = window.frameElement;
  if (frame) {
    // Canvas zoom changes ancestor transforms without resizing the iframe viewport.
    const zoomChanges = new MutationObserver((records) => {
      if (records.some((record) => record.target.contains(frame))) refresh();
    });
    zoomChanges.observe(frame.ownerDocument.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["style", "class"],
    });
    options.registerObserver(zoomChanges);
  }
  // Readiness can follow the last DOM mutation. Recheck after the runtime posts ready.
  events.addEventListener("load", restoreSource);
  return {
    ready: restoreSource,
    dispose() {
      endText(false);
      endDrag(false);
      reverts.clear();
      chrome.remove();
      style.remove();
    },
  };
}
