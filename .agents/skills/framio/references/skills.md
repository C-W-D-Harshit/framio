# Optional design resources

The Framio skill and process reference contain the essential truth, copy, composition,
reuse, and review rules. There is no mandatory external skill bundle. Read a resource only
when it can change the current decision, and keep the loaded context relevant to that work.

| Current problem | Useful resource |
| --- | --- |
| Unclear marketing promise or section job | `landing-page` or `frontend-design` |
| Product navigation, forms, states, or information density | `interface-design` |
| KPI selection or a chart that does not explain its comparison | `kpi-dashboard-design` |
| A specific control or Base UI composition question | `shadcn`, then its relevant component documentation |
| Optical alignment, depth, or radii need attention | `better-ui` or `emil-design-eng` |
| Actual motion needs a purpose, timing, or reduced-motion treatment | `transitions-dev` or `emil-design-eng` |
| Creating illustrations needs a consistent guide | `illustration-style` |
| A difficult visual review needs a second lens | `critique`, only if its returned guidance fits the task |

Use an installed copy when available. Otherwise inspect the full resource with
`npx ui-skills get <slug>` where that registry supports it. Do not pipe skills through `head`
or `tail` and claim they were fully read. If the returned material is unrelated or depends
on unavailable scripts, use a suitable resource instead and record the limitation. Do not
keep adding philosophy documents to compensate for missing rendered references.

Some resources use another registry:

```sh
npx -y skills use wshobson/agents@kpi-dashboard-design
npx -y skills use owl-listener/designer-skills@illustration-style
```

Load each selected resource once before using it. Say which current problem it addresses,
then apply it to the next decision. For illustrations, define geometry, detail, palette,
shadows, dark treatment, and intended size in DESIGN.md before creating assets.

Framio's frame format and project scope take precedence over external instructions to
scaffold an application, add routes, wire live data, or install outside `.framio`.
Use `framio install` and `framio add` for project dependencies. User instructions take priority.
Optional resources do not replace the early visual comparison or the factual copy review.
