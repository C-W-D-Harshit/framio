/*
 * Landing pieces adapted from Tailark hero blocks (Mist hero-section-1 and -5,
 * Dusk hero-section-7) and their headers. https://github.com/tailark/blocks,
 * MIT License, Copyright (c) Tailark. Next.js Link/Image are replaced with plain
 * elements; colors come from each direction's tokens.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export const landingFonts =
  '@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap");';

export { INSTALL_COMMAND as INSTALL } from "@/lib/site";

/** The blue from the corner square of the Framio mark. */
export const CORNER_BLUE = "#0C64FF";

export type Tone = "light" | "dark";

/** Direction tokens are plain CSS variables so each frame can set its own. */
export type Tokens = {
  page: string;
  ink: string;
  muted: string;
  line: string;
  raised: string;
};

export function tokenStyle(t: Tokens): CSSProperties {
  return {
    "--l-page": t.page,
    "--l-ink": t.ink,
    "--l-muted": t.muted,
    "--l-line": t.line,
    "--l-raised": t.raised,
    "--l-blue": CORNER_BLUE,
  } as CSSProperties;
}

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn("size-4 fill-current", className)}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const CLAUDE_BURST =
  "m21.564 73.123 21.62-12.132.361-1.057-.361-.584h-1.058l-3.617-.223-12.354-.334-10.712-.445-10.379-.556-2.615-.557L0 54.007l.25-1.613 2.199-1.475 3.144.278 6.956.473 10.434.724 7.568.445 11.214 1.168h1.78l.25-.723-.611-.445-.473-.445-10.796-7.318-11.687-7.735-6.12-4.452-3.312-2.254-1.67-2.115-.723-4.619 3.005-3.31 4.035.277 1.03.279 4.09 3.144 8.736 6.761 11.408 8.403 1.67 1.391.668-.473.083-.333-.751-1.253-6.205-11.213-6.622-11.408-2.95-4.73-.779-2.838c-.278-1.169-.473-2.143-.473-3.34L28.771.613 30.663 0l4.563.612 1.92 1.67 2.838 6.483 4.591 10.211 7.123 13.885 2.087 4.118 1.113 3.812.417 1.168h.724v-.667l.584-7.819 1.085-9.6 1.058-12.354.361-3.478 1.725-4.173 3.423-2.254 2.67 1.28 2.2 3.144-.307 2.031-1.308 8.487-2.56 13.3-1.67 8.904h.975l1.113-1.113 4.507-5.983 7.569-9.46 3.339-3.756 3.895-4.146 2.504-1.976h4.73l3.478 5.176-1.558 5.342-4.869 6.177-4.035 5.231-5.787 7.79-3.617 6.234.334.5.862-.083 13.078-2.782 7.067-1.28 8.431-1.447 3.812 1.78.417 1.81-1.502 3.7-9.015 2.226-10.574 2.114-15.748 3.729-.195.139.222.278 7.096.668 3.033.167h7.429l13.829 1.03 3.617 2.392 2.17 2.922-.362 2.226-5.565 2.838-7.512-1.78-17.53-4.174-6.01-1.503h-.835v.5l5.009 4.898 9.182 8.292L97.776 88.12l.584 2.644-1.475 2.087-1.558-.223-10.1-7.596-3.896-3.423-8.82-7.429h-.584v.78l2.03 2.977 10.741 16.138.556 4.953-.779 1.613-2.782.974-3.06-.556-6.29-8.82-6.482-9.934-5.231-8.904-.64.362-3.089 33.25-1.447 1.698-3.339 1.28-2.782-2.115-1.475-3.423 1.475-6.76 1.78-8.821 1.448-7.012 1.307-8.71.78-2.893-.056-.195-.64.084-6.567 9.015-9.989 13.495-7.902 8.459-1.892.75-3.283-1.697.306-3.032 1.836-2.7 10.935-13.912 6.595-8.625 4.257-4.98-.028-.724h-.25L18.92 85.06l-5.175.668-2.226-2.087.279-3.423 1.057-1.113 8.737-6.01-.028.028Z";

/** The Claude burst from Tailark's Claude logo, in the current text color. */
export function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 110 110"
      aria-hidden
      className={cn("fill-current", className)}
    >
      <path d={CLAUDE_BURST} />
    </svg>
  );
}
