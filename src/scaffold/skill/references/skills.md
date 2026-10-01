# Design skills

External design skills are loaded on demand. The required unslop rules for UI copy are included
in `references/copy.md`; read them before first writing copy, then apply them to every component
with text. Other skills mostly come from the ui-skills registry:

```sh
npx ui-skills get <slug>          # print a skill; read it fully and follow it
npx ui-skills list --category motion   # discover more (categories: npx ui-skills categories)
```

If a skill with the same name is already installed for your agent (for example in
`.claude/skills/` or `~/.claude/skills/`), use the installed copy instead. Load each skill once per
session, before the phase that needs it.

## When to load

- **Brief and research (phases 0–1):** no external design skills. Understand the product and
  gather references first. Read existing BRIEF.md and DESIGN.md where available.
- **First designed frame (phase 2, or phase 5 for an existing project):** load the five required
  skills below and the landing-page or product-UI skills for the frame you are about to make.
- **Specialized work:** load a skill immediately before that work. For example, load
  `pricing-page` before a pricing frame, `create-design-md` before extracting an existing design
  system, and `illustration-style` before defining or creating illustrations.
- **Formal critique and motion polish:** load those skills when that review begins, after
  frames exist. Do not fetch them during the brief or initial research.

The routing table describes which skills apply, not a list to fetch at the start of a task.
Keep the required skills for design work; defer their loading until design work actually starts.

## Required for any design work

| Slug | Why |
| --- | --- |
| `emil-design-eng` | Design-engineering taste: component polish, details, motion judgment. |
| `transitions-dev` | Motion tokens: durations, easing, enter/exit patterns. |
| `better-ui` | Polish rules: shadows, borders, radii, optical alignment, hover states. For dashboards, load through `npx skills use` as specified below. |
| `shadcn` | Correct shadcn/ui usage and composition. |
| `ui-ux-pro-max` | UX rules (accessibility, touch targets, forms, navigation) and style, palette, and font guidance. Its data-search scripts are not available through `get`; use the guidance in the markdown. |

## Add by job

| Job | Load |
| --- | --- |
| Landing page, marketing site, portfolio, launch page | `frontend-design`, `gpt-tasteskill`, `landing-page`; `pricing-page` when there's pricing. Use Tailark free components as required by `references/libraries.md`; consider Axis or Notio as starting templates when they fit the brief. |
| Product UI: web app, SaaS, admin, internal tool | `interface-design`, `apple-design`. Spend the effort on UX: flows, states, density, forms, feedback. |
| Dashboard or KPI/analytics screen | Product-UI skills plus `better-ui` and `kpi-dashboard-design` through `npx skills use`; see the dashboard commands below. |
| Exploring directions or variants (phase 2, "show me options") | `prototype`; follow Framio's one-frame review loop even if the skill suggests building variants together |
| Redesign of an existing product | `create-design-md` (phase 3) |
| Critique and polish (phase 6) | `impeccable`, `critique`; `improve-animations` when there is motion to review |
| Motion-heavy work (animated hero, onboarding) | `apple-design`, `review-animations` |
| Creating or revising illustrations | `illustration-style` from `owl-listener/designer-skills`, required before illustration work; see below |

## Dashboard skills (required for dashboards)

Before designing the first dashboard frame, load both skills through `npx skills use`:

```sh
npx -y skills use jakubkrehel/skills@better-ui
npx -y skills use wshobson/agents@kpi-dashboard-design
```

Read the printed instructions fully and apply them. These commands do not install skills.
For dashboards, this replaces fetching `better-ui` through `npx ui-skills get`; do not load
it twice. Use an already-loaded or installed copy when available. Keep the other required
and product-UI skills. Load these after the brief and research, immediately before dashboard
design, rather than at the start of the task.

Apply the guidance to metric selection, KPI hierarchy, comparisons and time ranges, chart
choices, density, and empty/loading/error states. Use realistic static data in the mockups,
and follow Framio's one-frame screenshot-and-fix loop.

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

When building the real app, follow `references/handoff.md` and the app's own conventions.
During design work, Framio's rules override any skill: frames are static React + Tailwind mockups inside `.framio`,
styled from DESIGN.md. Ignore instructions to scaffold apps, write HTML files, add routing, wire
real data, or install packages anywhere but `.framio` (use `framio install` / `framio add`).
Skills that describe animation still apply: design the resting and key states, and pick motion
tokens so the implementation can follow them later.
Framio's one-frame review loop and plain mobile frames also override conflicting skill advice.
Do not batch frame creation or add phone hardware and OS chrome by default.
