# Canvas performance

Implemented against the performance audit of commit `1d003e36221c9bf3a7d57f8cd87409a6d0aa3bcf`. Measurements were taken locally on macOS Apple Silicon with Bun 1.4.2. Raw results are in [canvas-performance-results.json](canvas-performance-results.json).

## Results

| Observation                                                      | Audit                                               | Implementation                                        |
| ---------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| React Scan frame updates during a 100-frame zoom from 24% to 20% | 1,300, including offscreen frames                   | 4, all newly visible frames                           |
| Status API latency during eight uncached thumbnail captures      | 1,319 ms                                            | 2.7 ms                                                |
| Warm thumbnail requests                                          | Browser images revalidated against files            | 0.73 to 1.60 ms in the eight-request sample           |
| UI CSS before compression                                        | 274,064 bytes                                       | About 110 KB, fonts separate                          |
| Embedded UI and runtime HTTP compression                         | None                                                | Build-time gzip with encoding negotiation             |
| Steady live iframe admission                                     | Visibility and selection could activate many frames | At most 6, further limited by estimated device pixels |
| Live iframe plus thumbnail                                       | Both remained mounted                               | Thumbnail removed after the displayed iframe is ready |

The eight-capture sample used width 1441 and scale 0.5. It completed in 1,025.73 ms. These are individual local samples, not percentile claims. The React Scan comparison uses the same 100-frame fixture and identifies frame components by their frame props because production component names are minified.

The fully uncached 100-request batch at width 1442 and scale 0.5 completed in 7,763.19 ms. The audit batch took about 17.3 seconds at width 1440. The width differs by two pixels to bypass the preview cache, so treat this as a throughput sample rather than an exact benchmark ratio.

## Preview ownership and bounds

One scoped Effect controller reads the React Flow viewport and publishes only changed per-frame preview modes. Frame labels, pins and outlines use the shared CSS zoom variable, so a viewport transform does not require every frame to render in React.

Admission prioritizes a single selected viewport, then existing visible live frames, then proximity to the viewport center. Responsive variants count individually. Select-all and comment pins do not override the budget. A page with more than eight viewport nodes enters live mode at 28% zoom and leaves at 22%, avoiding repeated swaps near one threshold. A 96 CSS-pixel margin limits work outside the viewport.

The controller admits at most two new iframe loads or replacements at once and at most six live frame nodes. It also estimates full frame surface area at device pixel ratio, with a 12-million-pixel budget. One oversized frame may remain live so a selected design can still be used. These estimates limit admission; they are not measurements of Chromium's actual GPU allocations.

Navigation suppresses new loads and replacement admission. Existing replacements retain their slot until completion. Eviction clears readiness and releases preview resources. Ready live frames release their thumbnail. Image frames and TSX thumbnails use quantized scales of 1/16, 1/8, 1/4, 1/2 or 1 based on projected zoom and device pixel ratio, with hysteresis between tiers.

The client runs at most four preview fetches. Obsolete atom subscriptions cancel requests, and scoped object URLs are revoked when no longer retained for display. The server runs at most two background thumbnail captures, leaving capacity in the shared four-page capture pool for explicit screenshots and inspection. Its thumbnail cache holds at most 128 entries and 32 MiB of PNG bytes. Temporary capture files are removed before the response is returned, and the server scope removes its preview directory.

## Reload geometry and updates

Measured heights are saved by project, page, content and theme fingerprint, viewport width and height settings. Content hashes remain meaningful after a server restart, unlike ordinal build versions. Invalid or inaccessible storage is ignored. A warm reload starts with measured geometry, including the tested 844-to-949 pixel correction, before iframe documents or thumbnails finish loading.

Iframe and thumbnail height messages are batched into one update per animation frame. Old iframe versions cannot certify a new version's cached height. The first camera fit uses the available geometry. Later measurements do not repeatedly fit the camera. A cold frame can still resize when its actual content height becomes known.

Decoded snapshots reuse unchanged frame, page, position and comment references. Node reconciliation retains unchanged nodes, comments are grouped once, and variation edges use indexes. A central iframe-window registry validates message sources and routes layer reports into per-frame atoms. Frames without comment pins allocate no comment geometry observers.

## Captures and rebuilds

Captures acquire a generation lease under the project coordinator lock, then render outside it. The lease keeps frame JS, shared chunks, theme CSS and image-frame assets available until the capture ends. Release is scoped, including failure and interruption. At most eight leases may be held concurrently. Content-addressed image files are reused and removed when absent from current, retained and leased generations.

Comment-only updates reuse project discovery. Other scans reuse unchanged frame source and image bytes while refreshing directory listings and canvas metadata. Changed-file matching includes ancestor directory events and Windows path separators. Source/dependency edits still run a real Bun build. Bun does not expose a persistent incremental build context here, so this change does not claim one.

Tailwind reuses its compiler and scanner for an unchanged theme. Theme/package changes invalidate the session, and a fresh compiler after 32 builds bounds accumulated candidates. CSS versions advance only when output or errors actually change.

When a combined frame build fails, the bundler bisects failing groups. Healthy groups retain shared chunks instead of every healthy frame embedding a separate React runtime. Build concurrency remains capped at four. Integration coverage verifies that healthy dependency edits still publish while another entry is broken.

Thumbnail documents skip automatic layer reporting and status traffic. Live documents share one layer measurement between publication and status warnings, coalesce changes at 500 ms, and observe relevant attributes rather than every attribute mutation. Explicit inspection continues to measure current layout.

## Asset delivery

UI Tailwind discovery is scoped to the UI directory. UI JS, CSS, fonts and images use immutable caching when their names contain build hashes. HTML and the font license revalidate. The runtime URL includes a content hash and receives immutable caching only when that version matches. Gzip bytes are generated once during the build, embedded alongside the source bytes, and served with `Vary: Accept-Encoding`. Explicit `gzip;q=0` is honored.

Geist fonts are bundled locally under their SIL Open Font License. The build extracts font data URLs into independently cached WOFF2 files. `font-display: optional` avoids a late font swap moving canvas controls.

## Validation and reproduction

From `apps/framio`, run with Bun 1.4.2 on `PATH`:

```sh
bun run build:ui
bun run check
bun run build:binary
python scripts/smoke-binary.py dist/bin/framio-darwin-arm64
```

The tests cover lease interruption and concurrent publication, boot/replacement limits, high-DPR admission, geometry invalidation, select-all live bounds, restoration before frame loading, compressed asset negotiation, thumbnail scale and temporary-file cleanup, source reuse, incremental Tailwind discovery, and broken-entry isolation. Existing comments, layer selection, responsive group movement, screenshots, lifecycle and pinch tests remain required. The comments test waits for live readmission after camera navigation before inspecting iframe geometry.

Against a disposable running project, choose uncached widths or restart its server for cold results:

```sh
python scripts/benchmark-canvas.py http://127.0.0.1:4750 --page 100-frames --offset 90
python scripts/benchmark-canvas.py http://127.0.0.1:4750 --page 100-frames --count 100 --width 1442
npx -y react-doctor@latest src/ui --verbose --no-telemetry --no-supply-chain
```

React Scan was injected into the local production UI for measurement with `dangerouslyForceRunInProduction`, toolbar disabled, and an `onRender` callback recording components with `fiber.memoizedProps.data.frame`. It is diagnostic instrumentation and is not shipped in user designs or the production UI.

React Doctor reports no errors. Remaining warnings include existing large components, controlled React Flow synchronization and double buffering, deliberately same-origin design iframes, the height publication effect, and a static-analysis warning that does not recognize Effect's paired `acquireRelease` object-URL cleanup. No rule was suppressed.

Actual GPU process memory, battery use and device FPS remain hardware profiling work. The collaborative browser sometimes suspends animation frames between tool calls, so no FPS result is reported. This validation covers local source, browser behavior and the Apple Silicon binary. CI and other supported platforms require their own checks. Historical Effect benchmark files remain historical evidence. Measurements were collected before the workspace relocation on main; the final relocated source and v0.0.6 binary were validated again after rebasing.
