/*
 * Measured speed. Centered headline over an interlocking bento: a hero benchmark card with a
 * slow conic beam on its border, the five save timings as a glowing mono board, and three
 * spotlight stat cards. Every number comes from timed runs of the v0.0.7 release binary on an
 * Apple M4 with 16 GB of memory; update them from the next measured run, never by guess. The
 * trace rows are the five individual save-to-rebuild timings from that run.
 */
import type { CSSProperties } from "react";
import CountUp from "@/components/CountUp";
import SpotlightCard from "@/components/SpotlightCard";
import { Container, Reveal, useFx } from "./primitives";
import { PanelDots } from "./texture";

const saves = [114, 102, 101, 105, 100];
const median = 102;
const scale = 150; // ms at the right edge of the trace

const stats = [
  {
    to: 0.6,
    unit: "s",
    label: "From framio start to a live canvas.",
  },
  {
    to: 6,
    unit: "s",
    label: "First framio init, packages included. 0.4 s after that.",
  },
  {
    to: 33,
    unit: "MB",
    label: "One download for macOS. No Electron app, no account, no cloud.",
  },
];

/** Five timed saves as a mono board: glowing bars, gridlines, and a dashed median marker. */
function Trace() {
  const ticks = [0, 50, 100, 150];
  return (
    <div className="relative flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between font-mono text-[11px] text-landing-muted">
        <span>framio · save → rebuilt frame</span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-signal" />
          5 saves
        </span>
      </div>

      <div className="relative flex-1">
        {/* Gridlines and the median marker sit behind the rows. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 ml-16">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute inset-y-0 w-px bg-landing-line/70"
              style={{ left: `${(t / scale) * 100}%` }}
            />
          ))}
          <span
            className="absolute inset-y-0 w-px border-l border-dashed border-signal/60"
            style={{ left: `${(median / scale) * 100}%` }}
          />
        </div>

        <ol className="relative flex flex-col gap-3">
          {saves.map((ms, i) => (
            <li key={i} className="flex items-center gap-0">
              <span className="w-16 shrink-0 font-mono text-[11px] text-landing-muted">
                save {i + 1}
              </span>
              <span className="relative h-8 flex-1">
                <span
                  className="trace-bar absolute inset-y-0 left-0 flex origin-left items-center justify-end rounded-[6px] pr-2.5"
                  style={
                    {
                      width: `${(ms / scale) * 100}%`,
                      "--i": i,
                      background:
                        "linear-gradient(90deg, rgb(12 100 255 / 0.04), rgb(110 155 255 / 0.30))",
                      boxShadow:
                        "inset 0 0 0 1px rgb(110 155 255 / 0.35), 0 0 24px rgb(12 100 255 / 0.10)",
                    } as CSSProperties
                  }
                >
                  <span className="font-mono text-[11px] text-landing-ink tabular-nums">
                    {ms} ms
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4 ml-16 flex justify-between font-mono text-[10px] text-landing-muted">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <p className="mt-3 ml-16 font-mono text-[11px] text-signal">
        median {median} ms
      </p>
    </div>
  );
}

/** The headline number: gradient ink with a glow, in a card ringed by a slow conic beam. */
function Benchmark() {
  const fx = useFx();
  return (
    <div className="relative h-full overflow-hidden rounded-[22px] p-px">
      {/* Static lit edge; the beam travels on top of it while motion is allowed. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(180deg,rgb(110_155_255/0.45),rgb(39_39_42)_35%,rgb(39_39_42))]"
      />
      {fx && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div
            className="beam-spin aspect-square w-[160%] shrink-0"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, transparent 305deg, rgb(12 100 255 / 0.9) 348deg, rgb(110 155 255) 360deg)",
            }}
          />
        </div>
      )}
      <div className="relative flex h-full flex-col justify-between gap-10 overflow-hidden rounded-[21px] bg-landing-raised p-6 md:p-8">
        <PanelDots className="[mask-image:radial-gradient(120%_55%_at_50%_0%,black,transparent)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(12_100_255/0.22),transparent)] blur-xl"
        />
        <div className="relative flex items-center justify-between font-mono text-[11px] text-landing-muted">
          <span>save .tsx → rebuilt frame</span>
          <span className="hidden md:inline">median of five saves</span>
        </div>
        <div className="relative">
          <p className="flex items-baseline gap-2.5">
            <CountUp
              to={100}
              animate={fx}
              className="bg-[linear-gradient(180deg,#f4f4f5_20%,#6e9bff_115%)] bg-clip-text text-[104px] leading-[0.88] font-semibold tracking-[-0.05em] text-transparent tabular-nums [filter:drop-shadow(0_0_36px_rgb(12_100_255/0.35))] md:text-[136px]"
            />
            <span className="text-[26px] font-medium text-landing-muted md:text-[30px]">
              ms
            </span>
          </p>
          <p className="mt-6 max-w-[340px] text-[15px] leading-[1.6] text-landing-muted">
            Your agent saves a frame and the canvas has the new version a tenth
            of a second later. You never wait on it.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  to,
  unit,
  label,
  index,
}: (typeof stats)[number] & { index: number }) {
  const fx = useFx();
  const inner = (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(70%_100%_at_50%_0%,rgb(12_100_255/0.14),transparent)]"
      />
      <div className="relative p-6 md:p-7">
        <p className="flex items-baseline gap-1.5">
          <CountUp
            to={to}
            animate={fx}
            delay={0.1 + index * 0.07}
            className="text-[44px] leading-none font-semibold tracking-[-0.04em] text-landing-ink tabular-nums md:text-[48px]"
          />
          <span className="text-[18px] font-medium text-landing-muted">
            {unit}
          </span>
        </p>
        <p className="mt-3 text-[14px] leading-[1.55] text-landing-muted">
          {label}
        </p>
      </div>
    </>
  );
  if (fx) {
    return (
      <SpotlightCard
        className="h-full !rounded-[18px] !border-landing-line !bg-landing-raised !p-0"
        spotlightColor="rgba(12, 100, 255, 0.20)"
      >
        <div data-layer="Speed Stat" className="contents">
          {inner}
        </div>
      </SpotlightCard>
    );
  }
  return (
    <div
      data-layer="Speed Stat"
      className="relative h-full overflow-hidden rounded-[18px] border border-landing-line bg-landing-raised"
    >
      {inner}
    </div>
  );
}

export function Speed() {
  const fx = useFx();
  return (
    <section
      id="speed"
      data-layer="Speed"
      className="relative border-t border-landing-line py-24 md:py-40"
    >
      <Container className="relative">
        <Reveal className="mx-auto max-w-[780px] text-center">
          <p className="font-mono text-[12px] text-signal">
            measured on apple m4
          </p>
          <h2 className="mt-4 text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance md:type-landing-h2">
            Fast enough to keep up with your agent.
          </h2>
          <p className="mx-auto mt-5 max-w-[540px] text-[16px] leading-[1.6] text-landing-muted md:text-[18px]">
            One binary that serves your designs on localhost. Nothing to sign
            in to, nothing to sync.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-flow-dense gap-3 md:mt-16 md:grid-cols-5">
          <Reveal delay={80} className="md:col-span-2 md:row-span-2">
            <Benchmark />
          </Reveal>
          <Reveal delay={140} className="md:col-span-3">
            <div className="h-full overflow-hidden rounded-[22px] border border-landing-line bg-landing-raised p-6 md:p-8">
              <Trace />
            </div>
          </Reveal>
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={200 + i * 70}>
              <Stat {...s} index={i} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
