import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { SnapshotFrame } from "../server/server";

export type FrameNodeData = { frame: SnapshotFrame; height: number };
export type FrameNodeType = Node<FrameNodeData, "frame">;

export const frameUrl = (f: SnapshotFrame) =>
  `/f/${encodeURIComponent(f.page)}/${encodeURIComponent(f.slug)}?canvas=1&v=${f.version}`;

export const FrameNode = memo(function FrameNode({ data, selected }: NodeProps<FrameNodeType>) {
  const zoom = useStore((s) => s.transform[2]);
  const { frame, height } = data;
  const { width } = frame.meta;

  return (
    <div style={{ width }}>
      <div
        className="frame-drag absolute bottom-full left-0 flex max-w-full cursor-grab items-baseline gap-[0.5em] truncate whitespace-nowrap active:cursor-grabbing"
        style={{ fontSize: 12 / zoom, paddingBottom: 6 / zoom }}
      >
        {frame.error && <span className="inline-block size-[0.6em] shrink-0 self-center rounded-full bg-red-500" />}
        <span className={selected ? "text-accent" : "text-neutral-300"}>{frame.meta.name}</span>
        <span className="text-neutral-500">
          {width} × {frame.meta.height}
        </span>
      </div>
      <div
        className="relative bg-white"
        style={{
          height,
          outline: selected ? `${2 / zoom}px solid var(--color-accent)` : "none",
          boxShadow: "0 1px 3px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25)",
        }}
      >
        <iframe
          title={frame.meta.name}
          data-frame={frame.id}
          src={frameUrl(frame)}
          className="block border-0"
          style={{ width, height }}
        />
      </div>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
    </div>
  );
});
