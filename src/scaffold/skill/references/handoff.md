# Building the real app

Use this workflow when the user asks to implement, build, or ship a Framio design in their app.
Read the app's own instructions and inspect its theme, components, routes, and data conventions.

1. Port the chosen DESIGN.md tokens into the app's own theme. Use Tailwind v4 CSS, a v3 config,
   or the theme system already there. Include fonts, dark colors, spacing, and radii.
2. Move shared `.framio/components` into the app's component structure. Adapt imports and reuse
   existing app components where they fit. Never import from `.framio` at runtime.
3. Implement each screen in the app's routes. Replace mock data with typed props and real data.
   Follow the app's conventions for loading, errors, navigation, accessibility, and state.
4. Start the app and compare each screen at its design widths:

```sh
framio screenshot --url http://localhost:3000/invoices --compare 11-invoices/list --width 1440
framio screenshot --url http://localhost:3000/invoices --compare 11-invoices/list --width 390
```

Open the design, implementation, and labeled comparison PNGs. Fix spacing, typography, colors,
content, clipping, and responsive differences; compare again until they match. Check every
screen and its smallest width. Keep functional app requirements when they call for a deliberate
difference, and explain that difference to the user.

For a redesign, capture the current app during research:

```sh
framio screenshot --url http://localhost:3000/invoices --into 01-moodboard --width 1440
```

The PNG becomes a moodboard frame with its URL and a note in an editable sidecar. Add a short
note describing what to keep or change. Screenshots use managed Chromium and capture the full
page; use `--height` to set the initial viewport height and `--scale` for higher resolution.
