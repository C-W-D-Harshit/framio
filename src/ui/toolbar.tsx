import { useReactFlow, useStore } from "@xyflow/react";
import {
  PanelRight,
  MessageCircle,
  Hand,
  Keyboard,
  Minus,
  MousePointer2,
  Plus,
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
};

/** Floating bottom toolbar. Elements marked data-ui are excluded from canvas panning. */
export function Toolbar({
  tool,
  onTool,
  showHelp,
  onToggleHelp,
  onToggleComments,
  showComments,
}: Props) {
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div data-ui className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
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
        <ToolButton
          active={tool === "comment"}
          onClick={() => onTool("comment")}
          label="Comment"
          shortcut="C"
        >
          <MessageCircle className="size-4" />
        </ToolButton>
        <ToolButton
          active={showComments}
          onClick={onToggleComments}
          label="Comments panel"
        >
          <PanelRight className="size-4" />
        </ToolButton>
        <Divider />
        <ToolButton
          onClick={() => flow.zoomOut({ duration: 150 })}
          label="Zoom out"
          shortcut={`${MOD} −`}
        >
          <Minus className="size-4" />
        </ToolButton>
        <button
          type="button"
          onClick={() => flow.fitView({ padding: 0.15, duration: 250 })}
          title="Zoom to fit (Shift 1)"
          className="h-8 min-w-14 rounded-lg px-2 text-xs text-neutral-300 tabular-nums hover:bg-white/[0.06]"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton
          onClick={() => flow.zoomIn({ duration: 150 })}
          label="Zoom in"
          shortcut={`${MOD} +`}
        >
          <Plus className="size-4" />
        </ToolButton>
        <Divider />
        <ToolButton
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
  onClick(): void;
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={
        props.shortcut ? `${props.label} (${props.shortcut})` : props.label
      }
      aria-label={props.label}
      aria-pressed={props.active}
      className={`flex size-8 items-center justify-center rounded-lg ${
        props.active
          ? "bg-accent text-white"
          : "text-neutral-300 hover:bg-white/[0.06]"
      }`}
    >
      {props.children}
    </button>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-chrome-line" />;

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Tools",
    [
      ["Select", "V"],
      ["Comment", "C"],
      ["Hand (pan by dragging)", "H"],
    ],
  ],
  [
    "Navigate",
    [
      ["Pan", "Scroll · Space drag · Middle drag"],
      ["Zoom", `Pinch · ${MOD} scroll · ${MOD} + / −`],
      ["Zoom to fit", "Shift 1"],
      ["Zoom to selection", "Shift 2"],
      ["Zoom to 100%", "Shift 0"],
      ["Zoom to a frame", "Double-click it"],
    ],
  ],
  [
    "Select",
    [
      ["Element (for your agent)", "Click inside a frame"],
      ["Frame", "Click its name"],
      ["Several frames", "Shift click · Drag on canvas"],
      ["All frames", `${MOD} A`],
      ["Clear selection", "Esc"],
    ],
  ],
  [
    "Frames",
    [
      ["Move", "Drag its name"],
      ["More actions", "Right-click"],
    ],
  ],
];

function Shortcuts() {
  return (
    <div className="absolute bottom-full left-1/2 mb-2 w-[360px] -translate-x-1/2 rounded-xl border border-chrome-line bg-chrome p-4 shadow-xl shadow-black/40">
      {SHORTCUTS.map(([group, rows]) => (
        <div key={group} className="mb-3 last:mb-0">
          <div className="mb-1.5 text-[11px] font-medium text-neutral-500">
            {group}
          </div>
          {rows.map(([label, keys]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 py-0.5 text-xs"
            >
              <span className="text-neutral-300">{label}</span>
              <span className="text-right text-neutral-500">{keys}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
