---
name: framio
description: Design and review UI in Framio's .framio canvas. Use for screens, flows, landing pages, frames, variations, and changes to selected canvas elements.
---

# Framio Alpha

Framio is a local canvas for React + Tailwind designs, currently in alpha. A frame is a file at
`.framio/pages/<page>/<frame>.tsx`, with realistic static content and a default React export.
Frames have no data fetching, backend logic, or Effect imports.

```tsx
import { Button } from "@/components/ui/button";

export const meta = {
  name: "Welcome",
  width: 1440,
  height: 900,
  widths: [1440, 390],
};

export default function Frame() {
  return (
    <main data-layer="Content" className="min-h-screen bg-background text-foreground">
      <section data-layer="Hero"><h1 className="type-display">Your invoices</h1><Button>Create invoice</Button></section>
    </main>
  );
}
```

| `meta` field | Meaning |
| --- | --- |
| `name` | Canvas display name |
| `width`, `height` | Base dimensions; defaults are 1440 × 900; `widths[0]` overrides `width` |
| `widths` | Optional unique positive integer viewport widths |
| `heights` | Optional positive integer heights, one per `widths` entry |
| `variationOf` | Original frame slug for an alternative, typically `<frame>--<idea>.tsx` |
| `theme` | Optional `"light"` or `"dark"` |

With `widths`, desktop widths of 1024 or more use `meta.height`, tablet widths of 600 to 1023 use 1024, and mobile widths use 844, unless `heights` overrides them. Without `widths`, `meta.height` applies. Frames grow with content. Responsive screenshot names are `<slug>@<width>.png`.

`data-layer` names identify sections, cards, and rows. Paths follow named ancestors, such as
`Content/Hero`; repeated names have indexes, such as `Transaction Row[2]`. `/`, `[` and `]` are reserved for path syntax.

## Project files

Paths below are inside `.framio/`, except the installed agent skills.

| Path | Contents |
| --- | --- |
| `BRIEF.md` | Product context, audience, facts, and constraints |
| `DESIGN.md` | Design tokens, fonts, and design intent, applied on save |
| `theme.css` | Base Tailwind theme beneath DESIGN.md tokens |
| `components/ui/` | Included UI components, imported through `@/components/ui/<name>` |
| `components/` | Shared product chrome and reusable design components |
| `hooks/`, `lib/utils.ts` | Shared hooks and the `cn` class-name helper |
| `assets/` | Images and other assets served at `/assets/<name>` |
| `pages/` | Page folders containing React frames and moodboard images |
| `comments.json` | Live user feedback, anchors, replies, and resolution status |
| `evidence.json` | Optional brief, direction, and screenshot review record, shown in the Evidence panel |
| `.state/selection.json` | Selected frame, viewport width, element, and layer; the target of "this" or "selected" |
| `.state/errors.json` | Current build and file diagnostics |
| `canvas.json`, `.state/` | Framio-managed canvas positions and runtime state |
| `.claude/skills/framio/`, `.agents/skills/framio/` | Identical agent skill copies in the project root |

Images in a page folder become moodboard frames. An optional `<image>.json` sidecar has
`name`, `width`, `note`, `source`, and `variationOf` fields. `pages/00-example` is a removable sample.

## Commands

| Command | Capability and output |
| --- | --- |
| `framio init` | Creates `.framio` and both agent skill copies; installs packages and screenshot browser. `--skip-install` creates files only. Existing canvases are protected from overwrite. |
| `framio start` | Runs the canvas and file watcher, prints URLs, and opens a browser. `--background` detaches; `--no-open` skips browser opening; `--host` sets the listen address. |
| `framio stop` | Stops this project's server; `--all` stops all project servers. Reports stopped servers. |
| `framio list` | Lists running canvases with project, PID, and URL; redirected output is tab-separated. |
| `framio status` | Reports this project's running server or that it is stopped. |
| `framio open` | Opens an already running canvas and prints its URLs. |
| `framio install <package>` | Adds design packages to `.framio`; no package argument installs existing dependencies. Reports package installation status. |
| `framio add <registry-item>` | Adds shadcn registry components and dependencies. `--overwrite` replaces existing component files. Reports component installation status. |
| `framio evidence` | Returns JSON with evidence, revision, context revision, captures, and computed review status. `--write <file> --expect <revision>` validates and replaces the record, then prints the saved path. |
| `framio inspect <page>/<frame>` | Returns JSON geometry, styles, layers, and automatic checks. `--width` selects a viewport; `--layer` scopes inspection. |
| `framio screenshot [<page>/<frame> ...]` | Captures frames with managed Chromium. Receipts include paths, dimensions, viewport, revision, and generation. Frame and layer captures return `captureId` and `archivePath`. |

Screenshot options: repeated `--layer <path>` captures named layers; `--page <page>` captures
canvas arrangement and notes; `--all` captures all frames. `--width` selects viewport width,
`--height` sets initial viewport height, and `--scale` sets pixel density. `--url <url>` captures
a website; `--compare <page>/<frame>` creates a labeled design/website comparison;
`--into <page>` adds the website capture to a moodboard with a source sidecar.

## Components and packages

`components/ui/` contains shadcn/Base UI components in the `base-vega` style, with Lucide icons.
Components restyle through DESIGN.md tokens. Names below are exports, grouped by purpose.

| Group | Component exports and uses |
| --- | --- |
| Actions | `Button`: actions; `ButtonGroup`: related actions; `Toggle`, `ToggleGroup`: pressed choices |
| Text inputs | `Input`: single-line text; `Textarea`: multiline text; `InputGroup`: inputs with addons; `InputOTP`: segmented codes |
| Form structure | `Field`: labels, help, errors, and groups; `Label`: control labels |
| Choices | `Checkbox`: independent choices; `RadioGroup`: one choice; `Switch`: on/off settings; `Slider`: numeric ranges |
| Selection | `Select`: styled options; `NativeSelect`: native options; `Combobox`: searchable options and chips; `Calendar`: dates |
| Dialogs | `Dialog`: modal content; `AlertDialog`: confirmation; `Sheet`: side panels; `Drawer`: draggable panels |
| Overlays | `Popover`: anchored content; `HoverCard`: hover details; `Tooltip`: short hints |
| Menus | `DropdownMenu`: action menus; `ContextMenu`: context actions; `Menubar`: application menus; `Command`: searchable command lists |
| Navigation | `NavigationMenu`: site navigation; `Breadcrumb`: location trail; `Pagination`: page links; `Tabs`: switching views; `Sidebar`: shared application navigation |
| Data display | `Table`: tabular records; `ChartContainer`, `ChartTooltip`, `ChartLegend`: Recharts styling and annotations; `Avatar`: people and groups; `Badge`: labels; `Kbd`: shortcuts |
| Content | `Card`: grouped content; `Item`: list rows with media and actions; `Carousel`: sliding content |
| Feedback | `Alert`: notices; `Empty`: empty states; `Progress`: completion; `Skeleton`: loading placeholders; `Spinner`: pending activity; `Toaster`: Sonner notifications |
| Layout | `Accordion`: expandable sections; `Collapsible`: disclosure; `AspectRatio`: media proportions; `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`: split panes; `ScrollArea`: scroll regions; `Separator`: dividers; `DirectionProvider`: text direction |
| Messaging | `Message`, `MessageGroup`: author/content layout; `Bubble`, `BubbleGroup`: message bubbles and reactions; `Attachment`: media/files and actions; `Marker`: timeline or conversation separators |

| Installed package | Available for |
| --- | --- |
| `lucide-react`, `recharts` | Icons and charts |
| `date-fns`, `react-day-picker` | Date formatting and calendar interaction |
| `embla-carousel-react`, `react-resizable-panels` | Carousels and resizable layouts |
| `sonner`, `next-themes`, `tw-animate-css` | Toasts, theme switching, and animation utilities |
| `@base-ui/react`, `cmdk`, `input-otp` | Component primitives, command search, and code inputs |
| `class-variance-authority`, `clsx`, `tailwind-merge` | Component variants and class composition |
| `react`, `react-dom`, `tailwindcss` | Frame rendering and styling |

## System contracts

- `meta` is parsed statically and must be a plain object literal. `heights` requires `widths` with the same length.
- Framio owns `canvas.json` and `.state/`; hand edits can conflict with runtime state.
- `framio install` and `framio add` manage design dependencies. npm, pnpm, and yarn installs inside `.framio` bypass that integration.
- Token-covered colors belong to theme utilities such as `bg-primary` and `border-border`; hardcoded values bypass theming. Typography utilities include `type-display`.
- Comments are read live. Broken JSON or invalid fields appear in `.state/errors.json`. Saving feedback preserves every comment, reply, and unrelated field.
- Evidence is optional. Writes replace the whole document and require the current revision when it exists. `--expect new` applies only to a missing record. Unknown root and direction fields are preserved in replacements.
- Real applications never import `.framio` files at runtime. Frames and generated design projects have no Effect dependencies or imports.

## User preferences

The user wants confirmed facts separated from assumptions. Marketing proof has no invented
testimonials, customer names, counts, measured results, prices, certifications, offers, or capabilities.
Synthetic demo data inside a product view is fine. Existing work and every user comment are preserved.
UI copy has no em dashes. Titles use a middle dot, such as `my-app · Framio`.
Mobile frames show content in a plain rectangle, without phone hardware or OS chrome unless requested.
User instructions take priority. The model decides when a direction or other decision needs a user check-in.

## References

- [DESIGN.md](references/design-md.md): token mapping, font loading, shadcn variables, validator, and a token document example.
- [Evidence](references/evidence.md): optional record schema, capture fields, review status, and revision-safe write contract.
- [Comments](references/comments.md): feedback anchors, reply format, and resolution status.
- [Copy](references/copy.md): truthfulness, product tone, controls, and errors.
- [Handoff](references/handoff.md): website captures, design comparisons, and runtime boundaries.
