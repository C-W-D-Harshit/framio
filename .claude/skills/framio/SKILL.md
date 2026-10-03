---
name: framio
description: Design and review UI in Framio's .framio canvas. Use for screens, flows, landing pages, frames, variations, and changes to selected canvas elements.
---

# Framio

Framio frames are ordinary React + Tailwind mockups in `.framio/pages/<page>/<frame>.tsx`.
Use realistic static content, with no data fetching, backend logic, or Effect imports.
Run `framio start` before designing. The printed URL opens the canvas.

## Before making a design

Read the existing UI, `.framio/BRIEF.md`, and `.framio/DESIGN.md` first. For a new product,
ask only what is missing, at most five questions together. Establish the audience, main job,
product difference, conversion goal, and taste constraints. Ask for existing product facts or
proof where the design needs them. Do not turn category assumptions into product facts.

Keep these rules active while designing:

- Separate confirmed facts, proposed assumptions, and demo data. A plausible transaction is
  useful inside a mock product view. An invented customer result, price, certification, offer,
  capability, or testimonial is not marketing proof. Omit unsupported claims or mark proposed
  copy for the user's review in the evidence record.
- Write concrete copy for the actual product. Keep controls concise. Remove filler and apply
  [references/copy.md](references/copy.md) to every text-bearing component.
  Never use em dashes. Use a middle dot in titles, for example `my-app · Framio`.
- Give the buyer one clear promise and show how the product supports it. A chart must show the
  comparison its caption claims. A shared-data promise needs a coherent cross-module example.
- Choose composition, density, typography, and imagery for this audience and job. Centered
  heroes, cards, grids, gradients, and serif type can all be appropriate. Judge their effect
  on hierarchy and product understanding rather than banning a style.

## Choose the work you need

| Task | Work |
| --- | --- |
| New website or product, substantial redesign | Brief, meaningful direction fragments, user choice, DESIGN.md, screens, review |
| New screen in an existing project | Existing brief and tokens, structure, screen, review |
| Change to a frame | Read the selection and relevant evidence, edit, review the affected crop and frame |
| Implement a design in the real app | Read [references/handoff.md](references/handoff.md) |
| Address comments | Read [references/comments.md](references/comments.md), preserve every user comment |

Read [references/process.md](references/process.md) for the workflow and
[references/evidence.md](references/evidence.md) for the persistent decision record.
Use `framio evidence` to read it, then `framio evidence --write <file> --expect <revision>`
with that response's revision to save a validated whole document. Use `--expect new` only
when the record is missing. The canvas Evidence panel exposes the same record. Store decisions and
artifact paths, not checkmarks claiming work happened.

For a new landing page, review the actual hero and product demonstration before expanding
the rest of the page. Explore different ways to explain the product within the user's constraints. A palette choice does not approve a different layout.
Finish and visually review one direction fragment before making the next, then show the
directions and wait for the user's choice. When the user has already chosen a direction,
continue within it without asking again.

## Design system

Write the selected direction to `.framio/DESIGN.md` and run
`npx @google/design.md lint .framio/DESIGN.md`. Fix invalid tokens and contrast findings.
Framio applies the tokens and fonts automatically. Follow
[references/design-md.md](references/design-md.md); keep `theme.css` as the base theme.
The scaffold includes shadcn/ui controls. Keep repeated product chrome in shared components.
Record imagery choices in DESIGN.md. A product demonstration can
be the visual centerpiece; photography or decorative illustration is not mandatory.

## Review one frame at a time

1. Build the smallest meaningful fragment for the current decision. For a landing page this
   is the hero plus its product demonstration, not the whole page.
2. Run `framio inspect <page>/<frame>`, check `.framio/.state/errors.json`, and fix known errors.
   Capture one or two useful crops with `framio screenshot <page>/<frame> --layer "Content/Hero"`
   and open the returned `archivePath` PNGs at a readable size.
3. Review the fragment against the brief. Record what the buyer learns,
   what changed, why the composition fits, and any unresolved assumption in the evidence.
4. After corrections, recheck the affected crop. Complete each frame with a full-frame review
   at the primary and smallest requested width. Review hierarchy, copy truth, demo consistency,
   alignment, spacing, contrast, clipping, imagery, and the intended next action.

A successful screenshot command or empty diagnostic list does not prove design quality.
Use one focused visual pass and a comparison revision where needed for subjective refinements.
Keep fixing known correctness and readability issues. Do not repeatedly recapture unaffected
sections or turn polish into an open-ended search for a different aesthetic. Full-page captures
check composition; crops check details. A page overview is an additional consistency check.
Report the decisions, frames reviewed, and remaining limitations before claiming completion.

## Commands and files

| Command | Use |
| --- | --- |
| `framio start` / `framio start --background` | Run the canvas, use background mode when a persistent terminal is unavailable |
| `framio list` / `framio stop --all` | Find or stop project servers |
| `framio screenshot <page>/<frame> --width 1440` | Capture a viewport, open the actual returned path |
| `framio screenshot <page>/<frame> --layer "Content/Hero"` | Capture a named layer with context |
| `framio inspect <page>/<frame> --width 390` | Read geometry, styles, and automatic checks at a viewport |
| `framio screenshot --page <page>` | Capture the canvas arrangement and notes |
| `framio evidence` / `framio evidence --write <file> --expect <revision>` | Read or replace evidence using the revision you read |
| `framio install <package>` / `framio add <registry-item>` | Install packages or reusable components |

Never run npm, pnpm, or yarn installs in `.framio`. Never edit `canvas.json` or `.state/`.
Delete `pages/00-example` once real work starts. Drop your images into a page folder to make
a moodboard, with optional source and note sidecar JSON. Design assets live in `assets/` and use `/assets/<name>` URLs.
Preserve existing work and comments. User instructions and existing authorization take priority.

## Frames, layers, and selection

```tsx
import { Button } from "@/components/ui/button";

export const meta = {
  name: "Landing",
  width: 1440,
  height: 900,
  widths: [1440, 390],
};

export default function Frame() {
  return <div className="min-h-screen bg-background text-foreground">
    <header data-layer="Header">...</header>
    <main data-layer="Content">
      <section data-layer="Hero">...</section>
    </main>
  </div>;
}
```

`meta` must be a plain object literal. Frames grow with content. Optional `heights` must match
`widths`; default viewport heights are 900 here at desktop, 1024 for tablet, and 844 for mobile.
With `widths`, screenshots use `<slug>@<width>.png`, so use the returned path instead of an older
unsuffixed file. Use theme utilities such as `bg-primary`, `border-border`, `rounded-lg`, and
`type-display`. Do not hardcode colors covered by tokens.

Name meaningful sections, cards, and rows with `data-layer` by purpose. Paths follow named
ancestors, for example `Content/Hero`; repeated items use `Transaction Row[2]`. Skip decorative
spans. Keep `/`, `[` and `]` for path syntax. Read `.framio/.state/selection.json` when the user
says "this", "here", or "selected". Its frame, width, element, and layer identify the target.

Explore alternatives as `<frame>--<idea>.tsx` with `variationOf: "<original-slug>"` and a new
name. Edit in place when the user asks to fix that frame. Mobile frames show product content
in a plain rectangle, without phone hardware, imitation scrollbars, or OS chrome unless requested.
For fixed-height screens, give scrollable content `flex-1 min-h-0` so the product navigation fits.
