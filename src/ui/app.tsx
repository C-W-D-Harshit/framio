import { EmptyCanvas, DisconnectedNotice } from "./empty-canvas";
import type { CSSProperties } from "react";
import {
  ChevronRight,
  FileCode2,
  Frame,
  Image,
  Layers,
  Search,
  Smartphone,
  CornerDownLeft,
  AlertTriangle,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Kbd } from "./components/ui/kbd";
import { TooltipProvider } from "./components/ui/tooltip";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarTrigger,
} from "./components/ui/sidebar";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./components/ui/command";
import { MOD } from "./toolbar";
import { viewportId, viewports } from "../domain/viewports";
import { InspectPanel } from "./inspect-panel";
import { flattenLayers } from "../domain/layers";
import { LayersPanel } from "./layers-panel";
import { useCallback, useEffect, useState } from "react";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import {
  liveAtom,
  pageAtom,
  selectionAtom,
  toolAtom,
  layersAtom,
  activityAtom,
} from "./state";
import { imageUrl, standaloneUrl } from "./frame-node";
import { Canvas } from "./canvas";
import type { Tool } from "./toolbar";

function useHashPage() {
  const page = useAtomValue(pageAtom);
  return [
    AsyncResult.isSuccess(page) ? page.value : "",
    (id: string) => (location.hash = `/${encodeURIComponent(id)}`),
  ] as const;
}

function useTool() {
  const [tool, setTool] = useAtom(toolAtom);
  const set = useCallback(
    (t: Tool) => {
      localStorage.setItem("framio:tool", t);
      setTool(t);
    },
    [setTool],
  );
  return [tool, set] as const;
}

export function App() {
  const live = useAtomValue(liveAtom);
  const activity = useAtomValue(activityAtom);
  const { snapshot, connected, saveError } = AsyncResult.isSuccess(live)
    ? live.value
    : { snapshot: null, connected: false, saveError: null };
  const [pageId, setPageId] = useHashPage();
  const [tool, setTool] = useTool();
  const [selection, setSelection] = useAtom(selectionAtom);
  const [finder, setFinder] = useState(false);
  const [finderValue, setFinderValue] = useState("");
  const [rightPanel, setRightPanel] = useState<"comments" | "inspect" | null>(
    null,
  );
  const [focusFrame, setFocusFrame] = useState<{
    id: string;
    serial: number;
  } | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFinder((value) => !value);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const jump = (page: string, id: string) => {
    setPageId(page);
    setFocusFrame((current) => ({ id, serial: (current?.serial ?? 0) + 1 }));
    setFinder(false);
  };

  const pages = snapshot?.pages ?? [];
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const selectedIds = new Set(selection.frames);
  const selectedFrames =
    page?.frames.filter((f) => selectedIds.has(f.id)) ?? [];

  const selectedFrame =
    selectedFrames.length === 1 ? selectedFrames[0] : undefined;
  const layerFrame =
    selectedFrame && selection.width !== undefined && selectedFrame.meta.widths
      ? {
          ...selectedFrame,
          frameId: selectedFrame.id,
          id: viewportId(selectedFrame.id, selectedFrame.meta, selection.width),
          meta: {
            ...selectedFrame.meta,
            ...viewports(selectedFrame.meta, selection.width)[0]!,
          },
        }
      : selectedFrame;
  const layerReport = useAtomValue(layersAtom(layerFrame?.id ?? ""));
  const inspectNode = selection.layer
    ? flattenLayers(layerReport?.tree ?? []).find(
        (node) => node.path === selection.layer?.path,
      )
    : undefined;
  return (
    <TooltipProvider delay={300}>
      <SidebarProvider
        className="h-full min-h-0 overflow-hidden"
        style={{ "--sidebar-width": "248px" } as CSSProperties}
      >
        <Sidebar
          collapsible="offcanvas"
          className="border-r border-sidebar-border"
          aria-label="Project navigation"
        >
          <SidebarHeader className="h-14 flex-row items-center justify-between border-b px-4">
            <div className="flex min-w-0 items-center gap-2 font-medium">
              <span className="size-3.5 shrink-0 rounded-sm bg-primary" />
              <span className="truncate">
                {snapshot?.projectName ?? "Framio"}
              </span>
            </div>
            <Badge
              variant="secondary"
              className={
                connected
                  ? "bg-live/10 text-live"
                  : "bg-destructive/10 text-destructive"
              }
            >
              <span
                className={`size-1.5 rounded-full ${connected ? "bg-live" : "bg-destructive"}`}
              />
              {connected ? "Live" : "Offline"}
            </Badge>
          </SidebarHeader>
          <div className="px-3 py-3">
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start gap-2 text-xs font-normal text-muted-foreground"
              aria-label="Find a frame"
              onClick={() => setFinder(true)}
            >
              <Search className="size-3.5" />
              <span className="flex-1 text-left">Find a frame</span>
              <Kbd>{MOD}K</Kbd>
            </Button>
          </div>
          <SidebarContent className="gap-0">
            <SidebarGroup className="pt-0">
              <SidebarGroupLabel className="h-7 text-[11px] text-muted-foreground">
                Pages
              </SidebarGroupLabel>
              <SidebarMenu className="gap-px">
                {pages.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton
                      className="h-7 text-[13px] font-normal"
                      isActive={p.id === page?.id}
                      onClick={() => setPageId(p.id)}
                    >
                      <span>{p.name}</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge className="font-mono text-[11px] text-muted-foreground">
                      {p.frames.length}
                    </SidebarMenuBadge>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              {!pages.length && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  No pages yet
                </p>
              )}
            </SidebarGroup>
            <SidebarGroup className="mt-3 border-t">
              <SidebarGroupLabel className="justify-between text-[11px] text-muted-foreground">
                Frames & layers
                <Layers className="size-3.5" />
              </SidebarGroupLabel>
              <SidebarMenu className="gap-px">
                {page?.frames.map((f) => {
                  const Icon =
                    f.kind === "image"
                      ? Image
                      : f.meta.width < 600
                        ? Smartphone
                        : Frame;
                  const selected = selectedIds.has(f.id);
                  return (
                    <SidebarMenuItem key={f.id}>
                      <SidebarMenuButton
                        className={`h-8 text-xs font-normal ${selected ? "bg-primary/15 text-foreground data-active:bg-primary/15" : "text-muted-foreground"}`}
                        isActive={selected}
                        onClick={() => jump(page.id, f.id)}
                        title={f.relFile}
                      >
                        <ChevronRight
                          className={`size-3! ${selected ? "rotate-90 text-signal" : "text-faint"}`}
                        />
                        <Icon
                          className={`size-3.5! ${selected ? "text-signal" : "text-faint"}`}
                        />
                        <span>{f.meta.name}</span>
                        {f.error ? (
                          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive" />
                        ) : (
                          f.meta.widths && (
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                              {f.meta.widths.length} widths
                            </span>
                          )
                        )}
                      </SidebarMenuButton>
                      {selected && (
                        <LayersPanel
                          onInspect={() => {
                            setRightPanel("inspect");
                            setTool("select");
                          }}
                          frame={layerFrame}
                          project={snapshot?.projectName ?? "Framio"}
                        />
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="gap-2 border-t p-4">
            {[snapshot?.cssError, snapshot?.commentsError, saveError]
              .filter(Boolean)
              .map((error) => (
                <p
                  key={error}
                  role="alert"
                  className="rounded-md bg-destructive/10 p-2 text-xs break-words text-destructive"
                >
                  {error}
                </p>
              ))}
            <p className="text-[11px] text-muted-foreground">Activity</p>
            {activity.entries.length ? (
              activity.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2.5 text-xs"
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${entry.tone === "signal" ? "bg-signal" : entry.tone === "danger" ? "bg-destructive" : "bg-faint"}`}
                  />
                  <span className="flex-1 truncate text-muted-foreground">
                    {entry.verb}{" "}
                    <span className="text-foreground">{entry.name}</span>
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {entry.version}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                {connected
                  ? "Waiting for design changes"
                  : "Reconnecting to Studio…"}
              </p>
            )}
          </SidebarFooter>
        </Sidebar>
        <main className="studio-canvas relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-5">
            <div className="flex min-w-0 items-center gap-2">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <span className="hidden truncate text-muted-foreground lg:inline">
                {snapshot?.projectName ?? "Framio"}
              </span>
              <ChevronRight className="hidden size-3 text-faint lg:block" />
              <span className="truncate">{page?.name ?? "Studio"}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {page?.frames.length ?? 0} frames
              </span>
            </div>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <FileCode2 className="size-3.5" />
              {saveError
                ? "Changes could not be saved"
                : connected
                  ? "Changes saved"
                  : "Reconnecting…"}
            </div>
          </header>
          <div className="relative min-h-0 flex-1">
            {!snapshot ? (
              <EmptyCanvas connecting tool={tool} onTool={setTool} />
            ) : !page ? (
              <EmptyCanvas tool={tool} onTool={setTool} />
            ) : !page.frames.length ? (
              <EmptyCanvas page={page} tool={tool} onTool={setTool} />
            ) : (
              <Canvas
                key={page.id}
                page={page}
                projectName={snapshot.projectName}
                cssVersion={snapshot.cssVersion}
                tool={tool}
                onTool={(next) => {
                  setTool(next);
                  if (next === "comment") setRightPanel("comments");
                }}
                comments={snapshot.comments ?? []}
                commentsError={snapshot.commentsError ?? null}
                focusFrame={focusFrame}
                showComments={rightPanel === "comments"}
                onCommentsChange={(open) =>
                  setRightPanel(open ? "comments" : null)
                }
              />
            )}
            {snapshot && !connected && (
              <>
                <div className="pointer-events-none absolute inset-0 z-[5] bg-background/60" />
                <DisconnectedNotice />
              </>
            )}
          </div>
        </main>
        {rightPanel === "inspect" && inspectNode && layerFrame && (
          <InspectPanel
            key={`${layerFrame.id}/${inspectNode.path}`}
            node={inspectNode}
            selector={selection.element?.selector ?? inspectNode.path}
            frame={layerFrame}
            onClose={() => setRightPanel(null)}
          />
        )}
        <CommandDialog
          open={finder}
          onOpenChange={setFinder}
          className="top-[112px]! w-[560px]! max-w-[calc(100vw-32px)]! translate-y-0! rounded-lg! border"
          title="Find a frame"
          description="Search frames across all project pages."
        >
          <Command
            value={finderValue}
            onValueChange={setFinderValue}
            className="rounded-lg! p-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.stopPropagation();
                const frame = pages
                  .flatMap((page) => page.frames)
                  .find((frame) => frame.id === finderValue);
                if (frame) {
                  window.open(
                    standaloneUrl(frame),
                    "_blank",
                    "noopener,noreferrer",
                  );
                  setFinder(false);
                }
              }
            }}
          >
            <CommandInput
              className="h-12 text-sm"
              placeholder="Find a frame…"
            />
            <CommandList>
              <CommandEmpty>No matching frames.</CommandEmpty>
              {pages.map((p) => (
                <CommandGroup key={p.id} className="p-1.5">
                  {p.frames.map((f) => (
                    <CommandItem
                      key={f.id}
                      value={f.id}
                      keywords={[p.name, f.meta.name]}
                      className="h-12 gap-3 rounded-md px-2.5"
                      onSelect={() => jump(p.id, f.id)}
                    >
                      <span className="flex h-[30px] w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-card ring-1 ring-foreground/10">
                        {f.error ? (
                          <AlertTriangle className="size-3.5 text-destructive" />
                        ) : (
                          <img
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover object-top"
                            src={
                              f.kind === "image"
                                ? imageUrl(f)
                                : `/thumb/${encodeURIComponent(f.page)}/${encodeURIComponent(f.slug)}.png?v=${f.version}-${snapshot?.cssVersion}&width=${f.meta.width}`
                            }
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{f.meta.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.name}
                          {f.error && (
                            <span className="text-destructive">
                              {" "}
                              · Build failed
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {f.meta.width} × {f.meta.height}
                      </span>
                      <CornerDownLeft className="size-3.5 text-muted-foreground opacity-0 in-data-[selected=true]:opacity-100" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
            <div className="flex h-9 items-center gap-4 border-t px-4 text-[11px] text-muted-foreground">
              <span>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> Move
              </span>
              <span>
                <Kbd>↵</Kbd> Zoom to frame
              </span>
              <span>
                <Kbd>{MOD}</Kbd> <Kbd>↵</Kbd> Open in new tab
              </span>
              <span className="ml-auto">
                <Kbd>Esc</Kbd> Close
              </span>
            </div>
          </Command>
        </CommandDialog>
      </SidebarProvider>
    </TooltipProvider>
  );
}
