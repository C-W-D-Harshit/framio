# Framio

A design canvas for coding agents. Designs are React + Tailwind files in `.framio/`; your agent
writes them, Framio shows them live on an infinite canvas.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/harshit-ybm/framio/main/install.sh | sh
```

Then in any project:

```sh
framio init     # creates .framio/ (shadcn/ui, theme, agent skill) and installs its packages
framio start    # starts the canvas in the background and opens it
```

Framio is a single binary. It does not need Node, Bun, npm, or Chrome on the machine: it bundles
Bun for installs and builds, and downloads its own headless Chromium for screenshots.

## Commands

| Command | |
| --- | --- |
| `framio init` | Create `.framio/` in the current directory |
| `framio start [--no-open]` | Start the canvas server in the background (default command) |
| `framio stop` / `status` / `open` | Manage the background server |
| `framio screenshot <frame>...` | Render frames to PNG (`--page <page>` for a whole page, `--all`, `--scale=2`) |
| `framio install <package>...` | Add npm packages for frames to use |

## Development

```sh
bun install
bun run build:ui         # builds the canvas UI + frame runtime, regenerates src/generated/assets.js
bun src/cli.ts <command> # run the CLI from source
bun run dev:ui           # rebuild UI on change (restart `framio start` to pick up new UI builds)
bun run typecheck
bun run build:binary     # dist/bin/framio-<os>-<arch> and .tar.gz for this platform
```

Layout:

- `src/cli.ts`, `src/commands/`: CLI
- `src/server/`: background server (Bun.build bundling, Tailwind, file watching, screenshots)
- `src/runtime/`: script injected into every frame iframe (selection, sizing, input forwarding)
- `src/ui/`: the canvas (React + React Flow)
- `src/scaffold/`: what `framio init` writes into `.framio/`, including the agent skill

## Releasing

Push a tag; GitHub Actions builds macOS (arm64, x64) and Linux (x64, arm64) binaries and
attaches them to a release that `install.sh` downloads from.

```sh
git tag v0.1.0 && git push origin v0.1.0
```
