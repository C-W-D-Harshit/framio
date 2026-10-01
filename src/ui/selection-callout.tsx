import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useStore } from "@xyflow/react";
import { flattenLayers } from "../domain/layers";
import { Copy } from "lucide-react";
import { selectionAtom, layersAtom } from "./state";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card } from "./components/ui/card";
import type { FrameNodeType } from "./frame-node";

/** Selection geometry stays in the React Flow adapter and follows zoom and pan. */
export function SelectionCallout() {
  const selection = useAtomValue(selectionAtom);
  const nodes = useStore((state) => state.nodes as FrameNodeType[]);
  const [panX, panY, zoom] = useStore((state) => state.transform);
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  const [copied, setCopied] = useState<string | null>(null);
  const targets = nodes.filter(
    (node) =>
      selection.frames.includes(node.data.frame.frameId ?? node.id) &&
      (!selection.width || node.data.frame.meta.width === selection.width),
  );
  const report = useAtomValue(layersAtom(targets[0]?.id ?? ""));
  if (!targets.length) return null;
  const first = targets[0]!;
  const element = selection.element;
  const currentLayer = selection.layer
    ? flattenLayers(report?.tree ?? []).find(
        (node) => node.path === selection.layer?.path,
      )
    : undefined;
  const rect = currentLayer?.box ?? element?.rect;
  const left = rect
    ? first.position.x + rect.x
    : Math.min(...targets.map((node) => node.position.x));
  const top = rect
    ? first.position.y + rect.y
    : Math.min(...targets.map((node) => node.position.y));
  const bottom = rect
    ? top + rect.height
    : Math.max(...targets.map((node) => node.position.y + node.data.height));
  const calloutHeight = element ? 82 : 38;
  const below = panY + bottom * zoom + 12;
  const above = panY + top * zoom - calloutHeight - 12;
  const preferred = below + calloutHeight > canvasHeight - 76 ? above : below;
  const y = element
    ? preferred
    : Math.max(
        12,
        Math.min(
          preferred < 0 ? below : preferred,
          canvasHeight - calloutHeight - 76,
        ),
      );
  if (y < 0 || y > canvasHeight - calloutHeight) return null;
  const x = Math.max(
    12,
    Math.min(panX + left * zoom, canvasWidth - (element ? 276 : 320)),
  );
  const copy = async () => {
    if (!element) return;
    try {
      await navigator.clipboard.writeText(element.selector);
      setCopied(element.selector);
    } catch {
      setCopied(null);
    }
  };
  return (
    <Card
      aria-label="Agent selection"
      data-ui
      className="absolute z-10 gap-0 rounded-lg border bg-popover p-3 text-xs shadow-xl"
      style={{
        left: x,
        top: y,
        maxWidth: Math.max(0, canvasWidth - 24),
        width: element ? 264 : undefined,
      }}
    >
      {element ? (
        <>
          <div className="flex items-center gap-2">
            <Badge className="rounded-sm border-0 bg-signal/15 px-1.5 py-0.5 font-mono text-[11px] text-signal">
              {element.tag}
            </Badge>
            <span className="truncate">
              {element.text ? `“${element.text}”` : first.data.frame.meta.name}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-live" />
              Your agent can see this
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="h-auto gap-1 p-0 text-[11px] font-normal"
              onClick={() => void copy()}
            >
              <Copy className="size-3" />
              {copied === element.selector ? "Copied" : "Selector"}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-live" />
          <span className="truncate">
            {selection.frames.length > 1
              ? `${selection.frames.length} frames`
              : first.data.frame.meta.name}
          </span>
          <span className="text-muted-foreground">
            · Your agent can see{" "}
            {selection.frames.length > 1 ? "these" : "this"}
          </span>
        </div>
      )}
    </Card>
  );
}
