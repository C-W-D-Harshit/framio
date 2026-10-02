import { geometryFingerprint } from "./frame-geometry";
import { registerFrame } from "./frame-bridge";
import { PreviewImage } from "./preview-image";
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
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Atom, AsyncResult } from "effect/reactivity";
import { FrameMessage } from "../contracts/frame-message";
import { previewAtom, readyVersionAtom } from "./state";
import { BOOT_TIMEOUT_MS } from "./preview-policy";
import type { SnapshotFrame } from "../contracts/snapshot";

export type FrameNodeData = {
  frame: SnapshotFrame;
  parentName?: string;
  comments: readonly Comment[];
  showResolved: boolean;
  onComment(id: string): void;
  height: number;
  cssVersion: number;
};
export type FrameNodeType = Node<FrameNodeData, "frame">;

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
export const thumbUrl = (f: SnapshotFrame, css: number, scale = 0.5) =>
  `/thumb/${enc(f.page)}/${enc(f.slug)}.png?v=${f.version}-${css}&width=${f.meta.width}&scale=${scale}`;

function enableFrameInput(event: SyntheticEvent<HTMLIFrameElement>) {
  // Until the runtime is installed, input must hit the canvas below.
  if (event.currentTarget.contentWindow?.__framio)
    event.currentTarget.dataset.inputReady = "true";
}

export const FrameNode = memo(function FrameNode({
  data,
  selected,
}: NodeProps<FrameNodeType>) {
  const { frame, height, cssVersion } = data;
  const layers = useLayerReport(frame.id);
  const { width } = frame.meta;
  const mode = useAtomValue(previewAtom(frame.id));
  const readyVersion = useAtomValue(readyVersionAtom(frame.id));
  const { visible, scale } = mode;
  const isImage = frame.kind === "image";
  const live = !isImage && mode.live;
  const geometryKey = geometryFingerprint(frame, frame.meta.width, cssVersion);
  const onHeight = useCallback(
    (height: number) =>
      window.dispatchEvent(
        new CustomEvent("framio:height", {
          detail: { id: frame.id, height, key: geometryKey },
        }),
      ),
    [frame.id, geometryKey],
  );

  // Double-buffered reloads: the new version loads hidden and replaces the old one once rendered.
  const [shown, setShown] = useState(frame.version);
  const pending = frame.version !== shown && mode.reload ? frame.version : null;
  const pendingRef = useRef<HTMLIFrameElement>(null);
  const loadingVersion = pending ?? shown;
  const bootTimeoutAtom = useMemo(
    () =>
      Atom.make(
        Effect.gen(function* () {
          if (!live) return;
          yield* Effect.sleep(BOOT_TIMEOUT_MS);
          yield* Effect.sync(() =>
            window.dispatchEvent(
              new CustomEvent("framio:frame-state", {
                detail: {
                  id: frame.id,
                  version: loadingVersion,
                  phase: "expired",
                },
              }),
            ),
          );
        }),
      ),
    [live, frame.id, loadingVersion],
  );
  useAtomValue(bootTimeoutAtom);
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

  useEffect(() => {
    if (!live) setShown(frame.version);
    else
      window.dispatchEvent(
        new CustomEvent("framio:frame-state", {
          detail: {
            id: frame.id,
            version: shown,
            phase: "shown",
          },
        }),
      );
  }, [live, shown, frame.id, frame.version]);
  useEffect(() => {
    if (live)
      window.dispatchEvent(
        new CustomEvent("framio:frame-state", {
          detail: {
            id: frame.id,
            version: pending ?? shown,
            phase: "loading",
          },
        }),
      );
  }, [live, pending, shown, frame.id]);
  const versions = pending === null ? [shown] : [shown, pending];

  return (
    <div style={{ width }}>
      {frame.meta.widths && width === Math.max(...frame.meta.widths) && (
        <div
          className="frame-drag absolute bottom-full left-0 flex max-w-full items-center gap-2 whitespace-nowrap"
          style={{
            fontSize: "calc(12px / var(--zoom, 1))",
            paddingBottom: "calc(42px / var(--zoom, 1))",
          }}
        >
          <Frame
            className="shrink-0 text-signal"
            style={{
              width: "calc(14px / var(--zoom, 1))",
              height: "calc(14px / var(--zoom, 1))",
            }}
          />
          <span className="font-medium">{frame.meta.name}</span>
          <span
            className="font-mono text-muted-foreground"
            style={{ fontSize: "calc(11px / var(--zoom, 1))" }}
          >
            · {frame.relFile.split("/").pop()}
          </span>
          <span
            className="rounded-sm border px-[.5em] py-[.2em] text-muted-foreground"
            style={{ fontSize: "calc(11px / var(--zoom, 1))" }}
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
        style={{
          fontSize: "calc(11px / var(--zoom, 1))",
          paddingBottom: "calc(6px / var(--zoom, 1))",
        }}
        title="Drag to move · Double-click to zoom · Right-click for more"
      >
        {!!layers?.warnings.length && (
          <span
            className="text-warning"
            title={layers.warnings.map((w) => w.message).join("\n")}
          >
            <AlertTriangle
              className="inline"
              style={{
                width: "calc(12px / var(--zoom, 1))",
                height: "calc(12px / var(--zoom, 1))",
              }}
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
                <Smartphone
                  style={{
                    width: "calc(12px / var(--zoom, 1))",
                    height: "calc(12px / var(--zoom, 1))",
                  }}
                />
              ) : width < 1000 ? (
                <Tablet
                  style={{
                    width: "calc(12px / var(--zoom, 1))",
                    height: "calc(12px / var(--zoom, 1))",
                  }}
                />
              ) : (
                <Monitor
                  style={{
                    width: "calc(12px / var(--zoom, 1))",
                    height: "calc(12px / var(--zoom, 1))",
                  }}
                />
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
        className="frame-surface relative overflow-hidden bg-frame-surface"
        style={{
          height,
          outline: selected
            ? "calc(2px / var(--zoom, 1)) solid var(--signal)"
            : "none",
          boxShadow: "0 1px 3px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25)",
        }}
      >
        {visible &&
          (!live || readyVersion !== shown) &&
          (isImage && scale === 1 ? (
            <img
              src={imageUrl(frame)}
              alt={frame.meta.name}
              draggable={false}
              className="block size-full object-contain"
            />
          ) : (
            <PreviewImage
              src={thumbUrl(frame, cssVersion, scale)}
              alt={frame.meta.name}
              onHeight={onHeight}
              fallbackSrc={isImage ? imageUrl(frame) : undefined}
            />
          ))}
        {live &&
          versions.map((v) => (
            <iframe
              key={v}
              ref={(iframe) => {
                if (!iframe) return;
                if (v === pending) pendingRef.current = iframe;
                const unregister = registerFrame(iframe);
                return () => {
                  unregister();
                  if (pendingRef.current === iframe) pendingRef.current = null;
                };
              }}
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
