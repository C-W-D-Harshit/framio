# Design skills

Design skills are loaded on demand, not bundled with Framio. Most come from the ui-skills registry:

```sh
npx ui-skills get <slug>          # print a skill; read it fully and follow it
npx ui-skills list --category motion   # discover more (categories: npx ui-skills categories)
```

If a skill with the same name is already installed for your agent (for example in
`.claude/skills/` or `~/.claude/skills/`), use the installed copy instead. Load each skill once per
session, before the phase that needs it.

## Required for any design work

| Slug | Why |
| --- | --- |
| `emil-design-eng` | Design-engineering taste: component polish, details, motion judgment. |
| `transitions-dev` | Motion tokens: durations, easing, enter/exit patterns. |
| `better-ui` | Polish rules: shadows, borders, radii, optical alignment, hover states. |
| `shadcn` | Correct shadcn/ui usage and composition. |
| `ui-ux-pro-max` | UX rules (accessibility, touch targets, forms, navigation) and style, palette, and font guidance. Its data-search scripts are not available through `get`; use the guidance in the markdown. |

## Add by job

| Job | Load |
| --- | --- |
| Landing page, marketing site, portfolio, launch page | `frontend-design`, `gpt-tasteskill`, `landing-page`; `pricing-page` when there's pricing |
| Product UI: web app, dashboard, SaaS, admin, internal tool | `interface-design`, `apple-design`. Spend the effort on UX: flows, states, density, forms, feedback. |
| Exploring directions or variants (phase 2, "show me options") | `prototype` |
| Redesign of an existing product | `create-design-md` (phase 3) |
| Critique and polish (phase 6) | `impeccable`, `critique`; `improve-animations` when there is motion to review |
| Motion-heavy work (animated hero, onboarding) | `apple-design`, `review-animations` |
| Creating or revising illustrations | `illustration-style` from `owl-listener/designer-skills`, required before illustration work; see below |

## Illustration style (required for illustrations)

Use [`illustration-style`](https://www.skills.sh/owl-listener/designer-skills/illustration-style)
from `owl-listener/designer-skills`. Load it once per session before creating or revising any
illustration, including hero, onboarding, empty-state, and error-state illustrations:

```sh
npx -y skills use owl-listener/designer-skills@illustration-style
```

This prints the skill's instructions without installing it. Read them fully and follow them.
If this skill is already installed for your agent, read that copy instead. This skill comes from
skills.sh; do not try to fetch it with `npx ui-skills get`.

Define the illustration guide before making assets. While exploring directions, include a
provisional guide in each style tile; after the user chooses, record the chosen guide in
DESIGN.md's `## Imagery` section. Cover
geometry, dimensionality, detail, line style, a subset of the product palette, shadows and
gradients, dark-mode treatment, and sizes and usage by context. Define character rules when
characters are used. Apply this guide to image-generation prompts and drawn illustrations.
Check each result at its intended display size and keep essential information in text too.

## Precedence

Framio's rules override any skill: frames are static React + Tailwind mockups inside `.framio`,
styled from DESIGN.md. Ignore instructions to scaffold apps, write HTML files, add routing, wire
real data, or install packages anywhere but `.framio` (use `framio install` / `framio add`).
Skills that describe animation still apply: design the resting and key states, and pick motion
tokens so the implementation can follow them later.
