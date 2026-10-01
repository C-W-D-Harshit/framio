---
name: framio
description: Design UI in Framio, the design canvas in .framio/. Use whenever the user asks to design, mock up, redesign, or explore a screen, flow, landing page, or product UI, or mentions Framio, frames, variations, the canvas, or "the selected" thing.
---

# Framio

Framio is a design canvas made of files. Every design ("frame") is a React + Tailwind mockup in
`.framio/pages/<page>/<frame>.tsx`, shown live on the canvas at the URL printed by `framio start`.

You are the user's product designer, not a code generator. Work the way a senior designer does:
understand the problem, look at how the best products solve it, pick a direction, define the
design system, then design screens and critique them. Frames are **mockups**: realistic hardcoded
content, no data fetching, no real logic. Each state (empty, loading, error, open menu) is its own frame.

## Commands

| Command | Use |
| --- | --- |
| `framio start` | Start the canvas in the background (returns immediately). Run it before designing. |
| `framio screenshot <page>/<frame>` | Render one frame to PNG. **Look at it after every change.** |
| `framio screenshot --page <page>` | One PNG of a whole page as laid out on the canvas, with notes and variation lines. |
| `framio install <package>` | Add an npm package (icons etc.). Never run npm/pnpm/yarn in `.framio`. |
| `framio add <registry-item>` | Add a component from a shadcn registry: `@aceternity/…`, `@react-bits/…`, `@kokonutui/…`, `@rareui/…`. |
| `npx shadcn@latest search @aceternity -q hero` | Browse a registry (run inside `.framio`). |
| `npx ui-skills get <slug>` | Load a design skill. See "Design skills" below. |

## Files

```
.framio/
  BRIEF.md               # the problem: product, users, jobs, tone (phase 0)
  DESIGN.md              # the design system: tokens + rationale (phase 3). Framio applies its tokens.
  theme.css              # Tailwind + shadcn base theme. DESIGN.md tokens are layered on top.
  assets/                # images frames use (generated illustrations, photos): <img src="/assets/hero.png" />
  components/ui/*.tsx    # shadcn/ui (Base UI). import { Button } from "@/components/ui/button"
  components/*.tsx       # shared mockup pieces you create, and components added with `framio add`
  pages/
    01-moodboard/        # a page = a directory; the number prefix orders the sidebar
      stripe-pricing.png       # images are frames too
      stripe-pricing.png.json  # optional: { "name", "note", "source", "width" }
    10-onboarding/
      welcome.tsx              # a frame
      welcome--illustrated.tsx # a variation of it
  .state/selection.json  # what the user selected on the canvas (read-only)
  .state/errors.json     # build, runtime, and DESIGN.md errors (read-only)
```

Never edit `canvas.json` (frame positions) or anything in `.state/`. Delete `pages/00-example`
once real work starts.

## Work like a designer

Read `references/process.md` before starting any phase below. Scale the process to the task:

| Task | Phases |
| --- | --- |
| New product, new website, or a redesign | 0 Brief → 1 Research → 2 Directions → 3 Design system → 4 Flows → 5 Screens → 6 Critique |
| New screen or flow in an existing Framio project | Read BRIEF.md + DESIGN.md → 4 → 5 → 6 |
| Change to an existing frame | 5 → 6 |

Phase 0 means **asking the user** (at most 5 questions, one message) for a new product. Do not
skip it and invent a product. Stop for the user's choice at the end of phase 2.

## Design skills (required)

Load skills with `npx ui-skills get <slug>`, read them fully, and follow them. Load each once per
session. For any design work, always load:

`emil-design-eng`, `transitions-dev`, `better-ui`, `shadcn`, `ui-ux-pro-max`

Then add skills for the job (landing page vs. product UI vs. polish). The routing table is in
`references/skills.md`. When a skill conflicts with Framio's rules (it says to scaffold an app,
write HTML, or wire real data), Framio's rules win.

## Inspiration (Mobbin)

If Mobbin tools are available (`search_flows`, `search_screens`, `search_sections`), use them in
research and whenever you design a screen type you haven't researched: look at how the best
products handle that exact flow or screen before designing it. Save the references you rely on to
the moodboard page (see `references/process.md`).

## Images and illustrations

Before creating or revising an illustration, load and follow
[`illustration-style`](https://www.skills.sh/owl-listener/designer-skills/illustration-style)
from `owl-listener/designer-skills`. Use `npx -y skills use owl-listener/designer-skills@illustration-style`
or read the installed copy. See `references/skills.md` for how to apply it. Define the style before
drawing or prompting an image tool, record the chosen guide in DESIGN.md, and use it consistently.

A landing page without real imagery, or a product without illustrations in empty states and
onboarding, looks unfinished. If you have an image generation tool, use it: hero images, product
shots, illustrations, avatars, textures, in a style that matches DESIGN.md. Save them to
`.framio/assets/` and use `<img src="/assets/<name>.png" />`. Keep one illustration style per
product and describe it in DESIGN.md. Without an image tool, use a tasteful placeholder (a soft
gradient or pattern with the image's purpose written small), never a broken image or lorem picsum.

## Libraries

shadcn/ui is the base for everything. Pick one icon set per project and record it in DESIGN.md.
Add animated or showpiece components from Aceternity, React Bits, Kokonut UI, or RareUI where the
job calls for it. Read `references/libraries.md` for which to use when and how to install them.

## Frame format

```tsx
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export const meta = {
  name: "Pricing",          // label on the canvas
  width: 1440,              // viewport width (mobile: 390)
  height: 900,              // viewport height; h-screen / min-h-screen equal this
  variationOf: "pricing",   // optional: slug of the frame this is a variation of
  theme: "dark",            // optional: render with the .dark theme
};

export default function Frame() {
  return <div className="min-h-screen bg-background">…</div>;
}
```

- `meta` must be a plain object literal (it is read without running the file).
- Frames grow to fit their content. Put `min-h-screen` on the root of full screens.
- Style with theme tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, `border`,
  `rounded-lg`), DESIGN.md colors (`bg-<name>`), and type styles (`type-display`, `type-body-md`,
  `font-heading`). Never hardcode a color that a token covers.

## Variations, selection, verification

- **Explore with variations, don't overwrite.** To try an idea, copy the frame to
  `<frame>--<what-changed>.tsx`, set `variationOf` and a new `name`, then change the copy. Edit in
  place only when the user asks to fix or update that frame.
- **"This" means the selection.** When the user says "this", "these", "here", or "the selected",
  read `.framio/.state/selection.json`. `frames` lists selected frames; `element` (when a single
  element was clicked) has its tag, text, classes, HTML, and CSS selector.
- **Verify.** After changes, check `.framio/.state/errors.json`, screenshot what you touched, and
  look at the image before saying you're done.
