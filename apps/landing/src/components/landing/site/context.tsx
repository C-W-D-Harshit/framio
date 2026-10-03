/*
 * The three ways people start with Framio, shown as an agent session. Numbered tabs follow
 * Heron AI's feature tabs; the session log follows Linear's agent panel. Each tab plays back
 * what the agent reads and writes in the repo while the file tree marks the same files.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import {
  Check,
  FilePen,
  FileText,
  Images,
  MessageCircleQuestion,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClaudeMark, Container, Reveal, useFx } from "./primitives";
import { PanelDots } from "./texture";

type Kind = "read" | "ask" | "run" | "write";
type Line = { kind: Kind; text: string; path?: string };
type File = { path: string; depth: number; at?: number; kind?: "read" | "new" };

const icons: Record<Kind, LucideIcon> = {
  read: FileText,
  ask: MessageCircleQuestion,
  run: Terminal,
  write: FilePen,
};

const scenarios: {
  label: string;
  summary: string;
  prompt: string;
  lines: Line[];
  done: string;
  files: File[];
}[] = [
  {
    label: "New product",
    summary: "Product context and designs in your repo.",
    prompt: "Use Framio to design the onboarding for my invoicing app.",
    lines: [
      { kind: "read", text: "Read", path: "README.md" },
      { kind: "read", text: "Read", path: "package.json" },
      { kind: "ask", text: "Clarified the audience and product tone" },
      {
        kind: "write",
        text: "Recorded product facts in",
        path: ".framio/evidence.json",
      },
      { kind: "write", text: "Wrote", path: ".framio/BRIEF.md" },
      { kind: "write", text: "Made variations in", path: "02-directions/" },
    ],
    done: "Variations are available on the canvas.",
    files: [
      { path: "README.md", depth: 0, at: 0, kind: "read" },
      { path: "package.json", depth: 0, at: 1, kind: "read" },
      { path: "src/", depth: 0 },
      { path: ".framio/", depth: 0 },
      { path: "BRIEF.md", depth: 1, at: 4, kind: "new" },
      { path: "evidence.json", depth: 1, at: 3, kind: "new" },
      { path: "pages/02-directions/", depth: 1, at: 5, kind: "new" },
    ],
  },
  {
    label: "Redesign",
    summary: "Starts from your live page and current theme.",
    prompt: "Use Framio to redesign our pricing page.",
    lines: [
      { kind: "read", text: "Read", path: "app/pricing/page.tsx" },
      { kind: "read", text: "Read", path: "app/globals.css" },
      {
        kind: "run",
        text: "Captured",
        path: "localhost:3000/pricing → 01-moodboard",
      },
      { kind: "write", text: "Wrote DESIGN.md from your colors and fonts" },
      { kind: "write", text: "Made", path: "20-pricing/pricing.tsx" },
      { kind: "run", text: "Checked it at 1440 and 390 wide" },
    ],
    done: "Kept your type and colors. Rebuilt the plan table.",
    files: [
      { path: "app/", depth: 0 },
      { path: "globals.css", depth: 1, at: 1, kind: "read" },
      { path: "pricing/page.tsx", depth: 1, at: 0, kind: "read" },
      { path: ".framio/", depth: 0 },
      { path: "DESIGN.md", depth: 1, at: 3, kind: "new" },
      { path: "pages/01-moodboard/pricing.png", depth: 1, at: 2, kind: "new" },
      { path: "pages/20-pricing/pricing.tsx", depth: 1, at: 4, kind: "new" },
    ],
  },
  {
    label: "New page",
    summary: "Matches the screens you already have.",
    prompt: "Use Framio to design a settings page that matches the app.",
    lines: [
      { kind: "read", text: "Read", path: ".framio/DESIGN.md" },
      { kind: "read", text: "Read", path: "app/(app)/layout.tsx" },
      { kind: "read", text: "Read", path: "components/sidebar.tsx" },
      { kind: "read", text: "Read copy in", path: "app/billing/page.tsx" },
      { kind: "write", text: "Made", path: "30-settings/settings.tsx" },
      { kind: "run", text: "Checked spacing, contrast, and tap targets" },
    ],
    done: "Same sidebar, type, and spacing as the rest of the app.",
    files: [
      { path: "app/", depth: 0 },
      { path: "(app)/layout.tsx", depth: 1, at: 1, kind: "read" },
      { path: "billing/page.tsx", depth: 1, at: 3, kind: "read" },
      { path: "components/sidebar.tsx", depth: 0, at: 2, kind: "read" },
      { path: ".framio/", depth: 0 },
      { path: "DESIGN.md", depth: 1, at: 0, kind: "read" },
      { path: "pages/30-settings/settings.tsx", depth: 1, at: 4, kind: "new" },
    ],
  },
];

const STEP_MS = 700;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const HOLD_MS = 2600;

/**
 * Plays one scenario's lines in order, then moves to the next tab. Before the section scrolls
 * into view (and without motion), every line shows, so the static HTML carries the full session.
 */
function usePlayback(count: (tab: number) => number) {
  const fx = useFx();
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(0);
  const [step, setStep] = useState(() => count(0));
  const [playing, setPlaying] = useState(false);
  const [swapped, setSwapped] = useState(false);
  // Hovering or focusing the panel holds the current tab; picking a tab stops auto-advance.
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!fx || !el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStep(0);
          setPlaying(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fx]);

  useEffect(() => {
    if (!playing) return;
    const total = count(tab);
    // Lines always play; only the move to the next tab waits for the reader.
    if (step >= total && (manual || paused)) return;
    const timer = setTimeout(
      () => {
        if (step < total) setStep(step + 1);
        else {
          setSwapped(true);
          setTab((tab + 1) % scenarios.length);
          setStep(0);
        }
      },
      step < total ? STEP_MS : HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, paused, manual, step, tab, count]);

  function select(next: number) {
    setManual(true);
    if (next === tab) return;
    setSwapped(true);
    setTab(next);
    setStep(playing ? 0 : count(next));
  }

  return { ref, tab, step, playing, swapped, select, setPaused };
}

const lineCount = (tab: number) => scenarios[tab].lines.length;

export function Context() {
  const { ref, tab, step, playing, swapped, select, setPaused } =
    usePlayback(lineCount);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys move between tabs, following the ARIA tabs pattern.
  function onTabKey(event: KeyboardEvent) {
    const dir =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    event.preventDefault();
    const next = (tab + dir + scenarios.length) % scenarios.length;
    select(next);
    tabs.current[next]?.focus();
  }
  const s = scenarios[tab];
  const finished = step >= s.lines.length;
  const progress = playing ? Math.min(step / s.lines.length, 1) : 1;

  return (
    <section
      id="context"
      data-layer="Context"
      className="border-t border-landing-line py-24 md:py-40"
    >
      <Container>
        <Reveal className="grid gap-6 md:grid-cols-2 md:items-end md:gap-12">
          <h2 className="text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance md:type-landing-h2">
            It already knows your product.
          </h2>
          <p className="max-w-[460px] text-[16px] leading-[1.6] text-landing-muted md:text-[18px]">
            Framio runs inside your coding agent, in your repo. Before it draws
            anything, it reads the code, theme, and pages you already have.
          </p>
        </Reveal>

        <Reveal delay={80}>
          <div
            ref={ref}
            data-layer="Session Panel"
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setPaused(false);
            }}
            className="relative mt-12 overflow-hidden rounded-[20px] border border-landing-line bg-landing-raised md:mt-20"
          >
            <div
              role="tablist"
              aria-label="Ways to start"
              onKeyDown={onTabKey}
              className="grid grid-cols-3 border-b border-landing-line"
            >
              {scenarios.map((sc, i) => (
                <button
                  key={sc.label}
                  type="button"
                  role="tab"
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  tabIndex={i === tab ? 0 : -1}
                  aria-selected={i === tab}
                  onClick={() => select(i)}
                  className={cn(
                    "relative flex flex-col gap-1 border-landing-line px-4 py-4 text-left transition-[color,background-color] duration-200 ease-out md:px-6 md:py-5",
                    i > 0 && "border-l",
                    i === tab
                      ? "bg-landing-page/60 text-landing-ink"
                      : "text-landing-muted hover:text-landing-ink",
                  )}
                >
                  <span className="font-mono text-[11px] text-landing-muted">
                    0{i + 1}
                  </span>
                  <span className="text-[14px] font-medium md:text-[15px]">
                    {sc.label}
                  </span>
                  <span className="hidden text-[13px] text-landing-muted md:block">
                    {sc.summary}
                  </span>
                  {i === tab && (
                    <span className="absolute inset-x-0 bottom-0 h-px bg-landing-line">
                      <span
                        className="block h-full origin-left bg-corner-blue transition-transform ease-linear"
                        style={{
                          transform: `scaleX(${progress})`,
                          transitionDuration: `${STEP_MS}ms`,
                        }}
                      />
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div role="tabpanel" className="grid md:grid-cols-5">
              <div
                key={`session-${tab}`}
                data-layer="Agent Session"
                className={cn(
                  swapped && "panel-swap",
                  "flex min-h-[340px] flex-col gap-5 p-5 md:col-span-3 md:min-h-[440px] md:p-8",
                )}
              >
                <div className="flex items-center gap-2 text-[13px] text-landing-muted">
                  <ClaudeMark className="size-4 text-[#D97757]" />
                  <span className="text-landing-ink">Claude Code</span>
                  <span className="font-mono text-[12px]">~/ledgerly</span>
                </div>

                <p className="max-w-[520px] self-end rounded-[14px] rounded-br-[4px] bg-corner-blue px-4 py-3 text-[15px] leading-[1.5] text-on-corner-blue">
                  {s.prompt}
                </p>

                <ol className="flex flex-col gap-2.5 font-mono text-[12px] leading-[1.5] md:text-[13px]">
                  {s.lines.slice(0, step).map((line, i) => {
                    const Icon = icons[line.kind];
                    return (
                      <motion.li
                        key={`${tab}-${i}`}
                        initial={
                          playing
                            ? {
                                opacity: 0,
                                transform: "translateY(6px)",
                                filter: "blur(2px)",
                              }
                            : false
                        }
                        animate={{
                          opacity: 1,
                          transform: "translateY(0px)",
                          filter: "blur(0px)",
                        }}
                        transition={{ duration: 0.35, ease: EASE_OUT }}
                        className="flex items-start gap-3 text-landing-muted"
                      >
                        <Icon
                          className="mt-[3px] size-3.5 shrink-0"
                          strokeWidth={1.75}
                        />
                        <span>
                          {line.text}
                          {line.path && (
                            <>
                              {" "}
                              <span className="text-landing-ink">
                                {line.path}
                              </span>
                            </>
                          )}
                        </span>
                      </motion.li>
                    );
                  })}
                  {!finished && playing && (
                    <li className="flex items-center gap-3 text-landing-muted">
                      <span className="size-3.5 shrink-0 animate-pulse rounded-full bg-signal/40" />
                      Working…
                    </li>
                  )}
                </ol>

                {finished && (
                  <motion.p
                    key={`${tab}-done`}
                    initial={
                      playing
                        ? {
                            opacity: 0,
                            transform: "translateY(6px)",
                            filter: "blur(2px)",
                          }
                        : false
                    }
                    animate={{
                      opacity: 1,
                      transform: "translateY(0px)",
                      filter: "blur(0px)",
                    }}
                    transition={{ duration: 0.35, ease: EASE_OUT }}
                    className="mt-auto flex items-center gap-2 border-t border-landing-line pt-5 text-[14px] text-landing-ink"
                  >
                    <Check className="size-4 text-signal" strokeWidth={2} />
                    {s.done}
                  </motion.p>
                )}
              </div>

              <div
                data-layer="Repo Tree"
                className="relative border-t border-landing-line p-5 md:col-span-2 md:border-t-0 md:border-l md:p-8"
              >
                <PanelDots className="[mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
                <div
                  key={`tree-${tab}`}
                  className={cn("relative", swapped && "panel-swap")}
                >
                  <div className="mb-4 flex items-center justify-between text-[12px] text-landing-muted">
                    <span>Your repo</span>
                    <span className="flex items-center gap-3 font-mono text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-signal" />
                        read
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-[#8FD5A6]" />
                        new
                      </span>
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 font-mono text-[12px] md:text-[12.5px]">
                    {s.files.map((f) => {
                      const lit = f.at !== undefined && step > f.at;
                      return (
                        <li
                          key={`${tab}-${f.path}`}
                          style={{ paddingLeft: 12 + f.depth * 16 }}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-[6px] py-1.5 pr-2 transition-colors duration-300",
                            lit && f.kind === "read" && "bg-signal/10",
                            lit && f.kind === "new" && "bg-[#8FD5A6]/10",
                          )}
                        >
                          <span
                            className={cn(
                              "truncate transition-colors duration-300",
                              lit
                                ? "text-landing-ink"
                                : "text-landing-muted/70",
                            )}
                          >
                            {f.path}
                          </span>
                          {f.kind && (
                            <span
                              aria-hidden
                              className={cn(
                                "size-1.5 shrink-0 rounded-full transition-opacity duration-300",
                                f.kind === "read"
                                  ? "bg-signal"
                                  : "bg-[#8FD5A6]",
                                lit ? "opacity-100" : "opacity-0",
                              )}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-6 flex items-center gap-2 text-[12px] text-landing-muted">
                    <Images className="size-3.5" strokeWidth={1.75} />
                    Designs land in .framio/, next to your code.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
