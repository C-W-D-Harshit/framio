import type { LayerNode, LayerReport, TextOverflow } from "../contracts/layers";
import { buildLayerTree, inspectLayers, resolveLayer } from "../domain/layers";
function rendered(el: Element) {
  const style = getComputedStyle(el);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    (el.getClientRects().length > 0 || style.display === "contents")
  );
}
function layerElements(root: Element) {
  return [...root.querySelectorAll<HTMLElement>("[data-layer]")].filter(
    rendered,
  );
}
export function measureLayers(width = window.innerWidth): LayerReport {
  const root = document.getElementById("root");
  if (!root) return { tree: [], warnings: [], checks: [], width };
  const origin = root.getBoundingClientRect();
  const elements = layerElements(root);
  const indices = new Map(elements.map((el, i) => [el, i]));
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - origin.left,
      y: r.top - origin.top,
      width: r.width,
      height: r.height,
    };
  };
  const selector = (element: Element) => {
    if (element === root) return "#root";
    if (element.id) {
      const id = `#${CSS.escape(element.id)}`;
      if (document.querySelectorAll(id).length === 1) return `#root ${id}`;
    }
    const parts: string[] = [];
    for (
      let current: Element | null = element;
      current && current !== root;
      current = current.parentElement
    ) {
      const index = current.parentElement
        ? [...current.parentElement.children].indexOf(current) + 1
        : 1;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    }
    return `#root > ${parts.join(" > ")}`;
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const rgba = (color: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const backgroundOf = (element: Element) => {
    const ancestors: Element[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    )
      ancestors.unshift(current);
    let result = [255, 255, 255];
    for (const ancestor of ancestors) {
      const color = rgba(getComputedStyle(ancestor).backgroundColor);
      const alpha = color[3]! / 255;
      result = result.map((v, i) =>
        Math.round(color[i]! * alpha + v * (1 - alpha)),
      );
    }
    return `rgb(${result.join(", ")})`;
  };
  const owned = new Map<Element, Element[]>();
  for (const descendant of root.querySelectorAll("*")) {
    if (!rendered(descendant)) continue;
    const owner = descendant.closest("[data-layer]");
    if (!owner) continue;
    const list = owned.get(owner) ?? [];
    list.push(descendant);
    owned.set(owner, list);
  }
  const records = elements.map((el) => {
    const parent = el.parentElement?.closest<HTMLElement>("[data-layer]");
    const style = getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const key of [
      "padding",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "margin",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "gap",
      "rowGap",
      "columnGap",
      "border",
      "borderRadius",
      "backgroundColor",
      "color",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "display",
      "flexDirection",
      "overflow",
      "overflowX",
      "overflowY",
    ])
      styles[key] = style[key as keyof CSSStyleDeclaration] as string;
    let background = el as Element | null;
    while (
      background &&
      getComputedStyle(background).backgroundColor === "rgba(0, 0, 0, 0)"
    )
      background = background.parentElement;
    styles.effectiveBackground = background
      ? getComputedStyle(background).backgroundColor
      : "rgb(255, 255, 255)";
    const textSamples: {
      color: string;
      background: string;
      fontSize: string;
      fontWeight: string;
    }[] = [];
    const targets: LayerNode["box"][] = [];
    const textOverflows: TextOverflow[] = [];
    for (const descendant of owned.get(el) ?? []) {
      const css = getComputedStyle(descendant);
      if (
        descendant.matches(
          "button, a[href], input, select, textarea, [role=button], [tabindex]",
        )
      )
        targets.push(box(descendant));
      const textNodes = [...descendant.childNodes].filter(
        (n) => n.nodeType === Node.TEXT_NODE && Boolean(n.textContent?.trim()),
      );
      if (!textNodes.length) continue;
      const color = rgba(css.color);
      const bg = backgroundOf(descendant);
      const bgChannels = rgba(bg);
      const alpha = color[3]! / 255;
      textSamples.push({
        color: `rgb(${color
          .slice(0, 3)
          .map((v, i) => Math.round(v * alpha + bgChannels[i]! * (1 - alpha)))
          .join(", ")})`,
        background: bg,
        fontSize: css.fontSize,
        fontWeight: css.fontWeight,
      });
      const range = document.createRange();
      const rects: DOMRect[] = [];
      for (const textNode of textNodes) {
        range.selectNodeContents(textNode);
        rects.push(...range.getClientRects());
      }
      if (!rects.length) continue;
      const left = Math.min(...rects.map((rect) => rect.left)),
        top = Math.min(...rects.map((rect) => rect.top)),
        right = Math.max(...rects.map((rect) => rect.right)),
        bottom = Math.max(...rects.map((rect) => rect.bottom));
      const rawBounds = { left, top, right, bottom };
      const visibleBounds = { ...rawBounds };
      const element = {
        selector: selector(descendant),
        tag: descendant.tagName.toLowerCase(),
        text: textNodes
          .map((node) => node.textContent)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160),
        box: box(descendant),
      };
      const clippedAxes = new Set<string>();
      const measure = (
        ancestor: Element,
        axis: TextOverflow["axis"],
        kind: TextOverflow["kind"],
        text = visibleBounds,
      ) => {
        const bounds = ancestor.getBoundingClientRect();
        if (text.right <= text.left || text.bottom <= text.top) return;
        const start = axis === "horizontal" ? text.left : text.top,
          end = axis === "horizontal" ? text.right : text.bottom,
          clipStart = axis === "horizontal" ? bounds.left : bounds.top,
          clipEnd = axis === "horizontal" ? bounds.right : bounds.bottom;
        if (start >= clipStart - 1 && end <= clipEnd + 1) return;
        const actual = end - start;
        const available = Math.max(
          0,
          Math.min(end, clipEnd) - Math.max(start, clipStart),
        );
        textOverflows.push({
          kind,
          axis,
          element,
          container: { selector: selector(ancestor), box: box(ancestor) },
          textBounds: {
            x: text.left - origin.left,
            y: text.top - origin.top,
            width: text.right - text.left,
            height: text.bottom - text.top,
          },
          actual,
          available,
          excess: actual - available,
        });
        if (ancestor === descendant) clippedAxes.add(axis);
      };
      let inlineContent = true;
      for (
        let ancestor: Element | null = descendant;
        ancestor && root.contains(ancestor);
        ancestor = ancestor.parentElement
      ) {
        const overflow = getComputedStyle(ancestor);
        for (const axis of ["horizontal", "vertical"] as const) {
          const value =
            axis === "horizontal" ? overflow.overflowX : overflow.overflowY;
          if (!/^(hidden|clip|auto|scroll)$/.test(value)) continue;
          const ellipsis =
            axis === "horizontal" &&
            inlineContent &&
            overflow.textOverflow === "ellipsis" &&
            /^(nowrap|pre)$/.test(overflow.whiteSpace);
          const lineClamp =
            axis === "vertical" &&
            Number.parseInt(overflow.webkitLineClamp, 10) > 0;
          measure(
            ancestor,
            axis,
            /^(auto|scroll)$/.test(value)
              ? "scroll"
              : ellipsis
                ? "ellipsis"
                : lineClamp
                  ? "line-clamp"
                  : "clipping",
          );
          const bounds = ancestor.getBoundingClientRect();
          if (axis === "horizontal") {
            visibleBounds.left = Math.max(visibleBounds.left, bounds.left);
            visibleBounds.right = Math.min(visibleBounds.right, bounds.right);
          } else {
            visibleBounds.top = Math.max(visibleBounds.top, bounds.top);
            visibleBounds.bottom = Math.min(
              visibleBounds.bottom,
              bounds.bottom,
            );
          }
        }
        inlineContent &&=
          overflow.display === "inline" || overflow.display === "contents";
      }
      if (
        css.display !== "inline" &&
        descendant.scrollWidth > descendant.clientWidth + 1 &&
        !clippedAxes.has("horizontal")
      )
        measure(descendant, "horizontal", "overflow", rawBounds);
    }
    return {
      name: el.dataset.layer ?? "",
      parent: parent ? (indices.get(parent) ?? null) : null,
      box: box(el),
      styles,
      source: el.dataset.framioLayerSource,
      textOverflow: textOverflows.length > 0,
      textOverflows,
      textSamples,
      targets,
      interactive: el.matches(
        "button, a[href], input, select, textarea, [role=button], [tabindex]",
      ),
      hasText: [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && Boolean(n.textContent?.trim()),
      ),
      childBoxes: [...el.children].filter(rendered).map(box),
    };
  });
  const frameRoot = root.firstElementChild;
  const unnamed = frameRoot
    ? [...frameRoot.children].filter(
        (el) =>
          rendered(el) &&
          !el.hasAttribute("data-layer") &&
          !el.matches("style, script"),
      )
    : [];
  return inspectLayers(buildLayerTree(records), records, width, unnamed.length);
}
function identities() {
  const root = document.getElementById("root");
  const elements = root ? layerElements(root) : [];
  const indices = new Map(elements.map((el, index) => [el, index]));
  const tree = buildLayerTree(
    elements.map((el) => ({
      name: el.dataset.layer ?? "",
      parent:
        indices.get(el.parentElement?.closest<HTMLElement>("[data-layer]")!) ??
        null,
      box: { x: 0, y: 0, width: 0, height: 0 },
      styles: {},
      textOverflow: false,
      interactive: false,
      hasText: false,
      childBoxes: [],
    })),
  );
  const nodes: LayerNode[] = [];
  const walk = (siblings: readonly LayerNode[]) => {
    for (const node of siblings) {
      nodes.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return { tree, elements, nodes };
}
export function pathForElement(el: Element): string | undefined {
  const named = el.closest("[data-layer]");
  if (!named) return;
  const { elements, nodes } = identities();
  return nodes[elements.indexOf(named as HTMLElement)]?.path;
}
export function findLayerElement(path: string): Element | null {
  const { tree, nodes, elements } = identities();
  const node = resolveLayer(tree, path);
  return node ? (elements[nodes.indexOf(node)] ?? null) : null;
}
