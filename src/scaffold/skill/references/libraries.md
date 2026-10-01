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

## Landing-page templates

When asked for a landing page, consider these StyleUI templates before building from scratch.
Use one when its structure fits the brief and chosen direction; a template is optional, not a
reason to change the product or force the same layout on every page.

| Template | Registry |
| --- | --- |
| Axis | `https://styleui.dev/r/axis.json` |
| Notio | `https://styleui.dev/r/notio.json` |

Inspect the registry's code before importing. Add only the template you intend to use, when
landing-page design begins. From the project root, prefer Framio's wrapper, which keeps
existing component files by default:

```sh
framio add https://styleui.dev/r/axis.json
# Or, when Notio fits better:
framio add https://styleui.dev/r/notio.json
```

The direct shadcn commands are also available. Run them inside `.framio/`, where dependencies
and registry files belong, and preserve existing customized components:

```sh
cd .framio
bunx --bun shadcn@latest add https://styleui.dev/r/axis.json
# Or:
bunx --bun shadcn@latest add https://styleui.dev/r/notio.json
```

Adapt the imported sections into static React frame components in `pages/`; do not create an
application or wire routes and backend services. Customize the hierarchy, sections, copy,
imagery, typography, colors, spacing, and responsive layout to the brief and DESIGN.md.
Replace placeholder content and adapt framework-specific imports to the Framio environment.
These registries include Next.js `app/` pages, layouts, theme providers, and `public/` assets.
Reuse their section components in a frame instead of treating the generated `app/` as an entry
point. Replace Next.js image/link/navigation imports with suitable React equivalents, adapt
theme providers and CSS to DESIGN.md, and copy needed `public/` assets into `.framio/assets/`
with references changed to `/assets/...`. Check that every image loads in the frame.
Finish the screenshot-and-fix loop for one frame before making another. Record the selected
template and meaningful adaptations in DESIGN.md's `## Libraries` section.

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
- **Landing pages:** consider Axis or Notio when suitable; Aceternity for the hero and big sections, plus one or two React Bits or
  RareUI moments. Restraint: one showpiece per screen, everything else calm.
- **Product UI:** shadcn first. Animated components only where delight helps (onboarding, empty
  states, success moments), never in dense working screens.
- Read a component's code before using it, and restyle it with DESIGN.md tokens so it belongs.
- Animated components render one moment in screenshots. Pick a resting state that reads well.
