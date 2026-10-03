# Handoff

`framio screenshot --url <app-url> --compare <page>/<frame>` produces design, website, and labeled
comparison PNGs. `--width` selects the comparison viewport; `--height` sets initial viewport height;
`--scale` changes pixel density. Managed Chromium captures the full website page.

`framio screenshot --url <app-url> --into <page>` adds the capture as a moodboard frame with its
URL and note in an editable sidecar. App implementations own their theme, components, routes,
and real data. The real app never imports `.framio` files at runtime.
