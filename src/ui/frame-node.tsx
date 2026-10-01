import {
  Monitor,
  Smartphone,
  Tablet,
  Frame,
  AlertTriangle,
} from "lucide-react";
import { useLayerReport } from "./layers-panel";
import { CommentPins } from "./comments";
import type { Comment } from "../contracts/comments";
import {
  Handle,
  Position,
  useStore,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Atom, AsyncResult } from "effect/reactivity";
import { FrameMessage } from "../contracts/frame-message";
import { heightsAtom } from "./state";
import type { SnapshotFrame } from "../contracts/snapshot";

export type FrameNodeData = {
  frame: SnapshotFrame;
  parentName?: string;
  comments: readonly Comment[];
  showResolved: boolean;
  onComment(id: string): void;
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
const canonical = (f: SnapshotFrame) => f.frameId ?? f.id;
export const frameUrl = (f: SnapshotFrame, version = f.version) =>
  `/f/${enc(f.page)}/${enc(f.slug)}?canvas=1&v=${version}&width=${f.meta.width}&height=${f.meta.height}`;
export const imageUrl = (f: SnapshotFrame) =>
  `/img/${enc(f.page)}/${enc(f.slug)}?v=${f.version}`;
/** URL to view a frame on its own, outside the canvas. */
export const standaloneUrl = (f: SnapshotFrame) =>
  f.kind === "image"
    ? imageUrl(f)
    : `/f/${enc(f.page)}/${enc(f.slug)}?width=${f.meta.width}&height=${f.meta.height}`;
const thumbUrl = (f: SnapshotFrame, css: number) =>
  `/thumb/${enc(f.page)}/${enc(f.slug)}.png?v=${f.version}-${css}&width=${f.meta.width}`;

function enableFrameInput(event: SyntheticEvent<HTMLIFrameElement>) {
  // Until the runtime is installed, input must hit the canvas below.
  if (event.currentTarget.contentWindow?.__framio)
    event.currentTarget.dataset.inputReady = "true";
}

export const FrameNode = memo(function FrameNode({
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<FrameNodeType>) {
  const { frame, height, cssVersion, useThumbs } = data;
  const layers = useLayerReport(frame.id);
  const { width } = frame.meta;
  const setHeights = useAtomSet(heightsAtom(frame.page));
  const zoom = useStore((s) => s.transform[2]);
  // Only frames near the viewport mount an iframe; off-screen frames cost nothing.
  const visible = useStore((s) => {
    const [tx, ty, z] = s.transform;
    const left = positionAbsoluteX * z + tx;
    const top = positionAbsoluteY * z + ty;
    const mx = s.width * 0.5;
    const my = s.height * 0.5;
    return (
      left < s.width + mx &&
      left + width * z > -mx &&
      top < s.height + my &&
      top + height * z > -my
    );
  });
  const isImage = frame.kind === "image";
  const hasPins = data.comments.some(
    (c) =>
      c.frame === (frame.frameId ?? frame.id) &&
      (data.showResolved || c.status === "open"),
  );
  const live =
    !isImage &&
    (visible || selected) &&
    (selected || !useThumbs || zoom >= LIVE_ZOOM || hasPins);

  // Double-buffered reloads: the new version loads hidden and replaces the old one once rendered.
  const [shown, setShown] = useState(frame.version);
  const pending = frame.version !== shown ? frame.version : null;
  const pendingRef = useRef<HTMLIFrameElement>(null);
  const switchAtom = useMemo(
    () =>
      Atom.make(
        Effect.gen(function* () {
          if (pending === null || !live) return pending;
          yield* Effect.callback<void>((resume) => {
            const onMessage = (event: MessageEvent) => {
              if (
                event.source !== pendingRef.current?.contentWindow ||
                event.origin !== location.origin
              )
                return;
              const decoded = Schema.decodeUnknownResult(FrameMessage)(
                event.data,
              );
              if (
                Result.isSuccess(decoded) &&
                (decoded.success.type === "ready" ||
                  decoded.success.type === "error")
              )
                resume(Effect.void);
            };
            window.addEventListener("message", onMessage);
            return Effect.sync(() =>
              window.removeEventListener("message", onMessage),
            );
          }).pipe(Effect.timeoutOption("8 seconds"));
          return pending;
        }),
      ),
    [pending, live],
  );
  const switchResult = useAtomValue(switchAtom);
  useEffect(() => {
    if (AsyncResult.isSuccess(switchResult) && switchResult.value !== null)
      setShown(switchResult.value);
  }, [switchResult]);

  const versions = pending === null ? [shown] : [shown, pending];

  return (
    <div style={{ width }}>
      {frame.meta.widths && width === Math.max(...frame.meta.widths) && (
        <div
          className="frame-drag absolute bottom-full left-0 flex max-w-full items-center gap-2 whitespace-nowrap"
          style={{ fontSize: 12 / zoom, paddingBottom: 42 / zoom }}
        >
          <Frame
            className="shrink-0 text-signal"
            style={{ width: 14 / zoom, height: 14 / zoom }}
          />
          <span className="font-medium">{frame.meta.name}</span>
          <span
            className="font-mono text-muted-foreground"
            style={{ fontSize: 11 / zoom }}
          >
            · {frame.relFile.split("/").pop()}
          </span>
          <span
            className="rounded-sm border px-[.5em] py-[.2em] text-muted-foreground"
            style={{ fontSize: 11 / zoom }}
          >
            {frame.meta.widths.length} viewports
          </span>
          {data.parentName && (
            <span className="text-muted-foreground">
              Variation of {data.parentName}
            </span>
          )}
        </div>
      )}
      <div
        className="frame-drag absolute bottom-full left-0 flex max-w-full cursor-default items-baseline gap-[0.5em] truncate whitespace-nowrap"
        style={{ fontSize: 11 / zoom, paddingBottom: 6 / zoom }}
        title="Drag to move · Double-click to zoom · Right-click for more"
      >
        {!!layers?.warnings.length && (
          <span
            className="text-warning"
            title={layers.warnings.map((w) => w.message).join("\n")}
          >
            <AlertTriangle
              className="inline"
              style={{ width: 12 / zoom, height: 12 / zoom }}
            />{" "}
            {layers.warnings.length}
          </span>
        )}
        {frame.error && (
          <span className="inline-block size-[0.6em] shrink-0 self-center rounded-full bg-destructive" />
        )}
        <span
          className={
            selected
              ? "text-signal"
              : frame.error
                ? "text-destructive"
                : "text-foreground"
          }
        >
          {frame.meta.widths ? (
            <span className="flex items-center gap-[.5em]">
              {width < 600 ? (
                <Smartphone style={{ width: 12 / zoom, height: 12 / zoom }} />
              ) : width < 1000 ? (
                <Tablet style={{ width: 12 / zoom, height: 12 / zoom }} />
              ) : (
                <Monitor style={{ width: 12 / zoom, height: 12 / zoom }} />
              )}
              {width < 600 ? "Mobile" : width < 1000 ? "Tablet" : "Desktop"}
            </span>
          ) : (
            frame.meta.name
          )}
        </span>
        <span className="font-mono text-muted-foreground">
          {width} × {frame.meta.height}
        </span>
      </div>
      <div
        className="relative overflow-hidden bg-frame-surface"
        style={{
          height,
          outline: selected ? `${2 / zoom}px solid var(--signal)` : "none",
          boxShadow: "0 1px 3px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25)",
        }}
      >
        {isImage && visible && (
          <img
            src={imageUrl(frame)}
            alt={frame.meta.name}
            draggable={false}
            className="block size-full object-contain"
          />
        )}
        {!isImage && visible && useThumbs && (
          <img
            src={thumbUrl(frame, cssVersion)}
            alt=""
            draggable={false}
            className="absolute inset-0 w-full"
            // Frames that never went live still need their real height for layout; report it like an iframe would.
            onLoad={(event) => {
              const height = Math.round(
                event.currentTarget.naturalHeight / THUMB_SCALE,
              );
              setHeights((current) =>
                current[frame.id] === height
                  ? current
                  : { ...current, [frame.id]: height },
              );
            }}
          />
        )}
        {live &&
          versions.map((v) => (
            <iframe
              key={v}
              ref={v === pending ? pendingRef : undefined}
              title={frame.meta.name}
              data-frame={frame.id}
              onLoad={enableFrameInput}
              src={frameUrl(frame, v)}
              className="absolute inset-0 block border-0"
              style={{
                width,
                height,
                visibility: v === pending ? "hidden" : "visible",
              }}
            />
          ))}
      </div>
      <CommentPins
        frame={frame}
        comments={data.comments}
        showResolved={data.showResolved}
        onComment={data.onComment}
        zoom={zoom}
      />
      {(frame.note || frame.source) && (
        <div
          className="absolute top-full left-0 flex max-w-full flex-col gap-[0.3em] text-muted-foreground"
          style={{ fontSize: 12, paddingTop: 8, lineHeight: 1.45 }}
        >
          {frame.note && <p className="whitespace-pre-wrap">{frame.note}</p>}
          {frame.source && (
            <a
              data-ui
              href={frame.source}
              target="_blank"
              rel="noreferrer"
              className="nodrag truncate text-muted-foreground underline hover:text-foreground"
            >
              {frame.source.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
      )}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!opacity-0"
      />
    </div>
  );
});
