import { useState } from "react";
import { Copy, Layers, X } from "lucide-react";
import type { LayerNode } from "../contracts/layers";
import type { SnapshotFrame } from "../contracts/snapshot";
import { Button } from "./components/ui/button";
import { copyText } from "./clipboard";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
} from "./components/ui/sidebar";

export function InspectPanel({
  node,
  selector,
  frame,
  onClose,
}: {
  node: LayerNode;
  selector: string;
  frame: SnapshotFrame;
  onClose(): void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    try {
      await copyText(selector);
      setCopied(true);
      setError(null);
    } catch {
      setError("Could not copy the selector. Try again.");
    }
  };
  const styles = [
    [
      "Font",
      [node.styles.fontFamily, node.styles.fontSize, node.styles.fontWeight]
        .filter(Boolean)
        .join(" · "),
    ],
    ["Padding", node.styles.padding],
    ["Radius", node.styles.borderRadius],
    ["Fill", node.styles.backgroundColor],
    ["Text", node.styles.color],
  ].filter(([, value]) => value);
  return (
    <Sidebar
      collapsible="none"
      side="right"
      className="w-[272px]! shrink-0 border-l"
      aria-label="Layer inspection"
    >
      <SidebarHeader className="h-14 flex-row items-center justify-between border-b px-4">
        <h2 className="font-medium">Inspect layer</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close layer inspection"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </SidebarHeader>
      <SidebarContent className="gap-0 p-4">
        <div className="flex items-center gap-2">
          <Layers className="size-4 shrink-0 text-signal" />
          <span className="truncate">{node.name}</span>
        </div>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {frame.meta.name} · {frame.meta.width}px
        </p>
        <h3 className="mt-6 text-[11px] text-muted-foreground">Geometry</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {[
            ["X", node.box.x],
            ["Y", node.box.y],
            ["Width", node.box.width],
            ["Height", node.box.height],
          ].map(([key, value]) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-md border bg-card px-2.5 py-2"
            >
              <span className="text-[11px] text-muted-foreground">{key}</span>
              <span className="font-mono text-[11px]">
                {Math.round(Number(value))}
              </span>
            </div>
          ))}
        </div>
        <h3 className="mt-6 text-[11px] text-muted-foreground">
          Computed styles
        </h3>
        <div className="mt-2">
          {styles.map(([key, value]) => (
            <div
              key={key}
              className="flex items-start justify-between gap-3 border-b py-2.5 text-xs"
            >
              <span className="shrink-0 text-muted-foreground">{key}</span>
              <span className="text-right font-mono text-[11px] break-all">
                {value}
              </span>
            </div>
          ))}
        </div>
        <h3 className="mt-6 text-[11px] text-muted-foreground">Source</h3>
        <p className="mt-2 font-mono text-[11px] break-all text-muted-foreground">
          {node.source ?? frame.relFile}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => void copy()}
        >
          <Copy className="size-3.5" />
          {copied ? "Selector copied" : "Copy selector"}
        </Button>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <p className="mt-6 rounded-lg border p-3 text-xs leading-5 text-muted-foreground">
          Rename in the layer tree. The name updates the source and every
          instance of this layer.
        </p>
      </SidebarContent>
      <SidebarFooter className="border-t p-4 text-[11px] text-muted-foreground">
        Your agent can see this layer and viewport.
      </SidebarFooter>
    </Sidebar>
  );
}
