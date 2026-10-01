# The Framio design process

Designers don't start by drawing screens. They define the problem, study how others solved it,
choose a direction, set up a system, and only then design screens, which they critique and
refine. Structure comes before polish: never perfect colors and type on a flow that is wrong.

Every phase leaves files behind, so the user (and the next agent session) can see the reasoning.

External skills are loaded just before the work that needs them. Brief and research come first;
do not fetch design, illustration, or polish skills at the start of the task. Follow the timing
in `references/skills.md`.

For every frame, complete this loop before starting another: create the frame, check errors,
screenshot that frame, open and inspect the PNG, fix all visible issues including minor ones,
then screenshot and inspect again. Repeat until it passes. This applies to directions,
design-system frames, screens, and state variations. Imported reference frames also need a
screenshot check for dimensions, legibility, and captions before adding the next reference.
Page screenshots are additional checks after individual frames pass.

## Phase 0: Brief

**Goal:** know what you are designing and for whom.

1. Read what already exists before asking anything: the repo README, `package.json`, existing UI
   code and copy, `.framio/BRIEF.md` if present. Never ask what you can find out yourself.
2. For a new product, ask the user **at most 5 questions in a single message**. Pick the ones
   you can't answer from the repo:
   - What is it, in one sentence, and what problem does it solve?
   - Who uses it (role, context, expertise)?
   - What are the 2–3 most important things they do with it?
   - Platform and form factor (web app, marketing site, mobile web; desktop-first?)
   - Tone and taste: 2–3 products or brands they like the look of, and anything to avoid.
3. Write `.framio/BRIEF.md`:

```md
# Brief: <Product>

## Product
One paragraph: what it is and the problem it solves.

## Users
Who they are, their context, what they care about.

## Jobs to be done
1. When <situation>, I want to <action>, so I can <outcome>.

## Platform
Web app, desktop-first, 1440px frames (mobile 390px later).

## Tone and references
Calm, precise, trustworthy. Likes: Linear, Stripe. Avoid: playful, neon.

## Scope
Screens and flows to design now.
```

## Phase 1: Research

**Goal:** learn from the best existing solutions before designing.

- With Mobbin tools: run `search_flows` for each core job (e.g. "invoice creation flow",
  "onboarding with workspace setup") and `search_screens` / `search_sections` for key screens and
  landing sections. Search one flow or screen per query, with concrete UI words.
- Without Mobbin: use web search or what you know of category leaders, and say so.
- For landing pages, browse Tailark's free pages and blocks during research and shortlist
  components for the brief. See `references/libraries.md`; install selected items on demand.
- Pick 6–12 references that are genuinely good and relevant. Add each reference one at a time:
  download the
  high-resolution `image_url` (it expires; never hotlink) into `.framio/pages/01-moodboard/` and
  write a sidecar `<file>.json`:

```json
{ "name": "Stripe: invoice editor", "note": "Borrow: live preview next to the form; line items as an editable table.", "source": "https://mobbin.com/…" }
```

- The note says **what to borrow and why**, not a description. Screenshot and inspect each
  reference frame before adding the next. After all references pass,
  `framio screenshot --page moodboard` and summarize the patterns you'll use for the user.

## Phase 2: Directions

**Goal:** let the user choose a visual direction before you build a system around it.

- Make 2–3 genuinely different directions in `.framio/pages/02-directions/`, one frame each
  (1440 wide), named after the idea ("Editorial warmth", "Precise and technical"). Different
  means different type pairing, color strategy, density, and shape language, not three shades
  of the same thing.
- Finish and visually verify each direction frame before creating the next. Load the required
  and job-specific design skills immediately before creating the first direction.
- For landing pages, use Tailark's free components in each direction. Use Axis or Notio
  when their structure fits the brief, pairing them with Tailark sections. Follow the import and
  React adaptation workflow in `references/libraries.md`, then customize to the product.
- For dashboards, load `better-ui` and `kpi-dashboard-design` through the `npx skills use`
  commands in `references/skills.md` before designing the first dashboard frame.
- Each direction frame is a style tile: palette swatches with hex values, a type specimen
  (display, heading, body, small), key components (buttons, input, card, nav, a table row or list
  item), and one real fragment of the product (a hero for a site, a key screen for an app).
- Make the second and third directions variations of the first (`variationOf: "<first-slug>"`)
  so they appear beside it on the canvas and in the page screenshot.
- DESIGN.md does not exist yet, so set each direction's tokens on its root element:
  `style={{ "--primary": "#B8422E", "--background": "#F7F5F2" } as React.CSSProperties}` and load
  its fonts with `<style>{'@import url("https://fonts.googleapis.com/css2?family=…")'}</style>`.
- Screenshot the page, show it, and **stop for the user to pick** (or mix) a direction.

## Phase 3: Design system

**Goal:** write the chosen direction down so every screen stays consistent.

1. Write `.framio/DESIGN.md` following `references/design-md.md`. Framio turns its tokens into
   the theme automatically: every frame restyles as soon as you save.
2. Run `npx @google/design.md lint .framio/DESIGN.md` and fix errors and contrast warnings.
   Ignore `orphaned-tokens` warnings: shadcn components use those colors.
3. Build `.framio/pages/03-design-system/` frames: colors (light and dark), typography (every
   `type-*` style), components (button variants and sizes, inputs with states, cards, badges,
   navigation, table, empty state, toast), iconography, and illustration style if any.
   For illustrations, load the required `illustration-style` skill from `references/skills.md`
   and define the illustration guide in DESIGN.md's `## Imagery` section before creating assets.
4. Put repeated product chrome (app shell, sidebar, header, footer) in `.framio/components/`.

For a redesign, load the `create-design-md` skill and derive DESIGN.md from the existing product
first, then change what the brief calls for.

## Phase 4: Flows and structure

**Goal:** get the screens and their order right before the details.

- List each flow's screens and states in a page per flow: `10-onboarding/`, `11-invoices/`, …
- New or complex product flows: start with grayscale wireframe frames (real copy, real
  structure, no color or decoration) to agree on layout and hierarchy, then build hi-fi frames
  as variations of them.
- Landing pages: decide the section order and the job of each section (hook, proof, explain,
  convert), then map sections to reusable Tailark blocks. Search other React + Tailwind libraries
  for missing pieces before custom-building; restyle selected components for the product.

## Phase 5: Screens

**Goal:** finished, believable screens.

- Before writing or changing any component text, read `references/copy.md` once per session
  and apply its unslop process to every component, including copy from imported blocks and
  templates. Self-audit the wording, then check clarity and fit in the rendered frame.
- Real content: real-sounding names, numbers, dates, and copy written for this product. No lorem
  ipsum, no "Item 1", no "John Doe".
- Design every important state as a variation: empty, loading (skeleton), error, success, long
  content, first-run. Empty states and onboarding get illustrations if you can generate images.
- Complete the screenshot-and-fix loop for the current screen before creating the next screen
  or state variation. Do not batch screens for a later review.
- Mobile frames contain app content only. Omit phone hardware, system status bars, clocks,
  battery/signal indicators, and OS home indicators unless explicitly requested. Keep the app's
  own navigation, and check that fixed-height layouts fit without accidental overflow.
- Before creating or revising illustrations, follow the required `illustration-style` skill
  and the guide in DESIGN.md. Use that guide in image prompts, then check the results at the
  sizes where they will appear in the UI.
- Follow DESIGN.md and the loaded skills: type scale, spacing rhythm, one primary action per
  view, aligned edges, consistent radii, restrained color.
- Look at the relevant Mobbin references again before designing each screen type.

## Phase 6: Critique and polish

**Goal:** catch what a senior designer would catch.

1. `framio screenshot --page <page>` and look at the whole flow together, then at single frames.
2. Critique against the loaded skills (`impeccable`, `critique`, `better-ui`): hierarchy,
   alignment, spacing, contrast, density, consistency with DESIGN.md, generic "AI-looking"
   patterns (purple gradients, nested cards, emoji icons, centered-everything layouts).
3. Fix issues one frame at a time. Screenshot and visually inspect every edited frame again,
   repeating until even minor visible errors are resolved. Check the page again for consistency,
   then report to the user what you designed and which frames to look at.
