import type { LayerNode, LayerReport } from "../contracts/layers";
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
    let textOverflow = false;
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
      for (const textNode of textNodes) {
        range.selectNodeContents(textNode);
        for (const rect of range.getClientRects()) {
          for (
            let ancestor: Element | null = descendant;
            ancestor && root.contains(ancestor);
            ancestor = ancestor.parentElement
          ) {
            const a = ancestor.getBoundingClientRect(),
              overflow = getComputedStyle(ancestor);
            if (
              (/hidden|clip/.test(overflow.overflowX) &&
                (rect.left < a.left - 1 || rect.right > a.right + 1)) ||
              (/hidden|clip/.test(overflow.overflowY) &&
                (rect.top < a.top - 1 || rect.bottom > a.bottom + 1))
            )
              textOverflow = true;
          }
        }
      }
      if (
        descendant.scrollWidth > descendant.clientWidth + 1 &&
        css.display !== "inline"
      )
        textOverflow = true;
    }
    return {
      name: el.dataset.layer ?? "",
      parent: parent ? (indices.get(parent) ?? null) : null,
      box: box(el),
      styles,
      source: el.dataset.framioLayerSource,
      textOverflow,
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
