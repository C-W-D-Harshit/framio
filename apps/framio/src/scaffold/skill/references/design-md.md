# DESIGN.md

`.framio/DESIGN.md` is the design system, in Google's open DESIGN.md format: YAML tokens in front
matter (exact values) plus markdown prose (why, and how to apply them). Framio reads the tokens
and applies them to every frame on save. Prose sections are for you and the user.

Validate with `npx @google/design.md lint .framio/DESIGN.md` (catches broken references and
contrast failures). `orphaned-tokens` warnings are expected: shadcn components use those colors.

## How Framio applies the tokens

| Token | Becomes | Use in frames |
| --- | --- | --- |
| `colors.<name>` | `--<name>` on `:root` and a Tailwind color | `bg-<name>`, `text-<name>`, `border-<name>` |
| `colors.<name>-dark` | `--<name>` inside `.dark` | frames with `theme: "dark"` |
| `typography.<name>` | a `type-<name>` utility (family, size, weight, line height, tracking) | `className="type-display"` |
| first `body*` typography | `font-sans` (the default font) | automatic |
| first `display*` / `h1*` / `heading*` / `title*` typography | `font-heading` | `font-heading` |
| `rounded.<name>` | `--radius-<name>` | `rounded-<name>` |
| `spacing`, `components` | not converted; guidance for you | follow them when building |

Fonts named in `typography` load from Google Fonts automatically with the weights you list.

**Name colors after shadcn's variables so every component restyles:** `background`, `foreground`,
`card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`,
`secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`,
`destructive`, `border`, `input`, `ring`, `chart-1`…`chart-5`, `sidebar`, `sidebar-foreground`,
`sidebar-primary`, `sidebar-accent`, `sidebar-border`. Add brand colors with your own names
(`brand`, `highlight`).

## Template

```md
---
name: Ledgerly
description: Invoicing for freelancers. Warm, editorial, calm.
colors:
  background: "#F7F5F2"
  foreground: "#1A1C1E"
  card: "#FFFFFF"
  card-foreground: "#1A1C1E"
  primary: "#B8422E"
  primary-foreground: "#FFFFFF"
  secondary: "#EFEAE3"
  secondary-foreground: "#1A1C1E"
  muted: "#EFEAE3"
  muted-foreground: "#6C7278"
  accent: "#EFEAE3"
  accent-foreground: "#1A1C1E"
  border: "#E4DFD8"
  input: "#E4DFD8"
  ring: "#B8422E"
  background-dark: "#141312"
  foreground-dark: "#F2EEE8"
  card-dark: "#1C1B19"
  primary-dark: "#E0694F"
  border-dark: "#2C2A27"
typography:
  display:
    fontFamily: Fraunces
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -0.02em
  heading:
    fontFamily: Fraunces
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
  body-md:
    fontFamily: Public Sans
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
  body-strong:
    fontFamily: Public Sans
    fontSize: 15px
    fontWeight: 600
  label:
    fontFamily: Public Sans
    fontSize: 12px
    fontWeight: 500
    letterSpacing: 0.04em
rounded:
  sm: 6px
  md: 10px
  lg: 14px
spacing:
  section: 96px
  card: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
---

## Overview
Warm, editorial, unhurried. Feels like good stationery, not a bank. Generous whitespace, one
accent color, serif headlines over a quiet sans body.

## Colors
- **Clay (primary #B8422E):** the only action color. One primary action per view.
- **Limestone (background #F7F5F2):** warmer than white; cards sit on it in pure white.

## Typography
Fraunces for display and section headings only; Public Sans for everything else.

## Layout
12-column grid, 1200px content width, 96px between landing sections, 24px card padding.

## Elevation & Depth
Flat. Cards use a 1px border, no shadow; only popovers and dialogs get a soft shadow.

## Shapes
10px radius on controls, 14px on cards; never fully rounded except avatars and badges.

## Components
Primary buttons: clay fill, white text. Tables: no zebra stripes, hairline row dividers.

## Imagery
Warm paper-texture illustrations with clay and ink accents, used in empty states and onboarding.

## Do's and Don'ts
- Do keep one accent color per screen.
- Don't use gradients, glows, or more than two font weights per screen.
```
