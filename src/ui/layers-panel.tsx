import { Input } from "./components/ui/input";
import { ChevronDown, ChevronRight, Layers, Type, Image } from "lucide-react";
import { Button } from "./components/ui/button";
import { memo, useEffect, useMemo, useState } from "react";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { layersAtom, selectionAtom, renameLayerAtom } from "./state";
import type { LayerNode, LayerReport } from "../contracts/layers";
import type { SnapshotFrame } from "../contracts/snapshot";
import { flattenLayers } from "../domain/layers";

export function postLayer(
  frame: string,
  type: "layer-hover" | "layer-select",
  path: string | null,
) {
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>(
    "iframe[data-frame]",
  )) {
    if (iframe.dataset.frame === frame && iframe.style.visibility !== "hidden")
      iframe.contentWindow?.postMessage(
        { source: "framio-canvas", type, path },
        location.origin,
      );
  }
}
/** One report subscription per live frame, also supplies warnings on the canvas. */
export function useLayerReport(frame: string) {
  const [report, setReport] = useAtom(layersAtom(frame));
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (
        event as CustomEvent<{ frame: string; report: LayerReport }>
      ).detail;
      if (detail.frame === frame) setReport(detail.report);
    };
    window.addEventListener("framio:layers", listener);
    return () => window.removeEventListener("framio:layers", listener);
  }, [frame, setReport]);
  return report;
}
type Row = {
  key: string;
  depth: number;
  label: string;
  node: LayerNode;
  count: number;
  expandable: boolean;
};
function rowsFor(
  tree: readonly LayerNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): Row[] {
  const groups = new Map<string, LayerNode[]>();
  for (const node of tree) {
    const group = groups.get(node.name) ?? [];
    group.push(node);
    groups.set(node.name, group);
  }
  const rows: Row[] = [];
  for (const group of groups.values()) {
    const node = group[0]!;
    const key = group.length > 1 ? `${node.path}:group` : node.path;
    rows.push({
      key,
      depth,
      label: node.name + (group.length > 1 ? ` ×${group.length}` : ""),
      node,
      count: group.length,
      expandable: group.length > 1 || node.children.length > 0,
    });
    if (!expanded.has(key)) continue;
    if (group.length > 1) {
      for (const item of group) {
        rows.push({
          key: item.path,
          depth: depth + 1,
          label: `${item.name} ${item.path.match(/\[(\d+)\]$/)?.[1]}`,
          node: item,
          count: group.length,
          expandable: item.children.length > 0,
        });
        if (expanded.has(item.path))
          rows.push(...rowsFor(item.children, expanded, depth + 2));
      }
    } else rows.push(...rowsFor(node.children, expanded, depth + 1));
  }
  return rows;
}
export const LayersPanel = memo(function LayersPanel({
  frame,
  project,
  onInspect,
}: {
  frame?: SnapshotFrame;
  project: string;
  onInspect?: () => void;
}) {
  return (
    <section className="ml-5 flex min-h-0 flex-col border-l border-border">
      {frame ? (
        <FrameLayers
          key={`${project}/${frame.id}`}
          onInspect={onInspect}
          frame={frame}
          project={project}
        />
      ) : (
        <p className="px-4 text-xs text-muted-foreground">
          Select a frame to see its layers
        </p>
      )}
    </section>
  );
});
function FrameLayers({
  frame,
  project,
  onInspect,
}: {
  frame: SnapshotFrame;
  project: string;
  onInspect?: () => void;
}) {
  const report = useLayerReport(frame.id);
  const [selection] = useAtom(selectionAtom);
  const rename = useAtomSet(renameLayerAtom(frame.id));
  const result = useAtomValue(renameLayerAtom(frame.id));
  const storageKey = `framio:layers:${project}/${frame.id}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [editing, setEditing] = useState<{ row: Row; name: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const nodes = useMemo(() => flattenLayers(report?.tree ?? []), [report]);
  useEffect(() => {
    const path = selection.layer?.path;
    if (!path) return;
    setExpanded((current) => {
      const next = new Set(current);
      const parts = path.split("/");
      for (let index = 0; index < parts.length; index++) {
        const ancestor = parts.slice(0, index + 1).join("/");
        next.add(ancestor);
        next.add(ancestor.replace(/\[\d+\]$/, "[1]") + ":group");
      }
      return next;
    });
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-layer-row="${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }, [selection.layer?.path]);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify([...expanded]));
  }, [expanded, storageKey]);
  const rows = useMemo(
    () => rowsFor(report?.tree ?? [], expanded),
    [report, expanded],
  );
  const failure = AsyncResult.isSuccess(result)
    ? result.value.error
    : AsyncResult.isFailure(result)
      ? "Could not rename the layer. Try again."
      : null;
  return (
    <div className="min-h-0 overflow-y-auto px-2 pb-3">
      {report?.warnings.map((warning) => (
        <p
          key={`${warning.path}:${warning.message}`}
          className="mb-2 rounded bg-warning/10 p-2 text-[11px] text-warning"
        >
          {warning.message}
        </p>
      ))}
      {(message || failure) && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {message || failure}
        </p>
      )}
      {!report && (
        <p className="px-2 text-xs text-muted-foreground">
          {frame.kind === "image"
            ? "Image frames have no layers"
            : "Waiting for frame layers…"}
        </p>
      )}
      <div role="tree" aria-label="Layers">
        {rows.map((row) => (
          <div
            key={row.key}
            role="treeitem"
            tabIndex={0}
            aria-level={row.depth + 1}
            aria-label={row.label}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                postLayer(frame.id, "layer-select", row.node.path);
                onInspect?.();
              } else if (
                event.key === "ArrowRight" ||
                event.key === "ArrowLeft"
              ) {
                event.preventDefault();
                setExpanded((current) => {
                  const next = new Set(current);
                  if (event.key === "ArrowRight") next.add(row.key);
                  else next.delete(row.key);
                  return next;
                });
              }
            }}
            aria-selected={selection.layer?.path === row.node.path}
            aria-expanded={row.expandable ? expanded.has(row.key) : undefined}
            data-layer-row={row.key}
            className={`flex min-h-7 items-center rounded text-xs ${selection.layer?.path === row.node.path ? "bg-primary/15 text-signal" : "text-muted-foreground hover:bg-accent"}`}
            style={{ paddingLeft: row.depth * 12 }}
            onMouseEnter={() =>
              postLayer(frame.id, "layer-hover", row.node.path)
            }
            onMouseLeave={() => postLayer(frame.id, "layer-hover", null)}
          >
            <Button
              variant="ghost"
              type="button"
              aria-label={`Toggle ${row.label}`}
              disabled={!row.expandable}
              size="icon-xs"
              className="shrink-0"
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(row.key)) next.delete(row.key);
                  else next.add(row.key);
                  return next;
                })
              }
            >
              {row.expandable ? (
                expanded.has(row.key) ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )
              ) : (
                <span className="size-3" />
              )}
            </Button>
            {editing?.row.key === row.key ? (
              <form
                className="min-w-0 flex-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!row.node.source) return;
                  rename({ source: row.node.source, name: editing.name });
                  setEditing(null);
                }}
              >
                <Input
                  autoFocus
                  aria-label="Layer name"
                  className="w-full rounded bg-card px-1 py-1 text-foreground outline outline-ring"
                  value={editing.name}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {nodes.filter((n) => n.source === row.node.source).length > 1
                    ? `Renames all ${nodes.filter((n) => n.source === row.node.source).length}`
                    : "Enter saves · Esc cancels"}
                </span>
              </form>
            ) : (
              <Button
                variant="ghost"
                type="button"
                className="h-7 min-w-0 flex-1 justify-start gap-2 truncate p-0 text-left text-xs font-normal"
                title={row.node.path}
                onClick={() => {
                  postLayer(frame.id, "layer-select", row.node.path);
                  onInspect?.();
                }}
                onDoubleClick={() => {
                  if (!row.node.source) {
                    setMessage(
                      "No unambiguous source location for this layer. Check for spread or duplicate attributes.",
                    );
                    return;
                  }
                  setMessage(null);
                  setEditing({ row, name: row.node.name });
                }}
              >
                {row.node.path.includes("/img[") ? (
                  <Image className="size-3" />
                ) : /\/(h[1-6]|p|span|button)\[/.test(row.node.path) ? (
                  <Type className="size-3" />
                ) : (
                  <Layers className="size-3" />
                )}
                {row.label}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
