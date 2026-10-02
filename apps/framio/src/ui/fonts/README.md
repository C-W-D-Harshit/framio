Geist and Geist Mono variable WOFF2 files come from the `geist@1.7.0` npm package, published by Vercel. The accompanying SIL Open Font License is included in the UI build as `/font-license.txt`.

The UI build extracts font data URLs emitted by the Tailwind plugin into files named by their content hash. The canvas loads these fonts locally with `font-display: optional` to avoid a late font swap moving its controls.
