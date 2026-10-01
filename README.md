# Framio

A design canvas for coding agents.

Your agent writes designs as React + Tailwind files. Framio shows them live on an infinite
canvas, so you can watch the work and point at what to change.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/C-W-D-Harshit/framio/main/install.sh | sh
```

Works on macOS and Linux. `framio add` also needs Node.js.

## Quick start

In your project:

```sh
framio init    # set up .framio/ with shadcn/ui and the agent skill
framio start   # open the canvas (Ctrl+C to stop)
```

Then ask your agent:

> Use Framio to design the onboarding for my invoicing app.

The agent asks a few questions, shows you a couple of visual directions, and builds the screens
you pick. It screenshots each one and fixes what it sees before moving on.

## What goes where

Everything lives in `.framio/`:

| Path | What it is |
| --- | --- |
| `BRIEF.md` | The product, its users, and the scope |
| `DESIGN.md` | Colors, fonts, and radii (see below) |
| `pages/` | One folder per canvas page: moodboards, screens, flows |
| `assets/` | Images used in designs, served at `/assets/<file>` |

Drop images into a page folder to use them as a moodboard.

## Theming

Edit the front matter in `DESIGN.md` and the canvas updates on save:

```yaml
---
colors:
  primary: "#B8422E"
  primary-dark: "#E0694F"   # used in dark mode
typography:
  body-md:
    fontFamily: Public Sans
    fontSize: 15px
rounded:
  lg: 14px
---
```

Colors use shadcn names (`primary`, `background`, `muted`, ...), so the bundled components pick
them up. Fonts load from Google Fonts. The file follows
[Google's DESIGN.md format](https://github.com/google-labs-code/design.md).

## Commands

| Command | What it does |
| --- | --- |
| `framio init` | Set up `.framio/` in the current folder |
| `framio start` | Run the canvas (`--background` to detach, `--no-open` to skip the browser) |
| `framio stop` | Stop the canvas (`--all` for every project) |
| `framio status` / `list` | Show this server / all servers |
| `framio open` | Open a running canvas in the browser |
| `framio screenshot <frame>` | Save frames as PNG (`--page`, `--all`, `--scale=2`) |
| `framio add <component>` | Add a shadcn registry component |
| `framio install <package>` | Add an npm package for designs to use |

## Development

```sh
bun install
bun run build:ui          # build the canvas UI
bun src/cli.ts <command>  # run from source
bun run test
bun run build:binary      # build a binary for this platform
```

To release, push a tag. GitHub Actions builds the binaries that `install.sh` downloads.

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately, as described in
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
