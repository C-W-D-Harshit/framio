---
name: framio
description: Design UI mockups in Framio, the canvas in .framio/. Use when the user asks to design, mock up, redesign, or explore variations of a screen, page, or UI, or refers to a frame or a selection on the Framio canvas.
---

# Framio

Framio is a design canvas made of files. Every design ("frame") is a React + Tailwind
mockup in `.framio/pages/<page>/<frame>.tsx`. The canvas at the URL printed by
`framio start` shows every frame live and reloads when files change.

Frames are **mockups**: hardcoded, realistic content. No data fetching, no real logic,
no routing. Different states (empty, loading, error, dialog open) are separate frames.

## Commands

- `framio start`: starts the canvas in the background and returns immediately. Run it once
  before designing. It is safe to run again.
- `framio screenshot <page>/<frame>`: renders the frame to a PNG and prints its path.
  **Always look at the screenshot after creating or changing a frame**, then fix what looks off.
- `framio install <package>`: adds an npm package for frames to use. Never run npm, pnpm, or
  yarn inside `.framio`, and never install design packages into the user's project.

## Files

```
.framio/
  theme.css              # design system: colors, radius, fonts (Tailwind v4 + shadcn variables)
  components/ui/*.tsx    # shadcn/ui components (Base UI flavor), import from "@/components/ui/<name>"
  components/*.tsx       # shared mockup pieces you create (AppHeader, Sidebar...), import "@/components/<Name>"
  pages/
    01-onboarding/       # a page = a directory. The number prefix sets the order in the sidebar.
      signup.tsx         # a frame
      signup--split.tsx  # a variation of signup
  .state/selection.json  # what the user has selected on the canvas (read-only for you)
  .state/errors.json     # current build and runtime errors (read-only for you)
```

Do not edit `canvas.json` (frame positions on the canvas) or anything in `.state/`.

## Frame format

```tsx
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export const meta = {
  name: "Pricing",          // label shown on the canvas
  width: 1440,              // viewport width in px (mobile: 390)
  height: 900,              // viewport height in px; h-screen / min-h-screen equal this
  variationOf: "pricing",   // optional: slug of the frame this is a variation of
  theme: "dark",            // optional: render with the .dark theme
};

export default function Frame() {
  return <div className="min-h-screen bg-background">…</div>;
}
```

- `meta` must be a plain object literal (it is read without running the file).
- The frame grows to fit its content on the canvas. For a full screen, put `min-h-screen`
  on the root element so it is at least one viewport tall.
- Use theme tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, `border`,
  `rounded-lg`...) rather than hardcoded colors, so `theme.css` restyles everything.
- Icons: `lucide-react`. Components: everything in `.framio/components/ui` (`ls` it).

## How to work like a designer

1. **Theme first.** For a new product, set colors, radius, and fonts in `theme.css` before
   designing screens, so it does not look like default shadcn. For a redesign, copy the
   existing product's tokens into `theme.css` (read the user's code for reference only;
   frames never import from the user's project).
2. **Explore with variations, don't overwrite.** When the user wants to try something
   ("what if the CTA was dark", "try a sidebar layout"), copy the frame to
   `<frame>--<what-changed>.tsx`, set `variationOf` to the original slug and a new `name`,
   then change the copy. The canvas places it next to the original with a connecting line.
   Edit a frame in place only when the user asks to fix or update that frame.
3. **"This" means the selection.** When the user says "this", "the selected", or "here",
   read `.framio/.state/selection.json`. It has the frame file and, if an element was
   clicked, its tag, text, classes, outer HTML, and a CSS selector.
4. **Shared pieces** (headers, sidebars, nav) go in `.framio/components/` once and are
   imported by every frame that uses them.
5. **Verify.** After changes, check `.framio/.state/errors.json` and screenshot the frames you
   touched.
