import { RELEASE_VERSION } from "@/lib/site";
/* Adapted from Tailark Mist hero-section-5 and the Mist header (MIT, Copyright (c) Tailark). */
import { ArrowRight } from "lucide-react";
import { CanvasDots } from "./texture";
import {
  AgentsLine,
  Capture,
  Container,
  GitHubMark,
  InstallCTA,
  Stage,
  external,
  ExternalArrow,
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
              <a
                href={links[item]}
                {...external(links[item])}
                className="group flex items-center gap-1 transition-colors duration-150 hover:text-landing-ink"
              >
                {item}
                {links[item].startsWith("http") && <ExternalArrow />}
              </a>
            </li>
          ))}
        </ul>
        <a
          href={REPO}
          {...external(REPO)}
          aria-label="Framio on GitHub"
          className="press flex h-9 items-center gap-2 text-[14px] text-landing-ink transition-[opacity,transform] duration-150 hover:opacity-75"
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
        <a
          href={`${REPO}/releases/tag/${RELEASE_VERSION}`}
          {...external(`${REPO}/releases/tag/${RELEASE_VERSION}`)}
          data-layer="Release Pill"
          className="hero-in group press flex w-fit items-center gap-3 rounded-full border border-landing-line bg-landing-raised transition-[border-color,transform] duration-150 hover:border-[#3F3F46] py-1 pr-4 pl-1 text-[14px] md:gap-3.5 md:text-[15px]"
        >
          <span className="rounded-full bg-corner-blue px-3 py-1 text-[13px] font-semibold text-on-corner-blue">
            MIT
          </span>
          <span className="text-landing-ink">{RELEASE_VERSION}</span>
          <span aria-hidden className="text-landing-muted">
            ·
          </span>
          <span className="text-landing-muted">free and open source</span>
          <ArrowRight
            aria-hidden
            className="nudge-right -ml-1 size-3.5 text-landing-muted"
            strokeWidth={2}
          />
        </a>
        <h1 className="hero-in mt-8 max-w-[820px] [--i:1] text-[38px] leading-[1.04] font-semibold tracking-[-0.04em] text-balance md:type-landing-display">
          A design canvas for coding agents.
        </h1>
        <p className="hero-in mt-6 max-w-[620px] [--i:2] text-[16px] leading-[1.55] text-landing-muted md:type-landing-lead">
          Framio runs inside your coding agent, in your repo. It reads your
          code, your theme, and your live pages, so new screens and redesigns
          start from what you've built. Click what's wrong and it fixes the
          file.
        </p>
        <InstallCTA center className="hero-in mt-8 [--i:3]" />
        <a
          href="#whats-new"
          className="hero-in mt-5 w-fit [--i:3] text-[14px] text-landing-muted underline underline-offset-4 hover:text-landing-ink"
        >
          New: remote canvases and shared updates
        </a>
      </Container>

      <Container className="hero-in relative mt-20 [--i:4] md:mt-16">
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
