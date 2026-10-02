import { RELEASE_VERSION } from "@/lib/site";
/* Adapted from Tailark Mist hero-section-5 and the Mist header (MIT, Copyright (c) Tailark). */
import ShinyText from "@/components/ShinyText";
import { CanvasDots } from "./texture";
import {
  AgentsLine,
  Capture,
  Container,
  GitHubMark,
  InstallCTA,
  Stage,
  links,
  REPO,
  useFx,
} from "./primitives";

const navItems = ["How it works", "Docs", "Changelog"];

export function SiteNav() {
  return (
    <nav
      aria-label="Main navigation"
      data-layer="Nav"
      className="relative z-20"
    >
      <Container className="flex h-16 items-center justify-between">
        <a href="/" aria-label="Framio home">
          <img
            src="/assets/brand/framio-wordmark-on-dark.png"
            alt="Framio"
            width={797}
            height={244}
            className="h-5 w-auto md:h-[22px]"
          />
        </a>
        <ul className="absolute inset-x-0 mx-auto hidden w-fit gap-8 text-[14px] text-landing-muted md:flex">
          {navItems.map((item) => (
            <li key={item}>
              <a href={links[item]}>{item}</a>
            </li>
          ))}
        </ul>
        <a
          href={REPO}
          aria-label="Framio on GitHub"
          className="flex h-9 items-center gap-2 text-[14px] text-landing-ink"
        >
          <GitHubMark className="size-5 md:size-4" />
          <span className="hidden md:inline">GitHub</span>
        </a>
      </Container>
    </nav>
  );
}

export function Hero() {
  const fx = useFx();
  return (
    <section
      data-layer="Hero"
      className="relative overflow-hidden pt-8 pb-16 md:pt-10 md:pb-24"
    >
      <CanvasDots
        animated={fx}
        className="h-[760px] [mask-image:radial-gradient(70%_60%_at_50%_38%,black_35%,transparent_80%)] md:h-[820px]"
      />
      <Container className="relative flex flex-col md:items-center md:text-center">
        <div
          data-layer="Release Pill"
          className="flex w-fit items-center gap-3 rounded-full border border-landing-line bg-landing-raised py-1 pr-4 pl-1 text-[14px] md:gap-3.5 md:text-[15px]"
        >
          <span className="rounded-full bg-corner-blue px-3 py-1 text-[13px] font-semibold text-on-corner-blue">
            MIT
          </span>
          <span className="text-landing-ink">{RELEASE_VERSION}</span>
          <span aria-hidden className="text-landing-muted">
            ·
          </span>
          <span className="text-landing-muted">free and open source</span>
        </div>
        <h1 className="mt-8 text-[38px] leading-[1.04] font-semibold tracking-[-0.04em] md:type-landing-display">
          Design in your repo.
          <br />{" "}
          {fx ? (
            <ShinyText
              text="Review on a canvas."
              color="#A1A1AA"
              shineColor="#F4F4F5"
              speed={3}
              spread={110}
            />
          ) : (
            <span className="text-landing-muted">Review on a canvas.</span>
          )}
        </h1>
        <p className="mt-6 max-w-[620px] text-[16px] leading-[1.55] text-landing-muted md:type-landing-lead">
          Framio is a design canvas for Claude Code, Codex, and other coding
          agents. Every screen is a React and Tailwind file in your project. Pin
          a comment, and your agent replies and fixes it.
        </p>
        <InstallCTA center className="mt-8" />
      </Container>

      <Container className="relative mt-20 md:mt-16">
        <Stage>
          <Capture
            src="/assets/landing/hero-thread.webp"
            mobileSrc="/assets/landing/hero-thread-mobile.webp"
            alt="Framio Studio showing a React invoice design, named layers, and a pinned comment thread"
          />
        </Stage>
        <AgentsLine className="mt-8 md:mt-10 md:justify-center" />
      </Container>
    </section>
  );
}
