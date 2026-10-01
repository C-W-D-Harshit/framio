import { Card } from "./components/ui/card";
import { Separator } from "./components/ui/separator";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "./components/ui/tooltip";
import { Kbd } from "./components/ui/kbd";
import { Button } from "./components/ui/button";
import { useReactFlow, useStore } from "@xyflow/react";
import {
  PanelRight,
  MessageCircle,
  Hand,
  Keyboard,
  Minus,
  MousePointer2,
  Plus,
  Maximize2,
} from "lucide-react";
import type { ReactNode } from "react";

export type Tool = "select" | "hand" | "comment";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

type Props = {
  tool: Tool;
  onTool(tool: Tool): void;
  showHelp: boolean;
  onToggleHelp(): void;
  onToggleComments(): void;
  showComments: boolean;
  reviewTools?: boolean;
};

/** Floating bottom toolbar. Elements marked data-ui are excluded from canvas panning. */
export function Toolbar({
  tool,
  onTool,
  showHelp,
  onToggleHelp,
  onToggleComments,
  showComments,
  reviewTools = true,
}: Props) {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div data-ui className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2">
      {showHelp && <Shortcuts />}
      <div className="flex items-center gap-0.5 rounded-xl border border-chrome-line bg-chrome p-1 shadow-xl shadow-black/30">
        <ToolButton
          active={tool === "select"}
          onClick={() => onTool("select")}
          label="Select"
          shortcut="V"
        >
          <MousePointer2 className="size-4" />
        </ToolButton>
        <ToolButton
          active={tool === "hand"}
          onClick={() => onTool("hand")}
          label="Hand"
          shortcut="H"
        >
          <Hand className="size-4" />
        </ToolButton>
        {reviewTools && (
          <>
            <ToolButton
              active={tool === "comment"}
              onClick={() => onTool("comment")}
              label="Comment"
              shortcut="C"
            >
              <MessageCircle className="size-4" />
            </ToolButton>
            <ToolButton
              quiet
              active={showComments}
              onClick={onToggleComments}
              label="Comments panel"
            >
              <PanelRight className="size-4" />
            </ToolButton>
          </>
        )}
        <Divider />
        <ToolButton
          onClick={() => flow.zoomOut({ duration: 150 })}
          label="Zoom out"
          shortcut={`${MOD} −`}
        >
          <Minus className="size-4" />
        </ToolButton>
        <Button
          variant="ghost"
          aria-label="Zoom to fit"
          type="button"
          onClick={() => flow.fitView({ padding: 0.15, duration: 250 })}
          title="Zoom to fit (Shift 1)"
          className="h-8 w-12 min-w-0 rounded-lg border-0 px-0 font-mono text-[11px] font-normal text-foreground tabular-nums hover:bg-accent"
        >
          {Math.round(zoom * 100)}%
        </Button>
        <ToolButton
          onClick={() => flow.zoomIn({ duration: 150 })}
          label="Zoom in"
          shortcut={`${MOD} +`}
        >
          <Plus className="size-4" />
        </ToolButton>
        <ToolButton
          label="Fit all frames"
          onClick={() => flow.fitView({ padding: 0.15 })}
        >
          <Maximize2 className="size-4" />
        </ToolButton>
        <Divider />
        <ToolButton
          quiet
          active={showHelp}
          onClick={onToggleHelp}
          label="Keyboard shortcuts"
          shortcut="?"
        >
          <Keyboard className="size-4" />
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton(props: {
  active?: boolean;
  quiet?: boolean;
  onClick(): void;
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={props.onClick}
            aria-label={props.label}
            aria-pressed={props.active}
            className={`rounded-lg border-0 text-muted-foreground shadow-none ring-0 hover:bg-accent ${props.active ? (props.quiet ? "bg-accent text-signal" : "bg-primary text-primary-foreground hover:bg-primary") : "bg-transparent"}`}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent>
        {props.label}
        {props.shortcut && <Kbd>{props.shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

const Divider = () => (
  <Separator orientation="vertical" className="mx-1 h-5!" />
);

const k = (...keys: string[]) => (
  <span className="flex items-center gap-1">
    {keys.map((key) => (
      <Kbd key={key}>{key}</Kbd>
    ))}
  </span>
);
const hint = (text: string) => (
  <span className="text-muted-foreground">{text}</span>
);
const or = (a: ReactNode, b: ReactNode) => (
  <span className="flex items-center gap-1.5">
    {a}
    <span className="text-muted-foreground">or</span>
    {b}
  </span>
);
const SHORTCUTS: [string, [string, ReactNode][]][] = [
  [
    "Tools",
    [
      ["Select", k("V")],
      ["Hand", or(k("H"), hint("hold Space"))],
      ["Comment", k("C")],
    ],
  ],
  [
    "Find",
    [
      ["Find a frame", k(MOD, "K")],
      ["Shortcuts", k("?")],
    ],
  ],
  [
    "View",
    [
      ["Pan", hint("Scroll or middle-drag")],
      ["Zoom", or(k(MOD, "+"), k(MOD, "−"))],
      ["Zoom to fit", k("⇧", "1")],
      ["Zoom to selection", k("⇧", "2")],
      ["Zoom to 100%", k("⇧", "0")],
      ["Zoom to a frame", hint("Double-click it")],
    ],
  ],
  [
    "Select",
    [
      ["Element, for your agent", hint("Click in a frame")],
      ["Frame", hint("Click its name")],
      ["Several frames", or(k("⇧", "Click"), hint("drag"))],
      ["All frames", k(MOD, "A")],
      ["Clear selection", k("Esc")],
    ],
  ],
];

function Shortcuts() {
  return (
    <Card
      role="region"
      aria-label="Keyboard shortcuts"
      className="absolute bottom-full left-1/2 mb-4 w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 gap-0 rounded-lg border bg-popover p-5 shadow-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="font-medium">Keyboard shortcuts</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Close <Kbd>Esc</Kbd>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {SHORTCUTS.map(([title, rows]) => (
          <div key={title}>
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              {title}
            </div>
            {rows.map(([label, keys]) => (
              <div
                key={label}
                className="flex h-7 items-center justify-between gap-4 text-xs"
              >
                <span>{label}</span>
                <span className="text-xs">{keys}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
