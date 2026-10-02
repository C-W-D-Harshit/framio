# Contributing

Thanks for helping out. Bug reports, fixes, and small features are all welcome. For anything
bigger, open an issue first so we can agree on the approach before you write the code.

## Setup

You need [Bun](https://bun.sh) 1.4.2 and Node.js 24 or newer.

```sh
git clone https://github.com/C-W-D-Harshit/framio.git
cd framio
bun install
bun run build:ui
```

Run the CLI from source in any test folder:

```sh
bun /path/to/framio/apps/framio/src/cli.ts init
bun /path/to/framio/apps/framio/src/cli.ts start
```

`bun run dev:ui` rebuilds the canvas UI as you edit. Restart `framio start` to load the new build.

## Before you open a PR

```sh
bun run typecheck
bun run test
```

CI runs both on every pull request.

## Where things are

| Path                                                  | What it is                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `apps/framio/src/cli.ts`, `apps/framio/src/commands/` | The CLI                                                       |
| `apps/framio/src/server/`                             | Canvas server: bundling, Tailwind, file watching, screenshots |
| `apps/framio/src/runtime/`                            | Script injected into every frame                              |
| `apps/framio/src/ui/`                                 | The canvas app (React + React Flow)                           |
| `apps/framio/src/scaffold/`                           | What `framio init` writes, including the agent skill          |
| `apps/framio/tests/`                                  | Bun tests                                                     |

The Astro landing app lives in `apps/landing`. Run `bun run dev:landing` from the
workspace root to start it.

## Pull requests

- Keep each PR to one change.
- Add or update tests when you change behavior.
- Update the README if you change a command or a user-facing file.

## Releases

Maintainers release by pushing a `v*` tag. GitHub Actions builds the binaries and creates the
release.
