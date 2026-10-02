import type { LayerNode, LayerReport, TextOverflow } from "../contracts/layers";
export type LayerRecord = {
  name: string;
  parent: number | null;
  box: LayerNode["box"];
  styles: Record<string, string>;
  source?: string;
  textOverflow: boolean;
  textOverflows?: readonly TextOverflow[];
  interactive: boolean;
  hasText: boolean;
  childBoxes: LayerNode["box"][];
  textSamples?: {
    color: string;
    background: string;
    fontSize: string;
    fontWeight: string;
  }[];
  targets?: LayerNode["box"][];
};
export function buildLayerTree(records: readonly LayerRecord[]): LayerNode[] {
  const tree: LayerNode[] = [];
  const nodes = records.map(
    (r) =>
      ({
        name: r.name,
        path: "",
        box: r.box,
        styles: r.styles,
        source: r.source,
        children: [],
        spacing: [],
      }) as LayerNode,
  );
  records.forEach((r, i) => {
    const parent = r.parent === null ? undefined : nodes[r.parent];
    (parent?.children ?? tree).push(nodes[i]!);
  });
  const walk = (siblings: LayerNode[], prefix: string) => {
    const counts = new Map<string, number>();
    for (const node of siblings)
      counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const node of siblings) {
      const index = (seen.get(node.name) ?? 0) + 1;
      seen.set(node.name, index);
      node.path =
        prefix +
        node.name +
        ((counts.get(node.name) ?? 0) > 1 ? `[${index}]` : "");
      walk(node.children, node.path + "/");
    }
  };
  walk(tree, "");
  return tree;
}
export function flattenLayers(tree: readonly LayerNode[]): LayerNode[] {
  return tree.flatMap((node) => [node, ...flattenLayers(node.children)]);
}
export function resolveLayer(
  tree: readonly LayerNode[],
  path: string,
): LayerNode | undefined {
  const parts = path.split("/");
  let siblings = tree;
  let node: LayerNode | undefined;
  for (const part of parts) {
    const match = /^(.*?)(?:\[([1-9]\d*)\])?$/.exec(part);
    if (!match) return;
    node = siblings.filter((n) => n.name === match[1])[
      Number(match[2] ?? 1) - 1
    ];
    if (!node) return;
    siblings = node.children;
  }
  return node;
}
function luminance(color: string) {
  const match =
    /^rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:[, /]+([\d.]+))?\)$/.exec(
      color,
    );
  if (!match || (match[4] !== undefined && Number(match[4]) < 1))
    return undefined;
  const c = match.slice(1, 4).map((v) => {
    const s = Number(v) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
}
export function inspectLayers(
  tree: LayerNode[],
  records: readonly LayerRecord[],
  width: number,
  unnamedChildren = 0,
): LayerReport {
  const warnings: LayerReport["warnings"][number][] = [];
  if (!tree.length)
    warnings.push({
      path: "",
      message: "Frame has no layers. Add data-layer to meaningful sections.",
    });
  if (unnamedChildren)
    warnings.push({
      path: "",
      message: `${unnamedChildren} direct child${unnamedChildren === 1 ? "" : "ren"} of the frame root missing data-layer.`,
    });
  const checks: LayerReport["checks"][number][] = [];
  const nodes = flattenLayers(tree);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!,
      r = records[i]!;
    const add = (message: string, severity: "warning" | "error" = "warning") =>
      checks.push({ severity, path: node.path, message });
    if (r.textOverflows !== undefined) {
      for (const overflow of r.textOverflows) {
        const intentional = ["ellipsis", "line-clamp", "scroll"].includes(
          overflow.kind,
        );
        const description =
          overflow.kind === "ellipsis"
            ? "Text is intentionally truncated with ellipsis"
            : overflow.kind === "line-clamp"
              ? "Text is intentionally truncated with line clamp"
              : overflow.kind === "scroll"
                ? "Text extends beyond the visible scroll area"
                : overflow.kind === "clipping"
                  ? "Text is clipped"
                  : "Text overflows";
        checks.push({
          severity: intentional ? "warning" : "error",
          path: node.path,
          message: `${description} ${overflow.axis === "horizontal" ? "horizontally" : "vertically"} by ${Math.round(overflow.excess * 10) / 10}px.`,
          overflow,
        });
      }
    } else if (r.textOverflow) add("Text overflows or is clipped.", "error");
    const b = node.box;
    if (
      r.childBoxes.some(
        (c) =>
          c.x < b.x - 1 ||
          c.y < b.y - 1 ||
          c.x + c.width > b.x + b.width + 1 ||
          c.y + c.height > b.y + b.height + 1,
      )
    )
      add("Children overflow their layer.", "error");
    const boxes = r.childBoxes.filter((c) => c.width && c.height);
    const columnStack =
      boxes.length > 1 &&
      boxes
        .slice(1)
        .every(
          (c, index) =>
            c.y >= boxes[index]!.y + boxes[index]!.height - 1 &&
            Math.abs(c.x - boxes[0]!.x) <= 3,
        );
    const vertical =
      (node.styles.display?.includes("flex") &&
        node.styles.flexDirection === "column") ||
      ((node.styles.display === "block" || node.styles.display === "grid") &&
        columnStack);
    const horizontal =
      node.styles.display?.includes("flex") &&
      node.styles.flexDirection === "row";
    if (vertical || horizontal) {
      node.spacing = boxes
        .slice(1)
        .map((c, index) =>
          vertical
            ? c.y - (boxes[index]!.y + boxes[index]!.height)
            : c.x - (boxes[index]!.x + boxes[index]!.width),
        );
      if (
        node.spacing.length > 1 &&
        Math.max(...node.spacing) - Math.min(...node.spacing) > 1
      )
        add("Inconsistent gaps between siblings in the same stack.");
      const edges = boxes.map((c) => (vertical ? c.x : c.y));
      if (
        edges.some((e, index) =>
          edges
            .slice(index + 1)
            .some(
              (other) => Math.abs(other - e) >= 1 && Math.abs(other - e) <= 3,
            ),
        )
      )
        add("Sibling edges nearly align but differ by 1–3px.");
    }
    const spacing = [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "rowGap",
      "columnGap",
    ]
      .flatMap((k) =>
        /^-?[\d.]+px$/.test(node.styles[k] ?? "")
          ? [parseFloat(node.styles[k]!)]
          : [],
      )
      .concat(node.spacing);
    if (
      spacing.some((n) => n >= 0 && Math.abs(n / 4 - Math.round(n / 4)) > 0.02)
    )
      add("Spacing is not on a 4px grid.");
    const samples =
      r.textSamples ??
      (r.hasText
        ? [
            {
              color: node.styles.color ?? "",
              background: node.styles.effectiveBackground ?? "",
              fontSize: node.styles.fontSize ?? "0",
              fontWeight: node.styles.fontWeight ?? "400",
            },
          ]
        : []);
    for (const sample of samples) {
      const fg = luminance(sample.color),
        bg = luminance(sample.background);
      if (fg === undefined || bg === undefined) continue;
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const large =
        parseFloat(sample.fontSize) >= 24 ||
        (parseFloat(sample.fontSize) >= 18.66 &&
          Number(sample.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        add(`Text contrast ${ratio.toFixed(2)}:1 is below WCAG AA.`, "error");
        break;
      }
    }
    const minimum = width < 600 ? 44 : 24;
    const targets = r.targets ?? (r.interactive ? [b] : []);
    if (
      targets.some(
        (target) => target.width < minimum || target.height < minimum,
      )
    )
      add(`Interactive target is smaller than ${minimum}px.`, "error");
  }
  return { tree, warnings, checks, width };
}
export function layerCrop(
  box: LayerNode["box"],
  width: number,
  height: number,
  margin = 8,
) {
  const x = Math.max(0, box.x - margin),
    y = Math.max(0, box.y - margin);
  const w = Math.max(1, Math.min(width - x, box.width + margin + box.x - x));
  const h = Math.max(1, Math.min(height - y, box.height + margin + box.y - y));
  return {
    clip: { x, y, width: w, height: h },
    scale: Math.max(1, Math.min(2, 1500 / Math.max(w, h))),
  };
}
