/* Adapted from Tailark Dusk features-5 (MIT, Copyright (c) Tailark).  */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CheckCheck,
  Columns2,
  Database,
  FileSearch,
  FolderPlus,
  Images,
  MessageSquare,
  MousePointer2,
  Palette,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SpotlightCard from "@/components/SpotlightCard";
import {
  Container,
  CursorZone,
  SectionTitle,
  useFx,
  useReveal,
} from "./primitives";
import { PanelDots } from "./texture";

const steps = [
  "Install Framio",
  "Ask in one sentence",
  "Point at what's wrong",
  "Ship it",
];

function Highlights({
  items,
}: {
  items: { icon: LucideIcon; label: string }[];
}) {
  return (
    <ul className="mt-8 divide-y divide-landing-line border-y border-landing-line text-[15px] text-landing-muted">
      {items.map(({ icon: Icon, label }) => (
        <li key={label} className="flex items-center gap-3 py-3">
          <Icon className="size-4 shrink-0" strokeWidth={1.75} />
          {label}
        </li>
      ))}
    </ul>
  );
}

const panelClass =
  "relative flex min-h-[320px] overflow-hidden rounded-[20px] border border-landing-line bg-landing-raised md:col-span-3 md:aspect-[5/4] md:min-h-0";

function Panel({ children }: { children: ReactNode }) {
  const fx = useFx();
  if (fx) {
    return (
      <CursorZone className="flex md:col-span-3">
        <SpotlightCard
          className={`!rounded-[20px] !border-landing-line !bg-landing-raised !p-0 w-full ${panelClass}`}
          spotlightColor="rgba(12, 100, 255, 0.22)"
        >
          {children}
        </SpotlightCard>
      </CursorZone>
    );
  }
  return <div className={panelClass}>{children}</div>;
}

function Step({
  n,
  label,
  lead,
  body,
  items,
  visual,
}: {
  n: number;
  label: string;
  lead: string;
  body: ReactNode;
  items: { icon: LucideIcon; label: string }[];
  visual?: ReactNode;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      id={`step-${n}`}
      data-layer="Step"
      className="grid gap-8 md:grid-cols-5 md:gap-12"
    >
      <div
        className={cn(
          "flex flex-col justify-between md:col-span-2",
          visual && "md:pb-2",
        )}
      >
        <div>
          <h3 className="mb-5 flex items-center gap-3 text-[14px] font-medium text-landing-muted">
            <span className="grid size-6 place-items-center rounded-full border border-landing-line font-mono text-[12px] text-landing-ink">
              {n}
            </span>{" "}
            {label}
          </h3>
          <p className="text-[18px] leading-[1.5] font-medium text-balance text-landing-muted">
            <span className="text-landing-ink">{lead}</span> {body}
          </p>
        </div>
        {visual && <Highlights items={items} />}
      </div>
      {visual ? (
        <Panel>
          <PanelDots />
          {visual}
        </Panel>
      ) : (
        <div className="md:col-span-3 md:self-end">
          <Highlights items={items} />
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- visuals */

function Prompt({ children }: { children: ReactNode }) {
  return (
    <div className="text-landing-ink">
      <span className="text-landing-muted">$ </span>
      {children}
    </div>
  );
}

export function TerminalVisual({ startOnly = false }: { startOnly?: boolean }) {
  return (
    <div className="cursor-target relative m-auto w-[calc(100%-32px)] max-w-[520px] overflow-hidden rounded-[12px] border border-landing-line bg-landing-page shadow-[0_24px_48px_-16px_rgb(0_0_0/0.8)]">
      <div className="flex h-9 items-center gap-1.5 border-b border-landing-line px-4">
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="ml-3 font-mono text-[11px] text-landing-muted">
          {startOnly ? "~/ledgerly · SSH" : "~/ledgerly"}
        </span>
      </div>
      <div className="flex flex-col gap-1 p-4 font-mono text-[11.5px] leading-[1.7] md:p-5 md:text-[12.5px]">
        {!startOnly && (
          <>
            <Prompt>framio init</Prompt>
            <div className="text-landing-muted">
              Canvas files and agent skills ready.
            </div>
            <div className="text-landing-muted">
              Packages and screenshot browser installed.
            </div>
            <div className="h-3" />
          </>
        )}
        <Prompt>framio start</Prompt>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 text-landing-muted">
          <span>Local</span>
          <span className="break-all text-signal">http://localhost:4747</span>
          <span>Network</span>
          <span className="break-all text-signal">
            http://192.168.1.42:4747
          </span>
          <span>Tailscale</span>
          <span className="break-all text-signal">http://100.64.0.2:4747</span>
        </div>
        <div className="mt-2 text-landing-muted">Ctrl+C to stop</div>
      </div>
    </div>
  );
}

const SIGNAL = "#6E9BFF";

function Code({ children, hit }: { children: ReactNode; hit?: boolean }) {
  return (
    <div
      className="px-4 whitespace-pre"
      style={
        hit
          ? {
              background: "rgb(110 155 255 / 0.12)",
              boxShadow: `inset 2px 0 0 ${SIGNAL}`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

function FileAndFrameVisual() {
  const attr = "text-[#B4A7FF]";
  const str = "text-[#8FD5A6]";
  return (
    <div className="relative m-auto h-[300px] w-[calc(100%-40px)] max-w-[560px] md:h-[380px]">
      <div className="cursor-target absolute top-0 left-0 w-[92%] overflow-hidden rounded-[12px] border border-landing-line bg-landing-page shadow-[0_24px_48px_-16px_rgb(0_0_0/0.8)]">
        <div className="flex h-9 items-center border-b border-landing-line px-4 font-mono text-[11px] text-landing-muted">
          pages/10-onboarding/
          <span className="text-landing-ink">first-invoice.tsx</span>
        </div>
        <div className="py-2 font-mono text-[10.5px] leading-[1.9] text-landing-muted md:text-[11.5px]">
          <Code>{"</Field>"}</Code>
          <Code hit>
            {"<div "}
            <span className={attr}>data-layer</span>=
            <span className={str}>"Line Items"</span>
            {">"}
          </Code>
          <Code>
            {"  <div "}
            <span className={attr}>className</span>=
            <span className={str}>"grid grid-cols-[…]"</span>
            {">"}
          </Code>
        </div>
      </div>
      <figure className="cursor-target absolute right-0 bottom-0 w-[54%]">
        <figcaption className="flex items-baseline gap-2 pb-1.5 text-[11px]">
          <span style={{ color: SIGNAL }}>First invoice</span>
          <span className="font-mono text-[10px] text-landing-muted">
            1440 × 900
          </span>
        </figcaption>
        <div
          className="relative shadow-[0_24px_48px_-16px_rgb(0_0_0/0.8)]"
          style={{ outline: `1.5px solid ${SIGNAL}` }}
        >
          <img
            src="/assets/landing/crop-line-items.webp"
            width={620}
            height={520}
            loading="lazy"
            decoding="async"
            alt="The rendered First invoice frame"
            className="block h-auto w-full"
          />
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${(28 / 620) * 100}%`,
              top: `${(186 / 520) * 100}%`,
              width: `${(572 / 620) * 100}%`,
              height: `${(224 / 520) * 100}%`,
              outline: `1.5px solid ${SIGNAL}`,
              background: "rgb(110 155 255 / 0.06)",
            }}
          />
        </div>
      </figure>
    </div>
  );
}

function AgentReplyVisual() {
  return (
    <div className="relative m-auto h-[460px] w-[calc(100%-32px)] max-w-[560px] md:h-[380px]">
      <figure className="cursor-target absolute bottom-5 left-0 w-[78%] md:top-[52%] md:bottom-auto md:w-[58%]">
        <figcaption className="flex items-baseline gap-2 pb-1.5 text-[11px]">
          <span className="truncate text-landing-ink">
            Business details, VAT error
          </span>
          <span className="hidden font-mono text-[10px] text-landing-muted md:inline">
            1440 × 900
          </span>
        </figcaption>
        <div className="overflow-hidden rounded-[4px] shadow-[0_24px_48px_-16px_rgb(0_0_0/0.8)]">
          <img
            src="/assets/landing/step3-field.webp"
            width={614}
            height={150}
            loading="lazy"
            decoding="async"
            alt="The VAT field with comment pin 3"
            className="block h-auto w-full"
          />
        </div>
      </figure>
      <div className="cursor-target absolute top-5 right-0 w-[82%] overflow-hidden rounded-[12px] md:top-[4%] md:w-[52%] shadow-[0_24px_48px_-12px_rgb(0_0_0/0.9)]">
        <img
          src="/assets/landing/step3-thread.webp"
          width={545}
          height={705}
          loading="lazy"
          decoding="async"
          alt="Comment thread 3 with the agent's reply"
          className="block h-auto w-full"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ section */

/** The step nearest the middle of the viewport is the one you're reading. */
function useActiveStep(count: number) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting)
            setActive(Number(entry.target.id.replace("step-", "")) - 1);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (let i = 1; i <= count; i++) {
      const el = document.getElementById(`step-${i}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [count]);
  return active;
}

function StepNav() {
  const active = useActiveStep(steps.length);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const [bar, setBar] = useState({ top: 0, height: 0 });
  useEffect(() => {
    const el = links.current[active];
    if (el) setBar({ top: el.offsetTop, height: el.offsetHeight });
  }, [active]);
  return (
    <div className="sticky top-24 hidden h-fit w-48 lg:block">
      <div className="text-[13px] text-landing-muted">Steps</div>
      <div className="relative mt-4 flex flex-col border-l border-landing-line">
        <span
          aria-hidden
          className="absolute -left-px w-px bg-landing-ink transition-[transform,height] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{
            height: bar.height,
            transform: `translateY(${bar.top}px)`,
          }}
        />
        {steps.map((s, i) => (
          <a
            href={`#step-${i + 1}`}
            key={s}
            ref={(el) => {
              links.current[i] = el;
            }}
            aria-current={i === active ? "step" : undefined}
            className={cn(
              "py-2 pl-4 text-[14px] transition-colors duration-200 ease-out",
              i === active
                ? "text-landing-ink"
                : "text-landing-muted hover:text-landing-ink",
            )}
          >
            {s}
          </a>
        ))}
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      data-layer="How It Works"
      className="border-t border-landing-line py-24 md:py-40"
    >
      <Container>
        <SectionTitle
          title="Ask. Point. Ship."
          muted="How to design UI with Claude Code or Codex."
        />
        <div className="mt-14 grid gap-6 md:mt-24 lg:grid-cols-[auto_1fr] lg:gap-16">
          <StepNav />
          <div className="flex flex-col gap-20 md:gap-32">
            <Step
              n={1}
              label="Install Framio"
              lead="One command, then framio init."
              body="It adds a .framio folder to your project and installs the skill your agent reads."
              items={[
                { icon: Terminal, label: "A single binary, no account" },
                {
                  icon: FolderPlus,
                  label: "Adds .framio/ with React, Tailwind, and shadcn/ui",
                },
                {
                  icon: BookOpen,
                  label: "Installs the skill for Claude Code and Codex",
                },
              ]}
              visual={<TerminalVisual />}
            />
            <Step
              n={2}
              label="Ask in one sentence"
              lead={
                '"Use Framio to design the onboarding for my invoicing app."'
              }
              body="Your agent reads your repo first, asks only what it can't find there, and writes each screen as a .tsx file."
              items={[
                { icon: FileSearch, label: "Reads your repo before it asks" },
                { icon: Images, label: "Collects references on a moodboard" },
                {
                  icon: Palette,
                  label: "Shows two or three directions to pick from",
                },
              ]}
              visual={<FileAndFrameVisual />}
            />
            <Step
              n={3}
              label="Point at what's wrong"
              lead="Click it, or pin a comment."
              body="Your agent gets the exact layer you picked and what you wrote. It replies in the thread and edits the file."
              items={[
                {
                  icon: MousePointer2,
                  label: "A click selects the nearest named layer",
                },
                {
                  icon: MessageSquare,
                  label: "Comments live in .framio/comments.json",
                },
                {
                  icon: CheckCheck,
                  label: "The agent replies, fixes, and resolves",
                },
              ]}
              visual={<AgentReplyVisual />}
            />
            <Step
              n={4}
              label="Ship it"
              lead={'"Build it in the app."'}
              body="Your agent moves the design's theme and components into your codebase, swaps mock data for real data, and compares your app with the design at every width until they match."
              items={[
                {
                  icon: Palette,
                  label: "Moves DESIGN.md tokens into your theme",
                },
                { icon: Database, label: "Replaces mock data with real data" },
                {
                  icon: Columns2,
                  label: "Screenshots app and design side by side",
                },
              ]}
            />
          </div>
        </div>
      </Container>
    </section>
  );
}
