import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "../server/server";
import { Canvas, type CanvasSelection } from "./canvas";
import type { Tool } from "./toolbar";

function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let ws: WebSocket;
    let retry: Timer;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(`ws://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "snapshot") setSnapshot(msg.snapshot);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.close();
    };
  }, []);
  return { snapshot, connected };
}

function useHashPage() {
  const read = () => decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [page, setPage] = useState(read);
  useEffect(() => {
    const onHash = () => setPage(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [page, (id: string) => (location.hash = `/${encodeURIComponent(id)}`)] as const;
}

function useTool() {
  const [tool, setTool] = useState<Tool>(() => (localStorage.getItem("framio:tool") === "hand" ? "hand" : "select"));
  const set = useCallback((t: Tool) => {
    localStorage.setItem("framio:tool", t);
    setTool(t);
  }, []);
  return [tool, set] as const;
}

export function App() {
  const { snapshot, connected } = useSnapshot();
  const [pageId, setPageId] = useHashPage();
  const [tool, setTool] = useTool();
  const [selection, setSelection] = useState<CanvasSelection>({ frames: [], element: null });

  const pages = snapshot?.pages ?? [];
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const selectedFrames = page?.frames.filter((f) => selection.frames.includes(f.id)) ?? [];

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-chrome-line bg-chrome">
        <div className="flex h-11 items-center gap-2 border-b border-chrome-line px-4">
          <span className="size-3 rounded-[3px] bg-accent" />
          <span className="truncate font-medium text-neutral-100">{snapshot?.projectName ?? "Framio"}</span>
        </div>
        <div className="px-4 pt-4 pb-2 text-[11px] font-medium text-neutral-500">Pages</div>
        <nav className="flex-1 overflow-y-auto px-2">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPageId(p.id)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left ${
                p.id === page?.id ? "bg-white/[0.07] text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <span className="truncate">{p.name}</span>
              <span className="text-[11px] text-neutral-600 tabular-nums">{p.frames.length}</span>
            </button>
          ))}
        </nav>
        {snapshot?.cssError && (
          <div className="m-2 rounded-md bg-red-500/10 p-2 text-[11px] break-words text-red-300">{snapshot.cssError}</div>
        )}
        <div className="flex items-center gap-2 border-t border-chrome-line px-4 py-2.5 text-[11px] text-neutral-500">
          <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
          {connected ? "Live" : "Disconnected — run `framio start`"}
        </div>
      </aside>

      <main className="relative flex-1 overflow-hidden">
        {!snapshot ? null : !page ? (
          <EmptyState title="No pages yet" hint="Ask your agent to design something. Frames live in .framio/pages/<page>/<frame>.tsx" />
        ) : page.frames.length === 0 ? (
          <EmptyState title={`${page.name} is empty`} hint={`Add a frame at .framio/pages/${page.id}/<frame>.tsx`} />
        ) : (
          <Canvas
            key={page.id}
            page={page}
            projectName={snapshot.projectName}
            cssVersion={snapshot.cssVersion}
            tool={tool}
            onTool={setTool}
            onSelection={setSelection}
          />
        )}

        {selectedFrames.length > 0 && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-10 flex max-w-[70%] -translate-x-1/2 items-center gap-2 rounded-lg border border-chrome-line bg-chrome px-3 py-1.5 text-xs text-neutral-300 shadow-lg">
            <span className="size-1.5 shrink-0 rounded-full bg-accent" />
            <span className="truncate">
              {selectedFrames.length > 1 ? (
                `${selectedFrames.length} frames`
              ) : selection.element ? (
                <>
                  <span className="font-mono text-accent">{selection.element.tag}</span>
                  {selection.element.text && <> “{selection.element.text.slice(0, 40)}”</>} in {selectedFrames[0]!.meta.name}
                </>
              ) : (
                selectedFrames[0]!.meta.name
              )}
            </span>
            <span className="shrink-0 text-neutral-500">· your agent can see this</span>
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <div className="text-neutral-300">{title}</div>
      <div className="max-w-sm text-xs text-neutral-500">{hint}</div>
    </div>
  );
}
