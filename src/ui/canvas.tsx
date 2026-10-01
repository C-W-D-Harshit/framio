import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "../server/server";
import { FrameNode, type FrameNodeType } from "./frame-node";
import { layoutFrames } from "./layout";

type Page = Snapshot["pages"][number];
type Pos = { x: number; y: number };

const nodeTypes: NodeTypes = { frame: FrameNode };

type Props = {
  page: Page;
  heights: Record<string, number>;
  selectedFrame: string | null;
  onSelectFrame(id: string | null): void;
};

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ page, heights, selectedFrame, onSelectFrame }: Props) {
  const flow = useReactFlow();
  // Positions the user dragged in this session, applied before the server echoes canvas.json back.
  const [moved, setMoved] = useState<Record<string, Pos>>({});
  const saved = useMemo(() => ({ ...page.positions, ...moved }), [page.positions, moved]);

  const laidOut = useMemo<FrameNodeType[]>(() => {
    const pos = layoutFrames(page.frames, heights, saved);
    return page.frames.map((frame) => ({
      id: frame.id,
      type: "frame",
      position: pos[frame.id]!,
      dragHandle: ".frame-drag",
      selected: frame.id === selectedFrame,
      data: { frame, height: heights[frame.id] ?? frame.meta.height },
    }));
  }, [page.frames, heights, saved, selectedFrame]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FrameNodeType>(laidOut);
  useEffect(() => {
    setNodes((prev) => {
      const dragging = new Map(prev.filter((n) => n.dragging).map((n) => [n.id, n]));
      return laidOut.map((n) => {
        const d = dragging.get(n.id);
        return d ? { ...n, position: d.position, dragging: true } : n;
      });
    });
  }, [laidOut, setNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      page.frames
        .filter((f) => f.parent && page.frames.some((p) => p.id === f.parent))
        .map((f) => ({ id: `${f.parent}->${f.id}`, source: f.parent!, target: f.id, selectable: false })),
    [page.frames],
  );

  // Frames report their real height after loading; keep the initial fit in sync until the user moves.
  const mountedAt = useRef(performance.now());
  const userMoved = useRef(false);
  useEffect(() => {
    if (userMoved.current || performance.now() - mountedAt.current > 3000) return;
    const raf = requestAnimationFrame(() => flow.fitView({ padding: 0.15 }));
    return () => cancelAnimationFrame(raf);
  }, [laidOut, flow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.shiftKey && e.code === "Digit1") flow.fitView({ padding: 0.15, duration: 200 });
      if (e.shiftKey && e.code === "Digit0") flow.zoomTo(1, { duration: 200 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelectFrame(node.id)}
      onPaneClick={() => onSelectFrame(null)}
      onMoveStart={(e) => {
        if (e) userMoved.current = true;
      }}
      onNodeDragStop={(_, node) => {
        const frame = page.frames.find((f) => f.id === node.id);
        if (!frame) return;
        const pos = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
        setMoved((m) => ({ ...m, [frame.slug]: pos }));
        fetch("/api/canvas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ page: page.id, positions: { [frame.slug]: pos } }),
        });
      }}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.03}
      maxZoom={4}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      selectionOnDrag={false}
      nodesConnectable={false}
      elementsSelectable
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
    >
      <ZoomIndicator />
    </ReactFlow>
  );
}

function ZoomIndicator() {
  const zoom = useStore((s) => s.transform[2]);
  const flow = useReactFlow();
  useEffect(() => document.documentElement.style.setProperty("--zoom", String(zoom)), [zoom]);
  return (
    <button
      type="button"
      onClick={() => flow.fitView({ padding: 0.15, duration: 200 })}
      title="Zoom to fit (Shift+1)"
      className="absolute right-3 bottom-3 z-10 rounded-md border border-chrome-line bg-chrome px-2 py-1 text-xs text-neutral-400 tabular-nums hover:text-neutral-200"
    >
      {Math.round(zoom * 100)}%
    </button>
  );
}
