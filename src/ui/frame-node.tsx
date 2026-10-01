import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import type { SnapshotFrame } from "../server/server";

export type FrameNodeData = {
  frame: SnapshotFrame;
  height: number;
  cssVersion: number;
  /** Large pages swap live iframes for server-rendered thumbnails when zoomed out. */
  useThumbs: boolean;
};
export type FrameNodeType = Node<FrameNodeData, "frame">;

/** Below this zoom, frames on large pages render as thumbnails instead of live iframes. */
const LIVE_ZOOM = 0.25;
/** Must match the deviceScaleFactor the server renders thumbnails at. */
const THUMB_SCALE = 0.5;

const enc = encodeURIComponent;
export const frameUrl = (f: SnapshotFrame, version = f.version) => `/f/${enc(f.page)}/${enc(f.slug)}?canvas=1&v=${version}`;
const thumbUrl = (f: SnapshotFrame, css: number) => `/thumb/${enc(f.page)}/${enc(f.slug)}.png?v=${f.version}-${css}`;

export const FrameNode = memo(function FrameNode({
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<FrameNodeType>) {
  const { frame, height, cssVersion, useThumbs } = data;
  const { width } = frame.meta;
  const zoom = useStore((s) => s.transform[2]);
  // Only frames near the viewport mount an iframe; off-screen frames cost nothing.
  const visible = useStore((s) => {
    const [tx, ty, z] = s.transform;
    const left = positionAbsoluteX * z + tx;
    const top = positionAbsoluteY * z + ty;
    const mx = s.width * 0.5;
    const my = s.height * 0.5;
    return left < s.width + mx && left + width * z > -mx && top < s.height + my && top + height * z > -my;
  });
  const live = visible && (!useThumbs || zoom >= LIVE_ZOOM);

  // Double-buffered reloads: the new version loads hidden and replaces the old one once rendered.
  const [shown, setShown] = useState(frame.version);
  const pending = frame.version !== shown ? frame.version : null;
  const pendingRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (pending === null) return;
    if (!live) return setShown(pending);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== pendingRef.current?.contentWindow || e.data?.source !== "framio") return;
      if (e.data.type === "ready" || e.data.type === "error") setShown(pending);
    };
    const fallback = setTimeout(() => setShown(pending), 8000);
    window.addEventListener("message", onMessage);
    return () => {
      clearTimeout(fallback);
      window.removeEventListener("message", onMessage);
    };
  }, [pending, live]);

  const versions = pending === null ? [shown] : [shown, pending];

  return (
    <div style={{ width }}>
      <div
        className="frame-drag absolute bottom-full left-0 flex max-w-full cursor-default items-baseline gap-[0.5em] truncate whitespace-nowrap"
        style={{ fontSize: 12 / zoom, paddingBottom: 6 / zoom }}
        title="Drag to move · Double-click to zoom · Right-click for more"
      >
        {frame.error && <span className="inline-block size-[0.6em] shrink-0 self-center rounded-full bg-red-500" />}
        <span className={selected ? "text-accent" : "text-neutral-300"}>{frame.meta.name}</span>
        <span className="text-neutral-500">
          {width} × {frame.meta.height}
        </span>
      </div>
      <div
        className="relative overflow-hidden bg-white"
        style={{
          height,
          outline: selected ? `${2 / zoom}px solid var(--color-accent)` : "none",
          boxShadow: "0 1px 3px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25)",
        }}
      >
        {visible && useThumbs && (
          <img
            src={thumbUrl(frame, cssVersion)}
            alt=""
            draggable={false}
            className="absolute inset-0 w-full"
            // Frames that never went live still need their real height for layout; report it like an iframe would.
            onLoad={(e) =>
              window.postMessage(
                { source: "framio", type: "size", frame: frame.id, height: Math.round(e.currentTarget.naturalHeight / THUMB_SCALE) },
                "*",
              )
            }
          />
        )}
        {live &&
          versions.map((v) => (
            <iframe
              key={v}
              ref={v === pending ? pendingRef : undefined}
              title={frame.meta.name}
              data-frame={frame.id}
              src={frameUrl(frame, v)}
              className="absolute inset-0 block border-0"
              style={{ width, height, visibility: v === pending ? "hidden" : "visible" }}
            />
          ))}
      </div>
      <Handle type="target" position={Position.Left} isConnectable={false} className="!opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!opacity-0" />
    </div>
  );
});
