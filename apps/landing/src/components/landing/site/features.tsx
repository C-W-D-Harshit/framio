/* Adapted from Tailark Dusk features-1 (MIT, Copyright (c) Tailark). */
import type { ReactNode } from "react";
import {
  Blocks,
  GitBranch,
  Palette,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import SpotlightCard from "@/components/SpotlightCard";
import { Container, Reveal, SectionTitle, useFx } from "./primitives";
import { PanelDots } from "./texture";

function Card({
  lead,
  body,
  children,
  className,
}: {
  lead: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  const fx = useFx();
  const inner = (
    <>
      <PanelDots className="[mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <p className="relative max-w-[500px] p-6 text-[17px] leading-[1.5] font-medium text-landing-muted md:p-8 md:text-[18px]">
        <span className="text-landing-ink">{lead}</span> {body}
      </p>
      {children}
    </>
  );
  if (fx) {
    return (
      <SpotlightCard
        className={`!rounded-[20px] !border-landing-line !bg-landing-raised !p-0 ${className ?? ""}`}
        spotlightColor="rgba(12, 100, 255, 0.22)"
      >
        <div data-layer="Feature Card" className="contents">
          {inner}
        </div>
      </SpotlightCard>
    );
  }
  return (
    <div
      data-layer="Feature Card"
      className={`relative overflow-hidden rounded-[20px] border border-landing-line bg-landing-raised ${className ?? ""}`}
    >
      {inner}
    </div>
  );
}

function Fact({
  icon: Icon,
  lead,
  body,
}: {
  icon: LucideIcon;
  lead: string;
  body: ReactNode;
}) {
  return (
    <p className="max-w-[300px] text-[15px] leading-[1.6] text-balance text-landing-muted">
      <span className="font-medium text-landing-ink">
        <Icon
          className="mr-1.5 inline size-4 -translate-y-0.5"
          strokeWidth={1.75}
        />
        {lead}
      </span>{" "}
      {body}
    </p>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-[13px] text-landing-ink">{children}</code>
  );
}

export function Features() {
  return (
    <section
      data-layer="Features"
      className="border-t border-landing-line py-24 md:py-40"
    >
      <Container>
        <SectionTitle
          title="No handoff."
          muted="The design is React and Tailwind code in your repo."
        />

        <Reveal className="mt-12 grid gap-3 md:mt-20 md:grid-cols-5">
          <Card
            lead="Every width at once."
            body="One file renders at desktop and mobile side by side, and a click tells your agent which width you meant."
            className="flex flex-col md:col-span-3"
          >
            <div className="relative mt-auto pl-6 md:pl-8">
              <img
                src="/assets/landing/feat-responsive.webp"
                width={2007}
                height={1110}
                loading="lazy"
                decoding="async"
                alt="The Welcome frame at 1440 and 390 pixels wide"
                className="block h-auto w-full rounded-tl-[10px] shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
              />
            </div>
          </Card>
          <Card
            lead="Layer-accurate notes."
            body="Click inside a frame and Framio selects the nearest named layer. Your agent gets that element, not your best description of it."
            className="flex flex-col md:col-span-2"
          >
            <div className="relative mt-auto flex justify-center px-6 md:px-8">
              <img
                src="/assets/landing/feat-layers.webp"
                width={494}
                height={735}
                loading="lazy"
                decoding="async"
                alt="The Frames and layers tree with Line Items selected"
                className="block h-auto w-full max-w-[300px] rounded-t-[10px] shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
              />
            </div>
          </Card>
        </Reveal>

        <div className="mt-12 grid gap-8 md:mt-20 md:grid-cols-2 md:gap-y-10 lg:grid-cols-4 lg:gap-8">
          <Reveal delay={0}>
            <Fact
              icon={Palette}
              lead="One DESIGN.md."
              body="Colors, fonts, and radii live in one file. Edit it and every frame restyles on save."
            />
          </Reveal>
          <Reveal delay={70}>
            <Fact
              icon={ScanSearch}
              lead="Checks its own work."
              body={
                <>
                  <Mono>framio inspect</Mono> flags overflow, misalignment,
                  contrast, and tap targets before you see the frame.
                </>
              }
            />
          </Reveal>
          <Reveal delay={140}>
            <Fact
              icon={Blocks}
              lead="Real components."
              body="Frames start with shadcn/ui, and your agent can add blocks from shadcn registries."
            />
          </Reveal>
          <Reveal delay={210}>
            <Fact
              icon={GitBranch}
              lead="Plain files."
              body="Designs are .tsx files and comments are JSON, all in your repo. Diff them and review them in a PR."
            />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
