# Libraries

Choose per project, record the choices in a `## Libraries` section of DESIGN.md, and stay
consistent across frames.

## Icons: pick exactly one set

| Set | Pick when | Install and use |
| --- | --- | --- |
| Lucide (installed) | Default for product UI: neutral, consistent strokes | `import { Check } from "lucide-react"` |
| Tabler | Dense dashboards and admin tools that need a huge set (5,000+) | `framio install @tabler/icons-react`, then `import { IconHome } from "@tabler/icons-react"` |
| Hugeicons | Consumer products and marketing sites that want a friendlier, more distinctive look | `framio install @hugeicons/react @hugeicons/core-free-icons`, then `import { HugeiconsIcon } from "@hugeicons/react"; import { Home01Icon } from "@hugeicons/core-free-icons";` and `<HugeiconsIcon icon={Home01Icon} size={20} />` |

Never mix icon sets in one product, and never use emoji as icons.

## Components

**shadcn/ui** (Base UI) is already in `components/ui/` and is the base for every product. Restyle
it through DESIGN.md tokens rather than editing component files.

## Landing pages: Tailark required

Every landing page must use [Tailark's free components](https://github.com/tailark/blocks).
Avoid building landing-page components from scratch. Find suitable Tailark blocks, then adapt
and restyle their layout, content, imagery, and tokens for the product. If a needed piece is
missing, search other React + Tailwind libraries or registries before implementing it yourself.
Build a custom component only when no suitable reusable option exists or the user requests one.
Choose a complete Dusk page when it fits the brief, or compose individual Dusk, Mist, or Veil
blocks. Use only the free collection; the main Tailark site's premium illustrations and
pages are outside this workflow. Install selected items on demand, as with our existing
templates. Do not bundle the upstream library or install every block.

### Discover and install

The Base UI registry matches Framio's component base. New projects include this entry in
`.framio/components.json`. For older projects, merge it into `registries`, preserving other
entries:

```json
{
  "registries": {
    "@tailark-oss": "https://oss.tailark.com/r/{name}"
  }
}
```

Browse the [free registry index](https://oss.tailark.com/r/registry.json) or search and inspect
items inside `.framio/` before importing:

```sh
cd .framio
npx shadcn@latest search @tailark-oss -q hero
npx shadcn@latest view @tailark-oss/dusk-landing-1
```

From the project root, add only the selected page or blocks. Framio's wrapper preserves
existing component files by default:

```sh
framio add @tailark-oss/dusk-landing-1
# Or compose selected sections:
framio add @tailark-oss/dusk-hero-section-1 @tailark-oss/dusk-features-7
```

The direct equivalent runs inside `.framio/`:

```sh
npx shadcn@latest add @tailark-oss/dusk-landing-1
```

If discovery needs more context, inspect the source in `https://github.com/tailark/blocks`
with btca-local when available. Read the selected block's code and dependencies, including
any extra packages, theme tokens, and assets.

### Existing templates

Axis and Notio are encouraged when their structure fits the brief and direction. Use their
page composition and existing sections as a starting point, and incorporate selected Tailark
blocks where they serve the product. Restyle both together so the page feels consistent.
A complete Tailark page or a composition of Tailark blocks is also a valid starting point.

| Template | Registry |
| --- | --- |
| Axis | `https://styleui.dev/r/axis.json` |
| Notio | `https://styleui.dev/r/notio.json` |

Inspect the code, then import only the chosen template from the project root:

```sh
framio add https://styleui.dev/r/axis.json
# Or, when Notio fits better:
framio add https://styleui.dev/r/notio.json
```

### Adapt imports into Framio frames

Use the same workflow for Tailark and StyleUI. Adapt imported sections into static React
frame components in `pages/`; do not create an application or wire routes and backend services.
Customize the hierarchy, sections, copy, imagery, typography, colors, spacing, and responsive
layout to the brief and DESIGN.md. Preserve existing customized components during imports.

These imports can contain Next.js `app/` pages, layouts, theme providers, and references to
`public/` assets. Reuse their section components in a frame instead of treating generated
`app/` files as entry points. Replace Next.js image/link/navigation imports with suitable
React equivalents and adapt theme providers and CSS to DESIGN.md. Copy needed assets into
`.framio/assets/` with references changed to `/assets/...`; if the registry does not ship a
referenced asset, retrieve it from the free source or replace it with product-specific imagery.
Check that every image loads and all imported component paths resolve.

Finish the screenshot-and-fix loop for one frame before making another. Record the selected
Tailark items, any starting template, and meaningful adaptations in DESIGN.md's `## Libraries`
section. Preserve the upstream MIT copyright and license notice when copying Tailark source.

## Registry components

Showpiece and animated components come from shadcn registries. Browse, then add:

```sh
cd .framio && npx shadcn@latest search @aceternity -q hero   # browse a registry
npx shadcn@latest view @aceternity/hero-parallax              # read the code first
framio add @aceternity/hero-parallax                          # add it (keeps your existing files)
```

| Library | Best for | Add |
| --- | --- | --- |
| Aceternity UI | Landing pages: hero sections, backgrounds (beams, grids, spotlights), bento grids, feature sections, 3D cards. Has full blocks. | `framio add @aceternity/<name>` |
| React Bits | Animated text, backgrounds, cursors, interactive accents. Always use the `-TS-TW` variant. | `framio add @react-bits/<Name>-TS-TW` |
| Kokonut UI | Polished animated components and AI-product pieces (prompt inputs, loaders, cards). | `framio add @kokonutui/<name>` |
| RareUI | Unusual animated pieces (LiquidMetal, Book3D, GlassShimmerButton…). Accents only. | `framio add @rareui/<Name>` |

Rules:
- **Landing pages:** Tailark free components are required. Use Axis or Notio when their structure
  fits the brief; use Aceternity, React Bits, or RareUI for additional accents when useful.
  Restraint: one showpiece per screen, everything else calm.
- **Product UI:** shadcn first. Animated components only where delight helps (onboarding, empty
  states, success moments), never in dense working screens.
- Read a component's code before using it, and restyle it with DESIGN.md tokens so it belongs.
- Animated components render one moment in screenshots. Pick a resting state that reads well.
