---
layout: ../../layouts/Docs.astro
title: "Framio quick start: design with Claude Code and Codex"
description: "Install Framio, connect Claude Code or Codex, and review React and Tailwind designs on a local canvas. Learn commands, comments, and design comparison."
---

Framio is a free, open-source design canvas for coding agents. Claude Code, Codex, or another agent writes React and Tailwind screens into your repository. Framio renders those files on a live canvas, where you can select elements, review mobile and desktop layouts, and pin feedback before implementing a design in your app.

## Install

Framio runs on macOS on Apple Silicon and Linux on x64 or arm64. Intel Macs and Windows are not supported. The installer downloads a binary from [Framio's GitHub releases](https://github.com/C-W-D-Harshit/framio/releases). No account or subscription is required.

Run this command in your terminal:

```sh
curl -fsSL https://framio.design/install.sh | sh
```

You can [read the installer](https://framio.design/install.sh) before running it. Adding registry components with `framio add` also requires Node.js.

## Quick start

Open your project's directory and run:

```sh
framio init
framio start
```

`framio init` creates `.framio/` with React, Tailwind, shadcn/ui, and the agent skill. `framio start` runs the local canvas and opens it in your browser. Keep that terminal running. Press Ctrl+C when you want to stop it.

To run the canvas in the background instead:

```sh
framio start --background
framio status
framio stop
```

## Use Framio with Claude Code or Codex

`framio init` installs the design skill into `.claude/skills` for Claude Code and `.agents/skills` for Codex. An agent that reads either skill directory can follow the same workflow. Open or restart your coding-agent session after initializing the project so it can discover the installed skill.

Ask your agent:

> Use Framio to design the onboarding for my invoicing app. Show desktop and mobile layouts. Ask me about the product before choosing a direction.

The agent gathers context, proposes visual directions, and creates each screen as a `.tsx` file. It screenshots and reviews the frame before continuing. Review the designs on the canvas, then ask for changes using selections or comments.

Framio provides the canvas and design workflow. You still use your own coding agent and its model provider. Framio does not include a model subscription.

## Where designs live

Framio keeps design files in your repository. It does not implement them in your application automatically.

| Path                               | Purpose                                             |
| ---------------------------------- | --------------------------------------------------- |
| `.framio/BRIEF.md`                 | Product context, users, and the scope of the design |
| `.framio/DESIGN.md`                | Shared colors, typography, and radii                |
| `.framio/pages/<page>/<frame>.tsx` | React and Tailwind design frames                    |
| `.framio/components/`              | Shared design components                            |
| `.framio/assets/`                  | Screenshots, images, and other design assets        |
| `.framio/comments.json`            | Pinned feedback and agent replies                   |
| `.framio/.state/selection.json`    | The selected frame, viewport, and element context   |

Commit the design files when you want to share or review them in a pull request. Use your repository's normal review process for changes an agent makes.

## DESIGN.md

Edit `.framio/DESIGN.md` to update the design system across frames. Its front matter defines tokens, and the canvas restyles designs when you save it.

```yaml
---
colors:
  primary: "#0C64FF"
typography:
  body-md:
    fontFamily: Geist
    fontSize: 15px
rounded:
  lg: 14px
---
```

Frames use ordinary React and Tailwind. The bundled shadcn/ui components pick up tokens such as `primary`, `background`, and `muted`. Framio follows [Google's DESIGN.md format](https://github.com/google-labs-code/design.md).

## Comments and selections

Click a frame or a named layer to show your agent what you mean. Selection context includes the viewport width, so feedback can target the mobile layout specifically.

Press **C** or choose Comment, then click a frame to pin feedback. Enter saves the comment; Escape cancels it. Use the comments panel to reply, resolve, or reopen a thread.

Ask your agent:

> Address the open Framio comments. Reply in each thread, verify the changed design, and resolve it when the fix is complete.

Comments and replies live in `.framio/comments.json`. The agent edits the design files, and the canvas updates live.

## Responsive frames

A frame can render at several widths without duplicating its component:

```tsx
export const meta = {
  name: "Invoices",
  widths: [1440, 768, 390],
  height: 900,
};
```

Framio shows the viewports side by side. Each width can be selected individually. To screenshot only the mobile viewport:

```sh
framio screenshot 11-invoices/list --width 390
```

## Compare a design with your app

When you approve a design, ask your agent to implement it in your real app. Run your application, then compare it with the matching frame:

```sh
framio screenshot --url http://localhost:3000/invoices --compare 11-invoices/list --width 390
```

Replace the URL and frame path with your own. Framio captures the running page and places it next to the design at the same width. It saves the comparison under `.framio/.state/screenshots/urls/`. Review desktop and mobile separately, and ask the agent to iterate on visible differences.

## Commands

| Command                            | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `framio init`                      | Initialize the design project and install agent skills |
| `framio start`                     | Run the canvas in the foreground                       |
| `framio start --background`        | Run the canvas in the background                       |
| `framio start --no-open`           | Run the canvas without opening a browser               |
| `framio status`                    | Show the current project's server status               |
| `framio list`                      | List running Framio servers                            |
| `framio stop`                      | Stop this project's canvas                             |
| `framio stop --all`                | Stop every running Framio canvas                       |
| `framio screenshot <page>/<frame>` | Capture a design frame                                 |
| `framio inspect <page>/<frame>`    | Inspect named layers, geometry, and design checks      |
| `framio add <component>`           | Add a component from a shadcn registry                 |
| `framio install <package>`         | Add an npm package to the design project               |

## Support and source

Framio is created by [Harshit](https://github.com/C-W-D-Harshit) and released under the [MIT license](https://github.com/C-W-D-Harshit/framio/blob/main/LICENSE). The [source repository](https://github.com/C-W-D-Harshit/framio) includes the CLI, canvas, and contribution guidelines.

Report bugs in [GitHub Issues](https://github.com/C-W-D-Harshit/framio/issues). For a security issue, follow the [private reporting instructions](https://github.com/C-W-D-Harshit/framio/blob/main/SECURITY.md).
