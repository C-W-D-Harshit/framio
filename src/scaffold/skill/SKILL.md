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
| `framio start` | Run the canvas in a persistent terminal. Ctrl+C stops it. Run it before designing. |
| `framio start --background` | Explicit background mode when a persistent terminal is unavailable. Stop it with `framio stop` when finished. |
| `framio list` / `framio stop --all` | List or stop servers across projects. |
| `framio screenshot <page>/<frame>` | Save the full frame, top-level layer crops, and the layer tree. |
| `framio screenshot <page>/<frame> --layer "Content/Balance card"` | Screenshot a layer with context. Repeat `--layer` for several crops. |
| `framio inspect <page>/<frame> [--layer "<path>"]` | Print layer geometry, styles, child spacing, and automatic checks as JSON. |
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
  comments.json          # user feedback and agent replies, versioned with designs
  .state/selection.json  # what the user selected on the canvas (read-only)
  .state/errors.json     # errors and non-blocking layer warnings (read-only)
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

## Building the real app

When asked to implement, build, or ship a design in the user's app, read
`references/handoff.md`. Port the theme and components into the app, follow its conventions,
replace mock data, and verify each screen with `framio screenshot --url <url> --compare <page>/<frame>`.
Never import from `.framio` at runtime.

## Addressing comments

When asked to address or fix comments, read `references/comments.md` and the open comments in
`.framio/comments.json`. Fix and visually verify each, append an agent reply, and resolve it.
Never delete user comments.

## Design skills (required)

Load external skills only when the current phase needs them. During the brief and research,
read the Framio instructions, understand the request, ask necessary questions, and gather
references. Do not fetch design or polish skills yet.

Immediately before creating the first designed frame, load the required skills with
`npx ui-skills get <slug>`, read them fully, and follow them:

`emil-design-eng`, `transitions-dev`, `better-ui`, `shadcn`, `ui-ux-pro-max`

Load each once per session. Add other skills just before their specific work starts, rather
than fetching the whole routing table up front. See `references/skills.md` for timing.
For dashboards, load `better-ui` with `npx -y skills use jakubkrehel/skills@better-ui`
instead of `ui-skills get`, and also load
`npx -y skills use wshobson/agents@kpi-dashboard-design` before the first dashboard frame.
When a skill conflicts with Framio's rules (it says to scaffold an app,
write HTML, or wire real data), Framio's rules win.

## Finish one frame before the next

Work on exactly one frame at a time, including directions, design-system frames, screens,
and variations. For each frame:

1. Build one meaningful layer, screenshot it with `--layer`, inspect the crop, and fix it before the next layer. Finish with the full frame.
2. Run `framio inspect` first in critique and fix its findings, then review the layer crops. Check `.framio/.state/errors.json`, fix errors, and run `framio screenshot <page>/<frame>`.
3. Open the PNG and inspect it visually. Check layout, alignment, spacing, typography, colors,
   contrast, clipping, imagery, and every visible detail. A successful command is not a review.
4. Fix every issue you find, including minor ones. Screenshot again and inspect the new PNG.
   Repeat until the frame has no visible mistakes.
5. Only then move to the next frame.

Never create several frames and review them afterward. Whole-page screenshots are additional
checks for consistency and flows; they do not replace inspecting each individual frame.

## Inspiration (Mobbin)

If Mobbin tools are available (`search_flows`, `search_screens`, `search_sections`), use them in
research and whenever you design a screen type you haven't researched: look at how the best
products handle that exact flow or screen before designing it. Save the references you rely on to
the moodboard page (see `references/process.md`).

## Landing-page templates

When asked to make a landing page, consider StyleUI's Axis and Notio templates when they fit
the brief. See `references/libraries.md` for registry URLs and import commands. Import only
the chosen template into `.framio`, then customize its sections, content, imagery, and styling
to DESIGN.md. Use it as a starting point, and visually verify each frame before making the next.

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

For maps, globes, animated backgrounds, and other creative SVG-style visuals, use web search
to find an existing React component before implementing it. Prefer React Bits when it has a
suitable component; also check other React libraries and registries for the specific visual.
Read the component's docs and code, then reuse and style it to DESIGN.md instead of drawing
the visual by hand with SVG or HTML. Use `framio add` for registry components and
`framio install` for packages. Build a custom visual only when no suitable component exists
or the user explicitly requests one.

## Frame format

```tsx
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export const meta = {
  name: "Pricing",          // label on the canvas
  width: 1440,              // viewport width (mobile: 390)
  height: 900,              // viewport height; h-screen / min-h-screen equal this
  widths: [1440, 768, 390],  // optional: one component at every responsive width
  // heights: [900, 1024, 844], // optional: overrides in the same order as widths
  variationOf: "pricing",   // optional: slug of the frame this is a variation of
  theme: "dark",            // optional: render with the .dark theme
};

export default function Frame() {
  return <div className="min-h-screen bg-background">
    <header data-layer="Header">…</header>
    <main data-layer="Content">
      <section data-layer="Pricing Plans">…</section>
    </main>
    <footer data-layer="Footer">…</footer>
  </div>;
}
```

- Use `widths` for responsive screens. The first width is primary; the canvas groups viewports
  largest first. Heights default to `height` at widths ≥1024, 1024 at 600–1023, and 844 below 600.
  `heights`, if provided, must have the same length as `widths`. Without `widths`, behavior is unchanged.
  Screenshot captures every width as `<slug>@<width>.png`; `--width <n>` captures one. Inspect
  and fix the smallest width too. Selection includes a `width` for responsive viewports.
- `meta` must be a plain object literal (it is read without running the file).
- Frames grow to fit their content. Put `min-h-screen` on the root of full screens.
- Style with theme tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, `border`,
  `rounded-lg`), DESIGN.md colors (`bg-<name>`), and type styles (`type-display`, `type-body-md`,
  `font-heading`). Never hardcode a color that a token covers.

## Layers

Give every direct child of the frame root and every meaningful section `data-layer`.
Name by purpose in Title Case: "Balance Card", not "Blue Box". Use one singular name for
repeated items ("Transaction Row"). Name sections, cards, rows, and button groups as deeply
as you would discuss them with someone; skip decorative spans. This is plain JSX, including
in shared components.

Paths follow named DOM ancestors: `Content/Balance Card`. Repeated siblings get indexes:
`Content/Transaction Row[2]`; omitting the index selects the first. Use `/`, `[` and `]` only
as path syntax, not in names. Literal names can be renamed in the canvas; expressions cannot.

## Mobile screens

Design the app content directly in a plain rectangular frame, typically 390px wide. Do not
draw phone hardware or operating-system chrome: no bezels, device shadows, notches, Dynamic
Island, status bars, fake clocks, battery/Wi-Fi/signal indicators, or OS home/gesture bars.
Include these only if the user explicitly requests a device presentation. Keep the app's own
headers, tab bars, and navigation. Do not reserve decorative blank bands for phone chrome.

For a fixed-height screen, keep the app header and navigation in the layout and give the main
content `flex-1 min-h-0`; avoid stacking fixed-height sections that overflow the screen.
Framio hides browser scrollbars in frames. Do not draw imitation scrollbars in the mockup.

## Variations, selection, verification

- **Explore with variations, don't overwrite.** To try an idea, copy the frame to
  `<frame>--<what-changed>.tsx`, set `variationOf` and a new `name`, then change the copy. Edit in
  place only when the user asks to fix or update that frame.
- **"This" means the selection.** When the user says "this", "these", "here", or "the selected",
  read `.framio/.state/selection.json`. `frames` lists selected frames; `element` (when a single
  element was clicked) has its tag, text, classes, HTML, and CSS selector. `layer`, when present,
  has `{ path, name }`. "This" or "here" with a selected layer means that layer; use its path
  with `--layer` for screenshots.
- **Verify.** After changes, check `.framio/.state/errors.json`, screenshot what you touched, and
  look at the image before saying you're done.
