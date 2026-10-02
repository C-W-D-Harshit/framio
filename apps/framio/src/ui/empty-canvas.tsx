import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Copy, RotateCw } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "./components/ui/empty";
import { Toolbar, type Tool } from "./toolbar";

function CopyPrompt({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={`flex w-full items-center gap-3 rounded-lg border text-left ${compact ? "bg-sidebar py-1.5 pr-1.5 pl-3" : "bg-card py-2.5 pr-2.5 pl-4"}`}
    >
      <span className="flex-1 font-mono text-xs leading-5">{text}</span>
      <Button
        variant="secondary"
        size="xs"
        className="h-7 shrink-0 gap-1.5 bg-accent px-2.5 text-xs font-normal"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Copy className="size-3.5" />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
export function EmptyCanvas({
  page,
  tool,
  onTool,
  connecting,
}: {
  page?: { id: string; name: string };
  tool: Tool;
  onTool(tool: Tool): void;
  connecting?: boolean;
}) {
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as Element)?.closest("input,textarea,[contenteditable]")
      )
        return;
      if (event.key === "?") setHelp((value) => !value);
      else if (event.key === "Escape") setHelp(false);
      else if (event.key.toLowerCase() === "v") onTool("select");
      else if (event.key.toLowerCase() === "h") onTool("hand");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onTool]);
  const prompt = page
    ? `Design screens on the ${page.name} page.`
    : "Use Framio to design the onboarding for my invoicing app.";
  return (
    <ReactFlowProvider>
      <Empty className="h-full rounded-none border-0 p-8 pb-24">
        <div
          className={`flex max-w-full flex-col items-center text-center ${page ? "w-[520px]" : "w-[540px]"}`}
        >
          {!page && !connecting && (
            <div className="relative h-[112px] w-[300px]">
              <div className="absolute top-3 left-0 h-[88px] w-[136px] rounded-xs border border-dashed border-faint/70" />
              <div className="absolute top-3 left-[150px] h-[88px] w-[136px] rounded-xs border border-dashed border-faint/70" />
              <Card className="absolute top-0 left-[82px] h-[112px] w-[136px] gap-2 rounded-xs border-foreground/10 bg-card p-3 shadow-xl">
                <div className="h-2 w-10 rounded-full bg-primary/70" />
                <div className="mt-2 h-2 w-24 rounded-full bg-foreground/25" />
                <div className="h-2 w-16 rounded-full bg-foreground/15" />
                <div className="mt-auto h-4 w-14 rounded-sm bg-foreground/15" />
              </Card>
            </div>
          )}
          <EmptyHeader className={!page && !connecting ? "mt-10" : ""}>
            <EmptyTitle className="text-2xl font-semibold tracking-[-.02em]">
              {connecting
                ? "Connecting to Studio"
                : page
                  ? `${page.name} is empty`
                  : "Nothing on the canvas yet"}
            </EmptyTitle>
            <EmptyDescription className="mt-2 max-w-[380px] text-[13px] leading-[1.45]">
              {connecting
                ? "Waiting for your project's live canvas…"
                : page
                  ? "Ask your agent to add screens to this page:"
                  : "Framio shows what your agent designs, live. Ask it for something from your terminal:"}
            </EmptyDescription>
          </EmptyHeader>
          {!connecting && (
            <EmptyContent className="mt-6 w-full max-w-none gap-0">
              <CopyPrompt text={prompt} />
              {!page && (
                <p className="mt-6 text-xs text-muted-foreground">
                  Pages appear here as soon as your agent saves a frame to
                </p>
              )}
              <p
                className={`${page ? "mt-5" : "mt-1"} font-mono text-[11px] text-muted-foreground`}
              >
                {page
                  ? `.framio/pages/${page.id}/`
                  : ".framio/pages/<page>/<frame>.tsx"}
              </p>
            </EmptyContent>
          )}
        </div>
      </Empty>
      <Toolbar
        reviewTools={false}
        tool={tool}
        onTool={onTool}
        showHelp={help}
        onToggleHelp={() => setHelp((value) => !value)}
      />
    </ReactFlowProvider>
  );
}
export function DisconnectedNotice() {
  return (
    <Card
      role="alert"
      data-ui
      className="absolute top-5 left-1/2 z-30 w-[440px] max-w-[calc(100%-32px)] -translate-x-1/2 gap-0 rounded-lg border bg-popover p-4 shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <span className="size-1.5 rounded-full bg-destructive" />
          Framio stopped
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RotateCw className="size-3" />
          Reconnecting…
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-[1.45] text-muted-foreground">
        You're looking at the last frames it sent. Start it again in this
        project and the canvas reconnects on its own.
      </p>
      <div className="mt-3">
        <CopyPrompt compact text="framio start" />
      </div>
    </Card>
  );
}
