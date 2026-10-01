# Framio

A design canvas for coding agents. Designs are React + Tailwind files in `.framio/`; your agent
writes them, Framio shows them live on an infinite canvas.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/C-W-D-Harshit/framio/main/install.sh | sh
```

Then in any project:

```sh
framio init     # creates .framio/ (shadcn/ui, theme, agent skill) and installs its packages
framio start    # runs the canvas and opens it; Ctrl+C stops it
```

Framio is a single binary. It bundles Bun for installs and builds, and downloads its own
headless Chromium for screenshots. Node.js is needed for `framio add` and the agent's
`npx ui-skills` commands. The canvas, package installs, and screenshots work without Node.

## Commands

| Command | |
| --- | --- |
| `framio init` | Create `.framio/` in the current directory |
| `framio start [--no-open]` | Run the canvas in the foreground (default command); Ctrl+C stops it |
| `framio start --background` | Explicitly run the canvas in the background |
| `framio list` / `stop --all` | List or stop servers across projects |
| `framio stop` / `status` / `open` | Stop, inspect, or open an existing server |
| `framio screenshot <frame>...` | Render frames to PNG (`--page <page>` for a whole page, `--all`, `--scale=2`) |
| `framio install <package>...` | Add npm packages for frames to use |
| `framio add <registry-item>... [--overwrite]` | Add shadcn registry components, keeping existing files by default |

Screenshot commands reuse an existing server. If none is running, they start a temporary
server and stop it afterward, including when rendering fails. `framio open` requires a
running server. Background servers stay alive until stopped.

## Design with an agent

`framio init` includes shadcn/ui and writes a Framio skill plus its references into
`.claude/skills/framio/` and `.agents/skills/framio/`. Ask your agent to use it:

> Use Framio to design the onboarding for my invoicing app.

For a new product, the agent asks up to five brief questions, researches references, and shows
two or three visual directions for you to choose from. It then builds the design system,
flows, screens, and their states, and reviews screenshots. Smaller changes use the relevant
parts of that process.

The agent finishes one frame at a time: create, screenshot, inspect, fix every visible issue,
and repeat before starting the next frame. External skills load when their phase needs them,
after the brief and research. Mobile screens show the app's content in a plain frame, without
phone hardware or operating-system status bars.

The skill loads design guidance through `npx ui-skills get <slug>`, starting with
`emil-design-eng`, `transitions-dev`, `better-ui`, `shadcn`, and `ui-ux-pro-max`. It adds skills
for the job, uses Mobbin when available, and recommends image generation for product
illustrations and website imagery. These tools and skills are not bundled with Framio.
Illustration work also requires
[`illustration-style`](https://www.skills.sh/owl-listener/designer-skills/illustration-style),
loaded through `npx skills use owl-listener/designer-skills@illustration-style`. The agent defines
the illustration style before making assets and records the chosen guide in DESIGN.md.

For landing pages, the agent considers StyleUI's Axis and Notio templates when they fit the
brief, then customizes them to the product and DESIGN.md. For dashboards, it loads
`better-ui` and `kpi-dashboard-design` through `npx skills use` before designing:

```sh
npx -y skills use jakubkrehel/skills@better-ui
npx -y skills use wshobson/agents@kpi-dashboard-design
```

The files keep the reasoning alongside the designs:

- `.framio/BRIEF.md` describes the product, users, jobs, and scope.
- `.framio/DESIGN.md` records design tokens and the chosen direction in
  [Google's DESIGN.md format](https://github.com/google-labs-code/design.md).
- `.framio/pages/` holds moodboards, directions, the design system, and screen flows.
- `.framio/assets/` holds images used in mockups, served at `/assets/<filename>`.

## Design tokens

Framio layers DESIGN.md tokens over `theme.css` on every save. Color tokens generate Tailwind
colors, typography tokens generate `type-<name>` utilities, and `rounded` tokens set radii.
Use shadcn color names such as `primary`, `background`, and `muted` to restyle the bundled
components. Fonts load from Google Fonts. Spacing and component descriptions guide the agent;
Framio does not convert them into CSS.

```yaml
---
name: My product
colors:
  primary: "#B8422E"
  primary-foreground: "#FFFFFF"
  primary-dark: "#E0694F"
typography:
  body-md:
    fontFamily: Public Sans
    fontSize: 15px
    fontWeight: 400
rounded:
  lg: 14px
---
```

`primary-dark` applies inside `.dark` frames. See the installed skill's
`references/design-md.md` for a full template. A malformed DESIGN.md reports an error in
`.framio/.state/errors.json` while Framio continues using the base theme.

## Moodboards and components

Put PNG, JPEG, WebP, GIF, or SVG files in a page folder to show them as image frames. Add an
optional sidecar named `<image-filename>.json` for its label, caption, reference link, or display
width:

```json
{ "name": "Invoice editor reference", "width": 720, "note": "Borrow the preview beside the form.", "source": "https://example.com" }
```

Images retain their aspect ratio. Without a width override, images at least 2400px wide display
at half their natural width. Pages with more than three independent frames use a grid.
`framio screenshot` renders image frames to PNG too, including `--scale=2`; page screenshots
include their captions.

Add registry components or icon packages from the project root:

```sh
framio add @react-bits/ShinyText-TS-TW
framio add @aceternity/spotlight
framio add @kokonutui/shimmer-text
framio add @rareui/LiquidMetal
framio add https://styleui.dev/r/axis.json   # optional landing-page template
framio add https://styleui.dev/r/notio.json  # alternative landing-page template
framio install @tabler/icons-react
```

`framio add` runs shadcn inside `.framio/` and uses Framio's bundled Bun to install dependencies.
Existing component files stay in place unless you pass `--overwrite`. Pick one icon library
and record library choices in DESIGN.md.

## Development

```sh
bun install
bun run build:ui         # builds the canvas UI + frame runtime, regenerates src/generated/assets.js
bun src/cli.ts <command> # run the CLI from source
bun run dev:ui           # rebuild UI on change (restart `framio start` to pick up new UI builds)
bun run typecheck
bun run test
bun run build:binary     # dist/bin/framio-<os>-<arch> and .tar.gz for this platform
```

Layout:

- `src/cli.ts`, `src/commands/`: CLI
- `src/server/`: canvas server (Bun.build bundling, Tailwind, file watching, screenshots)
- `src/runtime/`: script injected into every frame iframe (selection, sizing, input forwarding)
- `src/ui/`: the canvas (React + React Flow)
- `src/scaffold/`: what `framio init` writes into `.framio/`, including the agent skill

## Releasing

Push a tag; GitHub Actions builds macOS (arm64, x64) and Linux (x64, arm64) binaries and
attaches them to a release that `install.sh` downloads from.

```sh
git tag v0.1.0 && git push origin v0.1.0
```
