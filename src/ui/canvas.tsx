import { viewportId, viewports } from "../domain/viewports";
import { CommentsPanel, type CommentDraft } from "./comments";
import type { Comment } from "../contracts/comments";
import {
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type NodeTypes,
  type Viewport,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  FrameMessage,
  Viewport as ViewportSchema,
} from "../contracts/frame-message";
import { useAtom, useAtomSet } from "@effect/atom-react";
import {
  heightsAtom,
  movedAtom,
  selectionAtom,
  saveSelectionAtom,
  saveCanvasAtom,
} from "./state";
import type { ElementInfo as ElementContract } from "../contracts/requests";
import type { Snapshot } from "../contracts/snapshot";
import { ContextMenu } from "./context-menu";
import { FrameNode, standaloneUrl, type FrameNodeType } from "./frame-node";
import { layoutViewports } from "./layout";
import { Toolbar, type Tool } from "./toolbar";

type Page = Snapshot["pages"][number];
type Pos = { x: number; y: number };
export type ElementInfo = typeof ElementContract.Type;
export type CanvasSelection = {
  readonly frames: readonly string[];
  readonly element: ElementInfo | null;
  readonly layer?: { readonly path: string; readonly name: string };
};

const nodeTypes: NodeTypes = { frame: FrameNode };
const FIT = { padding: 0.15 };
/** Pages with more frames than this use thumbnails when zoomed out. */
const THUMB_THRESHOLD = 8;

type Props = {
  page: Page;
  projectName: string;
  cssVersion: number;
  tool: Tool;
  onTool(tool: Tool): void;
  comments: readonly Comment[];
  commentsError: string | null;
};

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function postToFrames(msg: Record<string, unknown>, except?: string) {
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>(
    "iframe[data-frame]",
  )) {
    if (iframe.dataset.frame !== except)
      iframe.contentWindow?.postMessage(
        { source: "framio-canvas", ...msg },
        "*",
      );
  }
}

function useSavedViewport(key: string) {
  const [initial] = useState<Viewport | null>(() => {
    try {
      const decoded = Schema.decodeUnknownResult(
        Schema.fromJsonString(Schema.NullOr(ViewportSchema)),
      )(localStorage.getItem(key) ?? "null");
      return Result.isSuccess(decoded) ? decoded.success : null;
    } catch {
      return null;
    }
  });
  const save = useCallback(
    (vp: Viewport) => localStorage.setItem(key, JSON.stringify(vp)),
    [key],
  );
  return [initial, save] as const;
}

function CanvasInner({
  page,
  projectName,
  cssVersion,
  tool,
  onTool,
  comments,
  commentsError,
}: Props) {
  const flow = useReactFlow<FrameNodeType>();
  const [showComments, setShowComments] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const pageComments = useMemo(
    () => comments.filter((c) => c.frame.startsWith(`${page.id}/`)),
    [comments, page.id],
  );

  const openComment = useCallback(
    (id: string) => {
      setShowComments(true);
      setActiveComment(id || null);
      setDraft(null);
      const comment = comments.find((c) => c.id === id);
      const node = flow
        .getNodes()
        .find((n) => (n.data.frame.frameId ?? n.id) === comment?.frame);
      if (node && comment) {
        let x = comment.anchor.x,
          y = comment.anchor.y;
        const iframe = [
          ...document.querySelectorAll<HTMLIFrameElement>("iframe[data-frame]"),
        ].find((el) => el.dataset.frame === node.id);
        try {
          const rect = comment.anchor.selector
            ? iframe?.contentDocument
                ?.querySelector(comment.anchor.selector)
                ?.getBoundingClientRect()
            : null;
          if (rect) {
            x += rect.x;
            y += rect.y;
          }
        } catch {}
        void flow.setCenter(node.position.x + x, node.position.y + y, {
          zoom: Math.max(flow.getZoom(), 0.7),
          duration: 250,
        });
      }
    },
    [comments, flow],
  );
  const makeDraft = useCallback(
    (frame: string, x: number, y: number, element: ElementInfo | null) => {
      const base =
        page.frames.find((f) => f.id === frame) ??
        page.frames.find((f) =>
          viewports(f.meta).some(
            (v) => viewportId(f.id, f.meta, v.width) === frame,
          ),
        );
      if (!base) return;
      setDraft({
        frame: base.id,
        anchor:
          element?.selector && element.rect
            ? {
                selector: element.selector,
                x: x - element.rect.x,
                y: y - element.rect.y,
              }
            : { x, y },
      });
      setActiveComment(null);
      setShowComments(true);
    },
    [page.frames],
  );
  const [heights, setHeights] = useAtom(heightsAtom(page.id));
  const saveSelection = useAtomSet(saveSelectionAtom);
  const saveCanvas = useAtomSet(saveCanvasAtom);
  const [savedViewport, saveViewport] = useSavedViewport(
    `framio:viewport:${projectName}/${page.id}`,
  );

  // --- Layout ---------------------------------------------------------------
  // Positions dragged in this session, applied before the server echoes canvas.json back.
  const [moved, setMoved] = useAtom(movedAtom(page.id));
  useEffect(() => {
    setMoved((current) => {
      const entries = Object.entries(current).filter(
        ([slug, position]) =>
          page.positions[slug]?.x !== position.x ||
          page.positions[slug]?.y !== position.y,
      );
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
  }, [page.positions, setMoved]);
  const saved = useMemo(
    () => ({ ...page.positions, ...moved }),
    [page.positions, moved],
  );
  const useThumbs = page.frames.length > THUMB_THRESHOLD;

  const laidOut = useMemo<FrameNodeType[]>(() => {
    return layoutViewports(page.frames, heights, saved).map(
      ({ frame, position }) => ({
        id: frame.id,
        type: "frame",
        position,
        dragHandle: ".frame-drag",
        data: {
          frame,
          comments: pageComments,
          showResolved,
          onComment: openComment,
          height: heights[frame.id] ?? frame.meta.height,
          cssVersion,
          useThumbs,
        },
      }),
    );
  }, [
    page.frames,
    heights,
    saved,
    cssVersion,
    useThumbs,
    pageComments,
    showResolved,
    openComment,
  ]);

  const layoutIndex = useMemo(() => {
    const nodes = new Map(laidOut.map((node) => [node.id, node]));
    const groups = new Map<string, FrameNodeType>();
    for (const node of laidOut) {
      const id = node.data.frame.frameId ?? node.id;
      if (!groups.has(id)) groups.set(id, node);
    }
    return { nodes, groups };
  }, [laidOut]);

  const [nodes, setNodes, onNodesChange] =
    useNodesState<FrameNodeType>(laidOut);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return laidOut.map((n) => {
        const o = old.get(n.id);
        if (!o) return n;
        return {
          ...n,
          selected: o.selected,
          ...(o.dragging ? { position: o.position, dragging: true } : {}),
        };
      });
    });
  }, [laidOut, setNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      page.frames
        .filter((f) => f.parent && page.frames.some((p) => p.id === f.parent))
        .map((f) => ({
          id: `${f.parent}->${f.id}`,
          source:
            laidOut.filter((n) => n.data.frame.frameId === f.parent).at(-1)
              ?.id ?? f.parent!,
          target:
            laidOut.find((n) => n.data.frame.frameId === f.id)?.id ?? f.id,
          selectable: false,
        })),
    [page.frames, laidOut],
  );

  // Frames report their real height after loading; keep the first fit in sync until the user moves.
  const mountedAt = useRef(performance.now());
  const userMoved = useRef(savedViewport !== null);
  const autoFitting = useRef(false);
  useEffect(() => {
    if (userMoved.current || performance.now() - mountedAt.current > 3000)
      return;
    const raf = requestAnimationFrame(() => {
      autoFitting.current = true;
      flow.fitView(FIT).finally(() => (autoFitting.current = false));
    });
    return () => cancelAnimationFrame(raf);
  }, [laidOut, flow]);

  // --- Selection ------------------------------------------------------------
  const [selection, setSelection] = useAtom(selectionAtom);
  // Ignore React Flow's old selection until it acknowledges an iframe selection.
  const pendingSelection = useRef<readonly string[] | null>(null);
  const selectFrames = useCallback(
    (ids: readonly string[]) => {
      pendingSelection.current = [...ids].sort();
      const selected = new Set(ids);
      setNodes((ns) => ns.map((n) => ({ ...n, selected: selected.has(n.id) })));
    },
    [setNodes],
  );

  useEffect(() => {
    postToFrames(
      { type: "clear-selection" },
      selection.element || selection.layer
        ? selection.width
          ? `__viewport__/${selection.frames[0]}/${selection.width}`
          : selection.frames[0]
        : undefined,
    );
  }, [selection]);

  // selection.json is what the agent reads; skip the initial empty state so reloads don't wipe it.
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    saveSelection(selection);
  }, [selection, saveSelection]);

  // --- Navigation helpers ---------------------------------------------------
  const zoomToFrames = useCallback(
    (ids: readonly string[]) =>
      ids.length &&
      flow.fitView({
        nodes: ids.map((id) => ({ id })),
        padding: 0.1,
        duration: 250,
      }),
    [flow],
  );

  // --- Panning: Hand tool, Space + drag, middle-button drag -----------------
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [frameDragging, setFrameDragging] = useState(false);
  useEffect(() => {
    const release = () => setFrameDragging(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
    };
  }, []);
  const panFrom = useRef<Pos | null>(null);
  const hand = tool === "hand" || spaceHeld;

  const startPan = useCallback((x: number, y: number) => {
    panFrom.current = { x, y };
    setPanning(true);
  }, []);
  const movePan = useCallback(
    (x: number, y: number) => {
      const from = panFrom.current;
      if (!from) return;
      const vp = flow.getViewport();
      flow.setViewport({
        x: vp.x + x - from.x,
        y: vp.y + y - from.y,
        zoom: vp.zoom,
      });
      panFrom.current = { x, y };
      userMoved.current = true;
    },
    [flow],
  );
  const endPan = useCallback(() => {
    if (!panFrom.current) return;
    panFrom.current = null;
    setPanning(false);
    saveViewport(flow.getViewport());
  }, [flow, saveViewport]);

  const onPointerDownCapture = (e: ReactPointerEvent) => {
    userMoved.current = true;
    if ((e.target as Element).closest("[data-ui]")) return;
    if (e.button === 0 && (e.target as Element).closest(".frame-drag"))
      setFrameDragging(true);
    if (e.button === 1 || (e.button === 0 && hand)) {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      startPan(e.screenX, e.screenY);
    }
  };

  // --- Context menu ---------------------------------------------------------
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    frame: string;
  } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuFrame =
    menu && laidOut.find((n) => n.id === menu.frame)?.data.frame;

  // --- Keyboard -------------------------------------------------------------
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) setSpaceHeld(true);
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        flow.zoomIn({ duration: 150 });
      } else if (mod && e.key === "-") {
        e.preventDefault();
        flow.zoomOut({ duration: 150 });
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectFrames(laidOut.map((n) => n.id));
      } else if (mod || e.altKey) {
        return;
      } else if (e.shiftKey && e.code === "Digit1")
        flow.fitView({ ...FIT, duration: 250 });
      else if (e.shiftKey && e.code === "Digit2")
        zoomToFrames(
          flow
            .getNodes()
            .filter((n) => n.selected)
            .map((n) => n.id),
        );
      else if (e.shiftKey && e.code === "Digit0")
        flow.zoomTo(1, { duration: 200 });
      else if (e.key === "?") setShowHelp((v) => !v);
      else if (e.key === "v" || e.key === "V") onTool("select");
      else if (e.key === "h" || e.key === "H") onTool("hand");
      else if (e.key.toLowerCase() === "c") {
        onTool("comment");
        setShowComments(true);
      } else if (e.key === "Escape") {
        setShowHelp(false);
        setDraft(null);
        setActiveComment(null);
        selectFrames([]);
        setSelection({ frames: [], element: null });
      }
    };
    const onKeyUp = (e: KeyboardEvent) =>
      e.code === "Space" && setSpaceHeld(false);
    const onBlur = () => {
      setSpaceHeld(false);
      endPan();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    flow,
    page.frames,
    laidOut,
    onTool,
    selectFrames,
    zoomToFrames,
    endPan,
    setSelection,
  ]);

  // --- Messages from frame iframes ------------------------------------------
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const decoded = Schema.decodeUnknownResult(FrameMessage)(e.data);
      if (Result.isFailure(decoded)) return;
      const msg = decoded.success;
      const iframe = [
        ...document.querySelectorAll<HTMLIFrameElement>("iframe[data-frame]"),
      ].find(
        (iframe) =>
          iframe.dataset.frame === msg.frame &&
          iframe.contentWindow === e.source,
      );
      if (!iframe || e.origin !== location.origin) return;
      const frame: string = msg.frame;
      switch (msg.type) {
        case "layers":
          window.dispatchEvent(
            new CustomEvent("framio:layers", {
              detail: { frame, report: msg.report },
            }),
          );
          break;
        case "size":
        case "ready":
          if (typeof msg.height === "number")
            setHeights((h) =>
              h[frame] === msg.height ? h : { ...h, [frame]: msg.height },
            );
          break;
        case "select": {
          userMoved.current = true;
          if (
            tool === "comment" &&
            msg.x !== undefined &&
            msg.y !== undefined
          ) {
            makeDraft(frame, msg.x, msg.y, msg.element);
            break;
          }
          const viewport = laidOut.find((n) => n.id === frame)?.data.frame;
          selectFrames([frame]);
          setSelection({
            frames: [viewport?.frameId ?? frame],
            element: msg.element,
            layer: msg.layer,
            ...(viewport?.meta.widths ? { width: viewport.meta.width } : {}),
          });
          break;
        }
        case "dblclick":
          zoomToFrames([frame]);
          break;
        case "contextmenu":
          setMenu({ x: msg.clientX, y: msg.clientY, frame });
          break;
        case "pan-start":
          startPan(msg.screenX, msg.screenY);
          break;
        case "pan-move":
          movePan(msg.screenX, msg.screenY);
          break;
        case "pan-end":
          endPan();
          break;
        case "key":
          // Keys pressed while a frame has focus drive the canvas too.
          window.dispatchEvent(
            new KeyboardEvent(msg.phase, {
              key: msg.key,
              code: msg.code,
              repeat: msg.repeat,
              shiftKey: msg.shiftKey,
              metaKey: msg.metaKey,
              ctrlKey: msg.ctrlKey,
              altKey: msg.altKey,
            }),
          );
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    selectFrames,
    zoomToFrames,
    startPan,
    movePan,
    endPan,
    setHeights,
    setSelection,
    tool,
    makeDraft,
    laidOut,
  ]);

  // Restyle frames in place when theme.css changes, instead of reloading every iframe.
  const firstCss = useRef(cssVersion);
  useEffect(() => {
    if (cssVersion !== firstCss.current)
      postToFrames({ type: "css", version: cssVersion });
  }, [cssVersion]);

  return (
    <div
      className={`absolute inset-0 ${hand ? "tool-hand" : ""} ${panning ? "is-panning" : ""} ${frameDragging ? "is-dragging" : ""}`}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMove={(e) => panFrom.current && movePan(e.screenX, e.screenY)}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onMouseDownCapture={(e) => e.button === 1 && e.preventDefault()}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={({ nodes: sel }) => {
          const pending = pendingSelection.current;
          if (pending && pending.every((id) => layoutIndex.nodes.has(id))) {
            const actual = sel.map((node) => node.id).sort();
            if (
              actual.length !== pending.length ||
              actual.some((id, index) => id !== pending[index])
            )
              return;
          }
          pendingSelection.current = null;
          const ids = [
            ...new Set(sel.map((n) => n.data.frame.frameId ?? n.id)),
          ].sort();
          const width =
            sel.length === 1 && sel[0]!.data.frame.meta.widths
              ? sel[0]!.data.frame.meta.width
              : undefined;
          setSelection((prev) => {
            if (
              prev.width === width &&
              prev.frames.length === ids.length &&
              prev.frames.every((id, i) => id === ids[i])
            )
              return prev;
            const keep =
              prev.element &&
              ids.length === 1 &&
              ids[0] === prev.frames[0] &&
              prev.width === width;
            return {
              frames: ids,
              element: keep ? prev.element : null,
              ...(width ? { width } : {}),
              ...(ids.length === 1 &&
              ids[0] === prev.frames[0] &&
              prev.width === width &&
              prev.layer
                ? { layer: prev.layer }
                : {}),
            };
          });
        }}
        onNodeDoubleClick={(_, node) => zoomToFrames([node.id])}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, frame: node.id });
        }}
        onPaneContextMenu={(e) => e.preventDefault()}
        onNodeClick={(event, node) => {
          if (tool === "comment" && node.data.frame.kind === "image") {
            const rect = (event.target as HTMLElement)
              .closest(".react-flow__node")
              ?.getBoundingClientRect();
            if (rect)
              makeDraft(
                node.id,
                (event.clientX - rect.left) / flow.getZoom(),
                (event.clientY - rect.top) / flow.getZoom(),
                null,
              );
          }
        }}
        onNodeDrag={(_, node, dragged) => {
          const deltas = new Map<string, Pos>();
          for (const n of dragged) {
            const original = layoutIndex.nodes.get(n.id);
            if (original)
              deltas.set(n.data.frame.frameId ?? n.id, {
                x: n.position.x - original.position.x,
                y: n.position.y - original.position.y,
              });
          }
          const direct = new Set(dragged.map((n) => n.id));
          setNodes((current) =>
            current.map((n) => {
              const delta = deltas.get(n.data.frame.frameId ?? n.id);
              const original = layoutIndex.nodes.get(n.id);
              return delta && original && !direct.has(n.id)
                ? {
                    ...n,
                    dragging: true,
                    position: {
                      x: original.position.x + delta.x,
                      y: original.position.y + delta.y,
                    },
                  }
                : n;
            }),
          );
        }}
        onNodeDragStop={(_, node, dragged) => {
          const positions: Record<string, Pos> = {};
          for (const n of dragged) {
            const original = layoutIndex.nodes.get(n.id);
            const group = layoutIndex.groups.get(n.data.frame.frameId ?? n.id);
            if (original && group)
              positions[n.data.frame.slug] = {
                x: Math.round(
                  group.position.x + n.position.x - original.position.x,
                ),
                y: Math.round(
                  group.position.y + n.position.y - original.position.y,
                ),
              };
          }
          setNodes((current) =>
            current.map((n) => ({ ...n, dragging: false })),
          );
          setMoved((m) => ({ ...m, ...positions }));
          saveCanvas({ page: page.id, positions });
        }}
        onMoveStart={() => {
          if (!autoFitting.current) userMoved.current = true;
        }}
        onMoveEnd={(_, vp) => userMoved.current && saveViewport(vp)}
        defaultViewport={savedViewport ?? undefined}
        fitView={!savedViewport}
        fitViewOptions={FIT}
        minZoom={0.03}
        maxZoom={4}
        panOnDrag={false}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        selectionOnDrag={!hand && tool !== "comment"}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        multiSelectionKeyCode="Shift"
        nodesDraggable={!hand && tool !== "comment"}
        elementsSelectable={!hand && tool !== "comment"}
        nodesConnectable={false}
        autoPanOnNodeFocus={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <ZoomVar />
        <Toolbar
          tool={tool}
          onTool={onTool}
          showHelp={showHelp}
          showComments={showComments}
          onToggleComments={() => setShowComments((v) => !v)}
          onToggleHelp={() => setShowHelp((v) => !v)}
        />
      </ReactFlow>

      {showComments && (
        <CommentsPanel
          comments={pageComments}
          active={activeComment}
          draft={draft}
          error={commentsError}
          showResolved={showResolved}
          onResolved={setShowResolved}
          onSelect={openComment}
          onClose={() => setShowComments(false)}
          onSaved={() => {
            setDraft(null);
          }}
        />
      )}
      {menu && menuFrame && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={[
            {
              label: "Zoom to frame",
              hint: "Double-click",
              onSelect: () => zoomToFrames([menuFrame.id]),
            },
            {
              label: "Open in new tab",
              onSelect: () => window.open(standaloneUrl(menuFrame), "_blank"),
            },
            {
              label: "Copy file path",
              onSelect: () => navigator.clipboard.writeText(menuFrame.relFile),
            },
          ]}
        />
      )}
    </div>
  );
}

/** Exposes the zoom level to CSS so lines keep the same on-screen weight at any zoom. */
function ZoomVar() {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(
    () => document.documentElement.style.setProperty("--zoom", String(zoom)),
    [zoom],
  );
  return null;
}
