import { RELEASE_VERSION } from "@/lib/site";
import Brand from "@/components/Brand";
/*
 * FAQ adapted from Tailark Dusk faqs-1, closing call to action from Dusk call-to-action-1,
 * footer from Dusk footer-1 (MIT, Copyright (c) Tailark). The first answer is open on initial load.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Container,
  GitHubMark,
  InstallCTA,
  SectionTitle,
  external,
  ExternalArrow,
  links,
  REPO,
  Reveal,
} from "./primitives";
import { Grain, PanelDots } from "./texture";

import { landingLogger } from "@/lib/posthog-logs";
import { faqs } from "@/lib/site";

export function FAQ() {
  const [openQuestions, setOpenQuestions] = useState(
    () => new Set([faqs[0].q]),
  );
  return (
    <section
      id="faq"
      data-layer="FAQ"
      className="border-t border-landing-line py-24 md:py-40"
    >
      <Container className="grid gap-10 md:grid-cols-2 md:gap-6">
        <SectionTitle
          title="Fair questions."
          muted="What people ask about Framio."
          className="md:max-w-[360px]"
        />
        <Reveal className="flex flex-col">
          {faqs.map((f) => (
            <details
              key={f.q}
              open={openQuestions.has(f.q)}
              className="faq-item group border-b border-dashed border-landing-line"
            >
              <summary
                onClick={(event) => {
                  event.preventDefault();
                  if (!openQuestions.has(f.q)) {
                    const faqIndex = faqs.indexOf(f) + 1;
                    window.posthog?.capture("faq_answer_opened", {
                      faq_index: faqIndex,
                    });
                    landingLogger.info("faq answer opened", {
                      faq_index: faqIndex,
                    });
                  }
                  setOpenQuestions((current) => {
                    const next = new Set(current);
                    if (next.has(f.q)) next.delete(f.q);
                    else next.add(f.q);
                    return next;
                  });
                }}
                className="flex cursor-pointer select-none list-none items-center justify-between gap-4 py-5 text-[16px] font-medium text-landing-ink/85 transition-colors duration-150 group-open:text-landing-ink hover:text-landing-ink"
              >
                {f.q}
                <ChevronDown className="size-4 shrink-0 text-landing-muted transition-[transform,color] group-hover:text-landing-ink duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-180" />
              </summary>
              <p className="pb-6 text-[15px] leading-[1.6] text-landing-muted">
                {f.a}
              </p>
            </details>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

export function ClosingCTA() {
  return (
    <section data-layer="Closing" className="pb-24 md:pb-32">
      <Container>
        <Reveal className="relative">
          <div className="relative flex flex-col overflow-hidden shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] rounded-[18px] bg-corner-blue px-6 py-14 text-on-corner-blue md:items-center md:rounded-[28px] md:px-12 md:py-24 md:text-center">
            <PanelDots
              color="rgb(255 255 255 / 0.16)"
              className="[mask-image:radial-gradient(80%_80%_at_50%_50%,black,transparent_90%)]"
            />
            <Grain alpha={40} blend="overlay" />
            <h2 className="relative text-[38px] leading-[1.04] font-semibold tracking-[-0.04em] md:text-[64px]">
              Stop describing pixels.
            </h2>
            <p className="relative mt-5 max-w-[520px] text-[16px] leading-[1.55] text-on-corner-blue md:text-[18px]">
              Let your agent show you before it ships. Install Framio, run{" "}
              <code className="font-mono text-[15px] md:text-[16px]">
                framio init
              </code>{" "}
              in your project, and ask for the screen you're about to build.
            </p>
            <InstallCTA center onBlue className="relative mt-10" />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

const columns = [
  { title: "Product", links: ["How it works", "Changelog", "Releases"] },
  {
    title: "Docs",
    links: ["Quick start", "DESIGN.md", "Commands", "Comments"],
  },
  { title: "Project", links: ["GitHub", "Issues", "Contributing", "Security"] },
];

export function Footer() {
  return (
    <footer
      data-layer="Footer"
      className="border-t border-landing-line py-14 md:py-16"
    >
      <Container className="flex flex-col gap-12 md:flex-row md:justify-between">
        <div className="flex flex-col gap-4">
          <Brand />
          <p className="max-w-[260px] text-[14px] leading-[1.55] text-landing-muted">
            A free, open-source design canvas for coding agents.
          </p>
          <a
            href={REPO}
            {...external(REPO)}
            className="group flex w-fit items-center gap-2 text-[13px] text-landing-muted transition-colors duration-150 hover:text-landing-ink"
          >
            <GitHubMark />
            C-W-D-Harshit/framio
            <ExternalArrow />
          </a>
        </div>
        <div className="grid grid-cols-3 gap-6 md:gap-20">
          {columns.map((c) => (
            <div key={c.title} className="flex flex-col gap-3 text-[14px]">
              <span className="text-landing-ink">{c.title}</span>
              {c.links.map((l) => (
                <a
                  href={links[l]}
                  key={l}
                  {...external(links[l])}
                  className="group flex w-fit items-center gap-1 text-landing-muted transition-colors duration-150 hover:text-landing-ink"
                >
                  {l}
                  {links[l].startsWith("http") && <ExternalArrow />}
                </a>
              ))}
            </div>
          ))}
        </div>
      </Container>
      <Container className="mt-14 flex flex-col gap-2 font-mono text-[12px] text-landing-muted md:flex-row md:justify-between">
        <span>MIT License · {RELEASE_VERSION}</span>
        <span>macOS on Apple Silicon · Linux x64 and arm64 · Windows x64</span>
      </Container>
    </footer>
  );
}
