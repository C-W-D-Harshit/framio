# The Framio design process

Use the smallest process that answers the design question. Existing product facts and an
accepted direction carry forward. A small edit does not need new directions or a fresh
moodboard. The evidence record makes decisions, sources, and reviews visible to the user and
the next agent. Read [evidence.md](evidence.md) for its fields and write command.

## Brief and product truth

Read available product code, copy, assets, and existing BRIEF.md and DESIGN.md before asking.
For a new product, ask missing questions together, at most five. Cover the audience, main job,
what makes the product different, primary action, and visual constraints. If a landing page
needs customer proof or an offer, find its source or ask for it. Brand examples belong in the
brief only when supplied by the user or explicitly proposed by you.

Write `.framio/BRIEF.md` and record the same essential facts in `evidence.json`:

- Confirmed product facts with their source, including relevant user answers.
- Proposed assumptions, including positioning or capabilities that remain unconfirmed.
- Audience, difference, conversion, scope, and constraints.

Keep demo data separate from claims. Names, dates, amounts, and statuses can make a static
product demonstration believable. Keep that scenario consistent across its views. They do
not establish customer adoption, measured results, certification, pricing, or implementation
promises. Omit unavailable proof. Mark proposed capabilities as assumptions rather than
quietly presenting them as confirmed behavior. Apply [copy.md](copy.md) before writing copy.

## Rendered reference shortlist

For a new landing page, use [libraries.md](libraries.md) to shortlist relevant Tailark blocks
and Axis or Notio where they fit. A few useful references are enough. Compare the actual
rendered preview with the buyer, promise, product demonstration, and requested tone in mind.
Do not select a family from its name or color alone.

Save the references you rely on to `.framio/pages/01-moodboard/`. For each, record a source
URL or registry ID, a rendered `previewFrame`, and a concrete borrowing note. Add an avoid
note where a tempting part conflicts with the brief. For example, borrow a ledger beside
the explanation because the buyer needs to inspect provenance, while avoiding invented
customer badges. Registry search and code inspection help discovery, but do not replace
viewing the rendered reference.

Use relevant Mobbin tools when available, or capture a public reference with
`framio screenshot --url <url> --into 01-moodboard`. Download expiring reference images
instead of hotlinking them. Add a source and note sidecar for each image. Open a readable
crop of the relevant section, then an overview for composition. Keep a small reference set
and stop collecting once it supports the next decision. If a preview cannot be captured,
record the limitation and use another rendered source instead of claiming visual review.

## Directions and the early checkpoint

Make a meaningful fragment before a complete page. For a landing page, this means the actual
hero copy, CTA, and product demonstration in their intended composition. Use reusable blocks
and static product content. Palette swatches can support the fragment; they are not the
design decision by themselves.

For a new direction, explore two or three materially different ways to explain the same
product within the user's constraints. Change the composition, density, emphasis, or product
story, as well as type or color where useful. Do not manufacture a choice by placing the
requested dark direction beside a light alternative unless the user is exploring that change.
Use `variationOf` for alternatives and review one fragment before creating the next.

Before expanding the landing page:

1. Run `framio inspect <page>/<frame>` for geometry and checks. Capture one or two relevant
   hero/product crops with `framio screenshot <page>/<frame> --layer "Content/Hero"` and open
   the returned `archivePath` PNGs.
2. Compare those actual crops with the saved rendered references. Explain what a buyer learns,
   which specific decision you borrowed, and what makes this composition fit the product.
3. Check copy grounding and demo consistency, then record a composition review tied to the
   screenshot's capture ID. Record defects and the resulting change, not a generic 'looks good'.
4. Show the directions and wait for the user's pick when a direction is still undecided.
   Record the selected frame, reference IDs, composition, why, and alternatives in evidence.

A technical pass only establishes technical findings. A composition pass needs visual
comparison and product reasoning. The user chooses a concrete fragment. If its structure
changes materially after that choice, review the changed fragment before expanding it.
Recording the chosen direction changes the review context. Capture the selected fragment
again and record current reviews after saving that choice, even if its source did not change.

## System and structure

Write the selected direction to `.framio/DESIGN.md` using [design-md.md](design-md.md).
Framio layers these tokens over `theme.css`; fonts and `type-*` styles load automatically.
Run `npx @google/design.md lint .framio/DESIGN.md` and fix invalid tokens and contrast findings.
`orphaned-tokens` warnings can be expected because shadcn controls consume those variables.
Keep a concise system frame for the typography, controls, status colors, and data views
actually used. Add other states when the design needs them, not a whole component inventory.

For a landing page, write the job of each section and map it to the selected reusable source.
Proof belongs beside the claim it supports. Include pricing or testimonials only when there
is grounded content for them. Do not append a fixed SaaS section sequence by habit.
For product flows, list the important screens and states first. Use simple wireframes when
the structure needs agreement before detail. Shared chrome belongs in `.framio/components/`.

## Screens and bounded review

Work on one frame or meaningful section at a time. Use theme tokens, one icon set, readable
type, clear state differences, and appropriate density. Keep the main action easy to identify.
Centered content or repeated cards are fine when they serve the job. Look for hierarchy that
has become flat, repeated containers that hide relationships, or visuals that fail to explain
the product. A decorative illustration cannot substitute for product proof.

After the current edit, run `framio inspect <page>/<frame>` and fix errors. Use
`framio screenshot <page>/<frame> --layer <path>` for one or two crops that answer the current
design question. Open their returned `archivePath` PNGs. A full-page image checks composition,
but small text may need a readable layer crop. Complete a frame with the full primary viewport
and the smallest requested viewport. With responsive `widths`, use the returned suffixed paths.

Use a focused review and a comparison revision for subjective polish. After changes, recheck
the affected crop; repeat a full capture if the composition changed. Fix known readability,
clipping, contrast, and content issues, but avoid recapturing unchanged sections or collecting
more references for a decision that is already settled. Record separate technical and
composition findings against real captures. Changes to the brief, references, direction,
source, theme, or assets may make earlier reviews stale. Recheck the affected evidence.

For a final page, inspect its overall sequence and visual rhythm after individual fragments
pass. Report the selected decisions, frames and widths reviewed, resolved findings, and any
remaining assumptions. Screenshot success, lint, and a review record are evidence of work,
not a guarantee that the user will prefer the design.
