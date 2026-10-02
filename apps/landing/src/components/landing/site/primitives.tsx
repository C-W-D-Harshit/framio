/*
 * Shared pieces for the Framio landing page. Section layouts are adapted from Tailark blocks
 * (https://github.com/tailark/blocks, MIT License, Copyright (c) Tailark); see each section file.
 * Colors and type come from the landing-* tokens in DESIGN.md.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Magnet from "@/components/Magnet";
import LogoLoop from "@/components/LogoLoop";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Grain } from "./texture";
import { ClaudeMark, GitHubMark, INSTALL } from "@/components/landing/kit";
import { Openai } from "@/components/ui/svgs/openai";
import { AntigravityMark, CursorMark, GrokMark, OpenCodeMark } from "./agents";

export { ClaudeMark, GitHubMark, INSTALL };
export const REPO = "https://github.com/C-W-D-Harshit/framio";
export const links: Record<string, string> = {
  "How it works": "#how-it-works",
  Docs: "/docs/",
  Changelog: `${REPO}/releases`,
  Releases: `${REPO}/releases`,
  "Quick start": "/docs/#quick-start",
  "DESIGN.md": "/docs/#designmd",
  Commands: "/docs/#commands",
  Comments: "/docs/#comments-and-selections",
  GitHub: REPO,
  Issues: `${REPO}/issues`,
  Contributing: `${REPO}/blob/main/CONTRIBUTING.md`,
  Security: `${REPO}/blob/main/SECURITY.md`,
};

/** On in the React Bits variation of the page; shared sections read it to add effects. */
export const Fx = createContext(false);
export const useFx = () => useContext(Fx);

/**
 * The bracket cursor is limited to zones where pointing is the subject (the hero stage and the
 * how-it-works visuals). Everywhere else the system cursor stays.
 */
export const CursorZones = createContext<{
  enter: () => void;
  leave: () => void;
} | null>(null);

export function CursorZone({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const fx = useFx();
  const zones = useContext(CursorZones);
  if (!fx || !zones) return <div className={className}>{children}</div>;
  return (
    <div
      className={cn("cursor-none", className)}
      onPointerEnter={zones.enter}
      onPointerLeave={zones.leave}
    >
      {children}
    </div>
  );
}

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1200px] px-5 md:px-6", className)}
    >
      {children}
    </div>
  );
}

/** Section titles are two sentences; the second one is muted. */
export function SectionTitle({
  title,
  muted,
  className,
  center,
}: {
  title: string;
  muted: string;
  className?: string;
  center?: boolean;
}) {
  return (
    <h2
      className={cn(
        "max-w-[820px] text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance md:type-landing-h2",
        center && "mx-auto text-center",
        className,
      )}
    >
      {title} <span className="text-landing-muted">{muted}</span>
    </h2>
  );
}

/**
 * The primary action: a short button, with the full command underneath so a reader can see
 * what runs before they paste it.
 */
function MaybeMagnet({ children }: { children: ReactNode }) {
  const fx = useFx();
  if (!fx) return <>{children}</>;
  return (
    <Magnet
      padding={60}
      magnetStrength={4}
      wrapperClassName="w-full md:w-auto"
      innerClassName="w-full"
    >
      {children}
    </Magnet>
  );
}

export function InstallCTA({
  className,
  center,
  onBlue,
}: {
  className?: string;
  center?: boolean;
  onBlue?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 3000);
  }
  return (
    <div
      data-layer="Install"
      className={cn(
        "flex w-full flex-col gap-4",
        center && "md:items-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-2 md:flex-row md:items-center md:gap-3",
          center && "md:justify-center",
        )}
      >
        <MaybeMagnet>
          <button
            type="button"
            onClick={copyCommand}
            className={cn(
              "flex h-12 w-full md:w-auto min-w-[221px] items-center justify-center gap-2 rounded-[10px] px-5 text-[15px] font-medium md:h-11",
              onBlue
                ? "bg-on-corner-blue text-corner-blue"
                : "bg-landing-ink text-landing-page",
            )}
          >
            {status === "copied" ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" strokeWidth={2} />
            )}
            <span aria-live="polite">
              {status === "copied"
                ? "Copied!"
                : status === "error"
                  ? "Select command below"
                  : "Copy install command"}
            </span>
          </button>
        </MaybeMagnet>
        <a
          href={REPO}
          className={cn(
            "flex h-12 items-center justify-center gap-2 px-3 text-[15px] md:h-11",
            onBlue ? "text-on-corner-blue" : "text-landing-ink",
          )}
        >
          <GitHubMark />
          View on GitHub
        </a>
      </div>
      <code
        className={cn(
          "select-all break-words font-mono text-[11px] leading-[1.6] md:text-[12px] md:break-normal md:whitespace-nowrap",
          center && "md:text-center",
          onBlue ? "text-on-corner-blue" : "text-landing-muted",
        )}
      >
        {INSTALL.split("/").map((part, i, all) => (
          <span key={i}>
            {part}
            {i < all.length - 1 && (
              <>
                /<wbr />
              </>
            )}
          </span>
        ))}
      </code>
    </div>
  );
}

const agents = [
  { name: "Claude Code", Icon: ClaudeMark },
  { name: "Codex", Icon: Openai },
  { name: "OpenCode", Icon: OpenCodeMark },
  { name: "Cursor", Icon: CursorMark },
  { name: "Grok CLI", Icon: GrokMark },
  { name: "Antigravity", Icon: AntigravityMark },
];

function AgentItem({ name, Icon }: (typeof agents)[number]) {
  return (
    <span className="flex items-center gap-2 text-[13px] whitespace-nowrap text-landing-ink">
      <Icon className="size-4 shrink-0" />
      {name}
    </span>
  );
}

export function AgentsLine({ className }: { className?: string }) {
  const fx = useFx();
  if (fx) {
    return (
      <div
        data-layer="Proof"
        className={cn("mx-auto w-full max-w-[760px]", className)}
      >
        <LogoLoop
          logos={agents.map((a) => ({
            node: <AgentItem {...a} />,
            title: a.name,
          }))}
          speed={40}
          gap={44}
          logoHeight={20}
          pauseOnHover
          fadeOut
          fadeOutColor="#0A0A0B"
          ariaLabel="Agents that work with Framio"
        />
      </div>
    );
  }
  return (
    <div
      data-layer="Proof"
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:items-center sm:gap-x-7",
        className,
      )}
    >
      {agents.map((a) => (
        <AgentItem key={a.name} {...a} />
      ))}
    </div>
  );
}

/**
 * The blue stage from the hero: a corner-blue panel holding a product capture.
 */
export function Stage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <CursorZone>
      <div data-layer="Stage" className={cn("relative", className)}>
        <div className="relative overflow-hidden rounded-[18px] bg-corner-blue p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] md:rounded-[28px] md:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 80% at 50% 0%, rgb(255 255 255 / 0.18), transparent 60%)",
            }}
          />
          <Grain alpha={40} blend="overlay" />
          <div className="relative">{children}</div>
        </div>
      </div>
    </CursorZone>
  );
}

export function Capture({
  src,
  mobileSrc,
  alt,
  className,
}: {
  src: string;
  mobileSrc?: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "cursor-target overflow-hidden rounded-[10px] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.6),0_0_0_1px_rgb(0_0_0/0.25)] md:rounded-[14px]",
        className,
      )}
    >
      <picture>
        {mobileSrc && (
          <source
            media="(max-width: 767px)"
            srcSet={mobileSrc}
            width={1380}
            height={960}
          />
        )}
        <img
          src={src}
          alt={alt}
          width={2560}
          height={1600}
          fetchPriority="high"
          decoding="async"
          className="block h-auto w-full"
        />
      </picture>
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[12px] text-landing-muted">{children}</span>
  );
}
