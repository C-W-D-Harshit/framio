# Framio Effect v4 implementation plan

Status: proposed implementation plan. No application code or dependencies have been migrated.

Prepared against this checkout on 2026-10-01. The repository currently uses Bun, React 19, React Flow, Puppeteer, and Tailwind 4, with no Effect dependency. Registry metadata and the published source for Effect 4.0.0 were inspected during planning. Baseline builds, tests, performance measurements, and cross-platform validation remain implementation work.

## 1. Destination and fixed boundaries

Effect owns Framio's application behavior: service composition, validation, failures, concurrency, state transitions, resource lifetimes, synchronization, configuration, and diagnostics. The CLI, server, canvas application, injected frame runtime, and development tooling use that architecture.

The user-facing contract stays simple:

- `framio` remains a self-contained binary with the existing commands and foreground/background behavior.
- Designs remain ordinary React + Tailwind files in `.framio/pages/`.
- `.framio/package.json`, components, hooks, example pages, theme, and agent skill acquire no Effect dependency or requirement.
- Agents continue writing ordinary `meta` exports and React components. They never implement Effect services to create a design.
- Existing DESIGN.md, image sidecars, canvas positions, selection files, and error files retain their documented shapes.
- Framio's own runtime is shipped as an internal asset, separately from user frame bundles. Resolving a design's packages still uses its `.framio/node_modules`.
- Runtime dependencies stay inside the distributed binary and browser assets. End users acquire no new Node, Bun, daemon, database, collector, or package-manager requirement.
- React, React Flow, Puppeteer, Bun's compiler, Tailwind, DOM APIs, and pure layout/image algorithms retain their actual jobs. Effect owns the application logic and lifetime around them.

Full adoption means the final application has one coherent ownership model. A phase may temporarily bridge old and new implementations, but a service that merely invokes an untouched legacy application is not a finished phase.

## 2. What the current implementation requires us to preserve

| Current code | Behavior to preserve | Architectural work |
| --- | --- | --- |
| `src/cli.ts` | Default `start`, subcommands, help, version, internal `__serve`, exit codes | Effect CLI command tree and one process entrypoint |
| `src/commands/server.ts` | Attached foreground child; detached background server; temporary screenshot child; concurrent starters reuse the winner | Explicit ownership and startup state machine |
| `src/lib/server-state.ts` | Exclusive startup lock, stale-lock recovery, root/PID health checks, global registry, verified stop | Scoped filesystem resources and Effect services with cross-process semantics |
| `src/server/server.ts` | Initial build, serialized rebuilds, 60 ms change accumulation, snapshots, API routes, asset delivery, graceful shutdown | Project runtime, coherent state, build coordinator, typed transport |
| `src/server/bundler.ts` | Shared chunks; per-frame fallback after a combined build fails; versions change only with output | Effect build service, immutable candidate results, bounded fallback work |
| `src/server/tailwind.ts` and `design-md.ts` | DESIGN.md overrides, base-theme fallback, Google Font imports, dark aliases, viewport rewrite | Schema validation, typed diagnostics, effectful file/compiler boundary |
| `src/server/project.ts` | Sorted discovery, metadata defaults, image sidecars, variations, saved positions | Schema-backed project models and effectful discovery |
| `src/server/screenshotter.ts` | Warm browser, four concurrent pages, five-minute idle retention, readiness, full content height, page composition | Scoped Chromium/page ownership, reference counting, semaphore |
| `src/ui/app.tsx` | Project snapshots, reconnect, page navigation, saved tool, selection | Atom-backed application state and scoped connection service |
| `src/ui/canvas.tsx` | Selection reporting, drag persistence, saved viewport, panning, iframe input forwarding, CSS updates | Effect actions and subscriptions; clear reconciliation with React Flow |
| `src/ui/frame-node.tsx` | Off-screen culling, thumbnail mode, hidden replacement frame, ready/error swap, eight-second fallback | Scoped per-frame reload controller and version-aware messages |
| `src/runtime/runtime.ts` | Boot globals, readiness, error overlay, font/image waits, size reporting, input forwarding | Small scoped Effect runtime and schema-defined messages |
| `scripts/build-ui.ts` | UI/runtime builds, embedded manifest, watch mode | Effect build program and serialized watch worker |
| `scripts/build-binary.ts` | Native addon embedding, compiled self-invocation, tarball | Effect orchestration preserving Bun compile behavior |
| `.github/workflows/release.yml` | macOS arm64/x64 and Linux arm64/x64 artifacts | Validation before artifact publication |

Existing tests cover project/design behavior, actual Chromium frame measurement, and server process lifecycle. The temporary-server screenshot tests use an empty project and do not demonstrate an actual Chromium capture. Add that missing proof during migration.

## 3. Dependency and API policy

Initial direct production dependencies:

| Dependency | Purpose | Placement |
| --- | --- | --- |
| `effect@4.0.0` | Core, Schema, CLI, HTTP, RPC, sockets, processes, reactivity, diagnostics | Framio root |
| `@effect/platform-bun@4.0.0` | Bun runtime, filesystem, child processes, HTTP server and platform services | Framio root; server/tooling imports only |
| `@effect/atom-react@4.0.0` | React integration for Effect Atom | Framio root; canvas imports only |
| `scheduler@0.27.0` | Compatible Atom React peer dependency | Framio root; satisfies `>=0.25.0 <0.28.0` |

Development dependencies:

- `@effect/vitest@4.0.0` and `vitest@5.0.3` for service, scope, clock, and concurrency tests.
- Existing Bun tests remain available for real process, compiler, and browser integration.
- Vitest 5.0.3 currently declares Node `^22.12.0 || ^24.0.0 || >=26.0.0`. Establish a compatible development/CI runner without changing end-user runtime requirements. Verify Bun-driven Vitest execution rather than assuming compatibility.
- TypeScript and existing React/Bun types remain; adjust only if verified peer/tooling requirements demand it.

The published Effect 4.0.0 package exports `effect/cli`, `effect/http`, `effect/http-api`, `effect/rpc`, `effect/socket`, `effect/process`, `effect/reactivity`, and `effect/testing`. Use those verified paths. Several ecosystem modules still carry an upstream `@stability unstable` annotation even though the package release is stable. Pin versions and rerun contract/build tests on upgrades.

Before implementation, install the pinned release with Bun, read `node_modules/effect/AGENTS.md` completely, and use its linked examples plus installed source to resolve signatures. Add that requirement to root `AGENTS.md`. This is adoption from plain TypeScript, so v3 compatibility code and v3 migration inventories have no role.

Use `Context.Service`, `Layer`, `Effect.fn`, `Effect.gen`, `Schema`, scopes, fibers, and the v4 error combinators as documented in the pinned source. Do not introduce old-shaped facades, a generic Promise-to-Effect application wrapper, or type assertions that hide incorrect API usage.

Use core logs, tracing, metrics, and optional `effect/observability` export. Telemetry exporters initialize only when explicitly configured. SQL, Cluster, Workflow, and AI modules are outside this migration because the current product has no corresponding storage, distributed execution, durable workflow, or model-invocation requirement.

## 4. Module boundaries and composition

Suggested organization; combine small files when splitting them would add no ownership or test boundary:

```text
src/
  domain/
    project.ts              Schemas and types for pages, frames, positions
    design.ts               DESIGN.md token schemas and diagnostics
    diagnostics.ts          User-readable diagnostic model
    errors.ts               Tagged application errors
    policies.ts             Internal concurrency/timing limits
  contracts/
    api.ts                  Existing HTTP contracts for CLI/canvas
    frame-api.ts            Small frame-status contract
    live.ts                 Snapshot subscription RPC
    frame-messages.ts       Parent/iframe discriminated messages
    server-info.ts          Registry/health schemas and protocol version
  platform/
    bun.ts                  Focused platform layer composition
    bun-build.ts            Bun.build adapter
    chromium.ts             Puppeteer and browser-download adapters
    process-control.ts      OS-specific process identity/signals as needed
    embedded-assets.ts      Generated asset access
  services/
    project-context.ts      Canonical project root and paths
    project-files.ts        Scanning and schema-backed JSON operations
    server-registry.ts      Health/discovery/verified stop
    server-launcher.ts      Owned versus borrowed server acquisition
    package-manager.ts      Bundled Bun and shadcn execution
    frame-build.ts          Entry generation and compiler results
    theme-build.ts          Token/stylesheet compilation
    build-coordinator.ts    File-change accumulation and build ordering
    project-state.ts        Immutable committed generations
    screenshots.ts          Browser/page lifetime and capture policy
    thumbnails.ts           Versioned shared capture cache
    selection.ts            Agent selection persistence
    canvas-positions.ts     Serialized position persistence
  server/
    app.ts                  Project application layer
    api-handlers.ts         HttpApi handler implementation
    live.ts                 RPC subscription implementation
    static.ts               Frame HTML, files, embedded UI routes
    main.ts                 Acquires lock, launches app, finalizes resources
  commands/                 Effect command handlers
  ui/
    services/               Connection, persistence, frame bridge
    state/                  Atom runtime, writable and derived atoms
    app.tsx                 React rendering
    canvas.tsx              React Flow integration
    frame-node.tsx          Frame display integration
    layout.ts               Pure layout
  runtime/
    main.ts                 Frame scope and boot
    readiness.ts            DOM/font/image readiness
    messages.ts             Validated bridge and synchronous event adapters
    errors.ts               Overlay, diagnostic/status reporting
    frame-style.ts          Existing frame CSS
```

Dependency rules:

1. Domain models depend on Effect core/Schema and pure helpers, never Bun/Puppeteer/React.
2. Contracts depend on domain schemas and their specific transport modules, never server implementations.
3. Application services depend on explicit services through `Context`, never hidden globals.
4. Platform adapters contain third-party Promise/callback integration and platform-specific operations.
5. HTTP/RPC handlers invoke application services; they do not implement separate domain logic.
6. UI imports browser-safe contracts/services. Replace imports of types from `server/server.ts` with contract/domain imports.
7. The frame runtime imports a narrow browser-safe subset. No server/CLI/RPC/Atom React barrel reaches its bundle.
8. Scaffold files do not import Framio internals or Effect.
9. `Effect.run*` and `ManagedRuntime` calls belong at genuine host entrypoints and necessary callback boundaries. Service implementations compose Effects without starting independent runtimes.

Application scopes:

- One root scope per CLI invocation.
- One long-lived project scope inside each `__serve` process.
- One request scope per HTTP request and one scope per live client connection.
- One browser application runtime per canvas document, using the Atom registry/runtime facilities without duplicate runtime construction.
- One small scope per injected frame document, with deterministic explicit disposal for tests/reinitialization and best-effort unload disposal.
- Child scopes for page captures, replacement-frame waits, build workers, and owned temporary processes.

Layer composition stays acyclic. The screenshot browser remains lazy; health/status/list/install/help do not initialize Chromium. CLI commands provide only the services they need. Pure types should not force server layer construction in the browser.

## 5. State, lifetime, and failure semantics

### Project state and build generations

`ProjectState` contains the committed page/frame model, bundled files, frame versions/diagnostics, theme text/version/diagnostics, runtime diagnostics, and a monotonic generation identifier. Use an immutable committed value behind `SubscriptionRef` or a synchronized reference. Frame and CSS versions retain their existing meaning.

Builders construct candidate results. Commit related state together after the selected work finishes. A snapshot must never combine new frame metadata with half-published bundled files or an unrelated CSS generation. Readers use the committed state; generated JS chunk URLs remain valid for already-open frames, with bounded retention of referenced generations.

Preserve combined-build fallback and recoverable frame diagnostics. A syntax error in one user frame is a reportable result, not a fatal worker failure. Invalid DESIGN.md still produces a diagnostic and usable base-theme CSS. Infrastructure failures, such as unreadable directories or unavailable output storage, have typed failure paths and explicit recovery policy.

### File events and the screenshot build barrier

Use the platform filesystem watch stream where recursive behavior is verified. Otherwise implement a narrowly scoped callback adapter that closes its watcher and reports watcher errors. Begin watching before the initial scan/build so edits during startup are retained.

The event coordinator must accumulate every relevant changed path. A plain debounce of single events is incorrect because it drops earlier filenames. Preserve the 60 ms quiet window, deduplicate paths, and add a maximum batch wait so continuous saves cannot postpone builds forever. Coalesce events received during a build into the next batch. On watcher overflow or uncertainty, schedule a full rescan.

Use one serialized build worker. A bounded wake-up queue plus a coalescing pending-path set avoids retaining an unbounded list of rebuild jobs. Bound the path set too; if it exceeds the chosen limit, replace it with a full-rescan marker rather than dropping work.

Screenshots wait on a coordinator barrier, including events still inside the quiet window. Define the guarantee as all relevant events accepted before the barrier are committed before capture begins. Edits arriving later belong to a later generation. Flush the pending batch when the barrier is requested. A screenshot batch uses a pinned generation so page discovery, layout, HTML, theme, and bundled assets refer to the same source state.

Internal generation-aware frame/theme/asset URLs or a scoped artifact lease must make that pin real. Waiting for a build alone is insufficient if the next build can replace assets mid-capture. Release generation references after the capture and clean retained artifacts within a measured bound.

Scope that guarantee precisely. Compiled JavaScript, theme CSS, model/layout inputs, and selected local image references must be stable for a capture. Where local assets can be overwritten directly by an agent, use a capture-local copy/versioned artifact or detect a mid-capture change and report/retry under an explicit policy. Do not copy the entire project on every save. Remote fonts/images are external resources and cannot be made immutable by an Effect scope; readiness and failure reporting remain the contract for them.

### Owned, borrowed, and detached processes

Represent server acquisition as explicit owned-temporary versus borrowed-running results. Only an owned process registers a stop finalizer. A startup loser disposes its own losing child and borrows the winning server. Existing servers remain alive after screenshots.

Foreground children inherit stdio, remain attached, and stop on parent interruption. Temporary children have bounded graceful termination followed by forced termination of that owned child if required. Detached background servers transfer lifetime responsibility to their own server process after verified readiness.

`ChildProcessHandle.unref` permits parent exit; it does not, by itself, prove that a scope finalizer will leave the child alive. Inspect the platform spawner's finalization behavior. Implement and test an explicit successful-detach/ownership-transfer path. If the upstream primitive cannot express it, keep the necessary detached OS spawn inside a small Effect-native launcher adapter, with owned cleanup before transfer and no parent stop obligation afterward.

Preserve self-invocation in source and compiled modes, `BUN_BE_BUN=1`, PATH scoping for the shadcn shim, log descriptors, command arrays without shell interpolation, and Node requirements only for existing `npx` features.

### Locks and registry

Filesystem exclusivity remains the cross-process authority. An Effect semaphore only serializes work inside one process.

Acquisition registers cleanup immediately after successful creation. Preserve the stale-lock recovery lock and recheck ownership before removal. Lock cleanup must verify the same ownership/file identity it acquired. Do not remove another starter's lock or registry entry during a late finalizer. SIGKILL bypasses finalizers, so stale recovery stays required.

Validate server/registry JSON and health responses with Schema. Verify canonical root and PID before stopping an external process. Preserve `EPERM` handling for liveness checks. Runtime registry/health records may receive optional internal instance/protocol identifiers; read older records deliberately and keep agent-readable selection/error files unchanged.

### Chromium and capture cancellation

Use `RcRef` for one lazily acquired Chromium resource, with five minutes of idle retention measured after the final borrow is released. Each active capture holds its browser reference until its page closes. The idle timer cannot close a browser during active captures.

Use a shared semaphore with four permits for captures and thumbnails. Acquire/release a page within each capture scope. A canceled waiter consumes no permit, launches no page, and leaves no callback behind. Page composition uses the same resource rules. Chromium disconnect invalidates the shared resource and fails active work with meaningful errors; the next capture may acquire a new browser.

External Promises need adapter-specific cancellation. Puppeteer page closure is the practical cancellation boundary for many page operations. Register cleanup early, handle late completion of launch/new-page operations, and avoid leaving resources created after interruption. A timeout cancels the operation and finalizes its page. Cleanup failures are logged without replacing the original user-facing failure, and cleanup has a bounded shutdown policy.

Preserve the 20-second render-readiness deadline, fonts/images/two-paint behavior, full content height, retina scale, image captures, overview labels/notes/variation links, and 3200-pixel overview width cap. Keep partial screenshot results when individual frames fail.

### Thumbnail sharing and output files

Key thumbnails by frame identity and all visual inputs: relevant frame/image version, theme version, scale, and generation where needed. The current thumbnail key uses a bundler version even for image frames; cover image replacement explicitly.

Use an Effect cache or scoped keyed resource with shared in-flight work, failure eviction, bounded retention, and cancellation ownership. A canceled reader must not cancel work still needed by another reader. Completion of an old entry must not delete or replace a newer entry.

Avoid simultaneous captures writing the same output file. Serialize by output path or render to unique temporary files and publish atomically. Capture-generation URLs must resolve the intended output, including overview source images. Return the existing stable screenshot paths to CLI users.

### Error model and recovery

Define tagged errors at useful recovery boundaries, for example `ProjectNotFound`, `ProjectReadFailed`, `InvalidInput`, `ServerUnavailable`, `ServerStartupFailed`, `ServerIdentityMismatch`, `ProtocolMismatch`, `PackageCommandFailed`, `BrowserUnavailable`, `CaptureTimedOut`, and `OutputWriteFailed`. Keep low-level causes for diagnostics without exposing unnecessary internals in normal output.

Keep frame/theme diagnostics separate from infrastructure failure. HTTP transport status and the existing screenshot partial-results body each have explicit mappings. Expected CLI failures print concise messages and exit 1. Existing successful Ctrl+C shutdown exits 0. Unexpected defects retain useful developer logs and cannot disappear into a broad empty catch.

Retry only operations whose failure/repetition semantics allow it: connection re-establishment, bounded readiness polling, classified transient filesystem reads, or browser re-acquisition after invalidation. Do not automatically rerun package installs, arbitrary shadcn writes, or partially published captures.

## 6. Transport and frontend design

### HTTP contracts

Use `HttpApi` and generated clients for the existing application endpoints. Serve them with the scoped Bun HTTP server and Effect router. Keep static/frame/JS/image/thumbnail/screenshot assets as separate router handlers.

| Endpoint | Contract and behavior |
| --- | --- |
| `GET /api/health` | Existing root/PID identity plus optional internal compatibility data |
| `GET /api/project` | Schema-encoded current snapshot |
| `POST /api/selection` | Validated frame IDs and optional element description; unchanged agent-readable output |
| `POST /api/canvas` | Validated page and finite positions; merge/preserve unrelated file fields; round coordinates |
| `POST /api/frame-status` | Known frame and matching version/generation; stale reports cannot overwrite newer diagnostics |
| `POST /api/screenshot` | Existing frames/page/scale input and partial results; coordinator barrier and generation lease |

Validate positive finite dimensions/scales and sensible bounded inputs. Preserve valid current inputs and defaults. Document deliberate invalid-input behavior changes. Unknown pages/frames retain clear errors. Keep frame-status schema/client separate so each iframe does not import the entire CLI/canvas API contract.

Preserve loopback binding, port search beginning at 4747 for 100 ports, successful-address registration, JS chunk caching, no-store frame outputs, theme hot-swap, and safe file containment. Use only port-in-use failures to advance port search. Verify Effect's Bun server exposes and finalizes the actual bound server, including WebSocket upgrades.

### Live snapshots

Use one schema-defined streaming RPC for snapshot subscription over the internal live endpoint. Keep commands/mutations on HTTP; both transports call the same services. Avoid maintaining duplicate raw-WebSocket and RPC client stacks after migration.

New subscribers receive the current snapshot and then later committed generations. Subscription setup must not miss an update between reading the initial snapshot and registering for changes. Retain only the newest necessary snapshot for a slow consumer. Intermediate complete snapshots may be coalesced; command acknowledgements and errors may not be dropped.

Reconnect uses a bounded backoff schedule with jitter and resets after a healthy connection. Dispose subscriptions, sockets, timers, and child fibers on application disposal. Connection state is explicit: connecting, connected, reconnecting, disconnected, or incompatible. Browser URL construction respects `ws`/`wss`.

Protocol version is internal. If a new CLI finds an incompatible older server, report a restart instruction instead of silently treating its payload as current or stopping it automatically. Cached old UI and new server connections receive a clear mismatch behavior. This does not require a new user project file.

### Atom ownership

| State | Owner |
| --- | --- |
| Committed project/build snapshot | Server; client atom reflects the latest accepted generation |
| Connection and asynchronous action results | Browser Effect services and Atom runtime |
| Active page and selected tool | Browser atoms, backed by existing hash/localStorage conventions |
| Canonical canvas selection | Browser selection atom; React Flow selection changes feed it |
| Pending position writes | Browser action controller, keyed per page with monotonic local acknowledgement tracking |
| Persisted frame positions | Server/file state |
| Frame heights/readiness/diagnostics | Version-aware browser frame controller |
| Dragging and viewport transform | React Flow's interaction engine; derived state feeds application actions |
| Overlay geometry and immediate pointer work | DOM/React Flow callbacks owned by scoped adapters |

Avoid two independently writable selection/position stores. Identify one canonical application state and a directional React Flow integration. Derived atoms expose pages, selected frames, active page fallback, live/thumbnail decisions where appropriate, and action status. Plain local React state remains for isolated render-only details with no external lifetime.

Selection saving preserves the first-load rule that avoids overwriting the agent's previous selection with an initial empty value. Coalesce rapid changes, serialize/sequence acknowledgements, flush or retain explicit pending state, and prevent older requests from becoming the final file state. Drag writes merge deltas and survive snapshot echoes without snapping the current drag back. Preserve localStorage keys and hash URL semantics.

Per-frame replacement scopes bind to actual iframe windows and versions. Rapid edits cannot let an old hidden iframe's ready message reveal the wrong replacement. Preserve off-screen iframe culling, the large-page thumbnail threshold, zoom threshold, and eight-second fallback. Surface persistence failures through the existing interface with concise status; do not add Effect concepts to product text.

### Injected frame runtime

Preserve `window.__FRAMIO_BOOT__` and `window.__framio`, classic-script execution before user React mounts, the error overlay, standalone/canvas behavior, and screenshot readiness. Add only optional internal boot fields needed to correlate version/generation.

Compose a minimal Effect scope for readiness, status reporting, event listeners, ResizeObservers, and CSS-load replacement. Event adapters register finalizers and support explicit disposal/reinitialization. Scope ownership must work under page unload, iframe replacement, test disposal, and an error during initialization.

Browser events requiring `preventDefault` or `stopPropagation` must act synchronously in the originating callback. Do not queue them through a fiber and lose the browser's event cancellation window. Pure DOM measurement, overlay positioning, coordinate conversion, and paint scheduling stay native under the scope. Coalesce high-frequency reporting rather than scheduling a separate expensive Effect/tracing span for every pointer movement.

Validate control/status messages against discriminated Schema contracts and correlate source windows, frame IDs, and versions. Thumbnail-generated size messages currently originate in the canvas document; replace that route with a typed local action or explicitly distinguish it from iframe messages. Do not accidentally reject legitimate local thumbnail measurement while tightening iframe validation.

Catch runtime errors through the existing global hooks even before the full frame service is ready. Faulty user code still receives the overlay and agent-readable diagnostic. Status-report failure must not create recursive frame errors. Schema validation applies to the extracted `meta` object without requiring any new syntax from users.

## 7. Implementation sequence

Each phase is a reviewable change with its own evidence. The target is full migration; completion of the first screenshot path is a milestone, not the finish line. Runtime compatibility bridges are temporary and have an explicit removal phase.

### Phase 0: baseline and characterization

Tasks:

- [x] Confirm branch, worktree status, existing generated assets, Bun version, install status, and release workflow runtime.
- [ ] Install current dependencies with the lockfile and build the current UI before judging missing generated files.
- [x] Run current typecheck and all existing tests; record failures and prerequisite downloads honestly.
- [x] Build a current-platform binary and verify version/init/self-invocation from outside the repository.
- [x] Create isolated fixture projects with real React frames, image references, variations, DESIGN.md overrides, overflow, a broken frame, and a malformed sidecar.
- [ ] Record scaffold file/dependency hashes and canonical user-visible CLI/API/JSON behavior.
- [ ] Capture baseline binary/tarball size, UI/runtime/frame JS sizes, startup/readiness time, rebuild-to-visible time, cold/warm capture latency, process memory, and canvas/frame memory.
- [ ] Establish benchmark fixtures at 1, 10, 50, and 100 frames; distinguish total frames from mounted live iframes.
- [ ] Add missing characterization coverage before replacing the relevant owner: real screenshot output, build event accumulation, startup races, and malformed input recovery.

Exit: reproducible baseline report and fixtures; existing failure inventory is separate from migration regressions. No claimed performance budgets without measurements.

### Phase 1: Effect setup, contracts, and import separation

Tasks:

- [x] Pin production/development Effect ecosystem dependencies and compatible peers; update the Bun lockfile. Commit/push remains outside this task.
- [x] Add root agent guidance to read the installed v4 documentation before writing Effect code.
- [x] Add separate service-test configuration and scripts while preserving Bun integration tests.
- [x] Extract browser-safe domain types from server implementations; move shared layout dependencies to domain/contract types.
- [x] Define Schema contracts for current persisted data, metadata/sidecars/tokens, snapshots, HTTP payloads, and iframe messages.
- [ ] Define tagged errors, user diagnostic rendering, and centralized internal timing/concurrency policies.
- [ ] Add import-boundary checks that fail if scaffold/frame/user bundles pull server modules or Effect dependencies unexpectedly.

Exit: typecheck and existing behavior tests pass; current user data decodes with intentional defaults; schemas are reused by producers/consumers, not duplicated by hand.

### Phase 2: platform services and process ownership

Tasks:

- [x] Compose focused Bun filesystem/path/stdio/process layers, configuration, embedded-asset access, and optional logging.
- [x] Convert canonical root discovery and effectful project path resolution while retaining pure path assembly.
- [x] Implement schema-backed server registry/health/discovery/stop services.
- [x] Implement scoped lock/recovery acquisition and ownership-safe cleanup.
- [x] Implement launcher acquisition results for borrowed, owned temporary, attached foreground, and successfully detached background processes.
- [ ] Verify platform child spawner scope finalization, process-group behavior, stdout draining, descriptor cleanup, and compiled self-invocation.
- [x] Preserve 30-second startup timeout, 100 ms readiness polling, health timeout, and 10-second stop deadline through Effect schedules/Clock.
- [x] Introduce one Effect CLI runtime owner for migrated commands; retain only the minimum temporary dispatch bridge needed for unmigrated commands.

Exit: all existing server-lifecycle tests pass; cancellation during each startup stage cleans only owned work; successful background CLI exit leaves exactly one healthy server; SIGKILL recovery works.

### Phase 3: Chromium and screenshot application service

Tasks:

- [x] Replace the mutable Screenshotter resource machinery with Chromium acquisition, `RcRef`, page scopes, semaphore, and tagged errors.
- [x] Implement single-frame/image capture and page composition with current dimensions, scaling, labels, notes, and partial failure behavior.
- [ ] Handle cancellation while waiting, launching, opening a page, navigating, waiting for readiness, and writing output.
- [x] Implement bounded finalization and browser-disconnect invalidation.
- [x] Implement shared thumbnail capture with visual version keys and unique/atomic output publication.
- [ ] Expose the Effect screenshot service to the existing server through a narrow temporary transport bridge.
- [x] Add fake-adapter lifetime/concurrency tests and real Chromium PNG tests.

Exit: at most four page captures run; every acquired page closes on success/error/interruption; active work survives the idle window; real successful/failing captures demonstrate temporary-server cleanup and borrowed-server preservation.

### Phase 4: HTTP server and end-to-end screenshot slice

Tasks:

- [x] Introduce the scoped Bun HTTP server, port acquisition, static router, and HttpApi handler layers.
- [x] Implement existing endpoint schemas and their error/result mappings; use the small frame-status contract.
- [x] Convert screenshot CLI to Effect CLI arguments and generated HTTP client, borrowing/acquiring servers through the launcher service.
- [x] Preserve source/compiled `__serve` startup, existing command output essentials, partial results, and exit codes.
- [x] Register readiness only after the initial application generation and HTTP server are usable.
- [ ] Add in-memory HttpApi handler tests and real loopback/source/binary request checks.
- [x] Remove the old raw screenshot request handler and Promise cleanup implementation once parity passes.

Exit: Effect owns the command, transport, capture, and cleanup path from CLI arguments to an actual rendered PNG; malformed input is handled deliberately; static/file routes and screenshot dimensions remain correct. Discovery/build internals still behind the temporary application bridge move to native Effect services in Phase 5, so this milestone does not claim that those internals are already migrated.

### Phase 5: project discovery, theme, and build coordination

Tasks:

- [x] Convert project scanning and filesystem reads to services; validate metadata/sidecars/canvas data after extraction/parsing.
- [x] Preserve numeric metadata normalization/defaults, sort order, image signature detection, aspect ratio, and variation resolution.
- [ ] Record the intentional metadata compatibility change: literal-only Acorn parsing replaces `new Function`; dynamic expressions are rejected with a frame diagnostic. See the architecture document.
- [x] Convert DESIGN.md file/YAML validation and Tailwind compilation into typed Effect services; preserve arbitrary documented typography guidance and token alias behavior.
- [x] Replace mutable bundler publication with candidate build results; preserve shared chunks, unchanged-output versions, and isolated fallback diagnostics.
- [x] Add immutable committed generations, runtime error correlation, generation leases, and bounded artifact retention.
- [x] Implement watch subscription before initial scan, accumulated quiet-window batches, maximum wait, serialized work, overflow-to-full-rescan, and shutdown.
- [x] Replace screenshot `await queue` with the explicit barrier that includes pending debounced events and pins its generation.
- [x] Preserve agent error-file format and avoid watcher feedback loops from `.state` writes.

Exit: concurrent saves cannot lose relevant paths or publish mixed generations; continuous edits make bounded progress; one broken frame does not break healthy frames; captures never consume half-published or mismatched artifacts.

### Phase 6: live RPC and remaining CLI commands

Tasks:

- [x] Implement snapshot stream RPC backed by committed state and correct subscribe-then-current ordering.
- [ ] Add per-connection scopes, newest-snapshot coalescing, reconnect-compatible version data, and bounded slow-consumer handling.
- [x] Migrate `start`, `stop`, `list`, `status`, `open`, `init`, `install`, and `add` to the Effect CLI command tree and services.
- [ ] Preserve default `start`, accepted flags, usage examples, version injection, internal dispatch, stdio, exit codes, and existing Node checks.
- [x] Preserve init's independent outcomes: package install failure fails the command; optional browser download failure warns and permits later screenshot retry.
- [x] Maintain scaffold content and skill placement exactly; keep overwrite protection and narrowly scoped shim/environment behavior.
- [x] Remove the remaining Promise CLI dispatch and broad legacy error wrapper.

Exit: all user commands are Effect programs; background/temporary/foreground behavior is correct; scaffold dependency/content comparison passes; no command constructs unused project/browser/server services.

### Phase 7: canvas services and Atom state

Tasks:

- [x] Create one browser application layer/Atom runtime and scoped RPC subscription service.
- [x] Move connection, snapshots, selected page/tool, canonical selection, frame measurements, and pending persistence state to atoms/controllers.
- [ ] Build derived atoms for active page, selected frames, diagnostics, connection status, and pending actions.
- [x] Replace raw UI fetches with typed Effect actions for selection and position persistence.
- [x] Implement per-page sequenced/coalesced saves and acknowledgement-aware optimistic reconciliation.
- [x] Integrate React Flow callbacks without duplicating its high-frequency pointer/viewport mechanics in another state engine.
- [ ] Preserve localStorage keys, viewport persistence, hash navigation, keyboard shortcuts, panning, context menus, and first-selection-save semantics.
- [x] Replace manual frame replacement timers/listeners with scoped version-aware controllers; preserve hidden swap and fallback behavior.
- [x] Remove raw WebSocket reconnect hook and unused old connection state.

Exit: connection loss/recovery and rapid saves are correct; old requests/messages cannot overwrite current UI state; no duplicated subscriptions under React lifecycle replay; canvas behavior matches baseline browser checks.

### Phase 8: injected frame runtime

Tasks:

- [x] Compose narrow core/Schema imports and a minimal scoped frame program, excluding RPC/CLI/Atom React/server layers.
- [ ] Preserve immediate boot error reporting and all global compatibility hooks used by generated entries/Puppeteer.
- [x] Implement owned DOM listeners/observers, readiness, status reporting, CSS replacement, and explicit disposal.
- [ ] Validate messages with source/window/frame/version correlation and typed local thumbnail measurement.
- [x] Keep synchronous input prevention, overlay geometry, and paint-sensitive work in synchronous host adapters.
- [ ] Handle unload/reinitialization, images that fail decoding, slow fonts, absent root, runtime errors, and CSS replacement failure.
- [ ] Verify shared internal runtime asset delivery and user frame import graph isolation.

Exit: actual iframe/screenshot/browser tests pass; observers/listeners stop on disposal; standalone and canvas frames work; user frame bundles/dependencies remain Effect-free; measured per-frame overhead meets the recorded budget.

### Phase 9: tooling, observability, and CI

Tasks:

- [x] Convert build/watch orchestration to Effect with candidate output publication and one serialized watch worker.
- [x] Preserve generated asset embedding and native-addon rewrite checks; failed UI/runtime builds must fail before publishing a new manifest.
- [ ] Avoid compiling build-only services into the runtime binary.
- [ ] Add structured lifecycle/build/capture logs and spans at meaningful operation boundaries.
- [ ] Add counters/gauges for generation/build duration, queue/pending work, page permits, active captures, cache outcomes, connection state, and cleanup failures.
- [x] Keep logs useful and concise; do not trace every pointer event or include design HTML/assets in telemetry.
- [ ] Make configured telemetry resources scoped and disabled by default; diagnostics must never prevent normal startup when export fails.
- [x] Add ordinary validation CI for typecheck/service tests/Bun integration; update release validation for the four existing targets.
- [x] Keep cross-platform smoke tests able to verify binary operation outside the checkout without Node/Bun installed on PATH.

Exit: source and compiled builds pass with the pinned release toolchain; build failures cannot ship stale generated UI; artifact publication depends on required checks; internal bundle boundaries are enforced.

### Phase 10: remove bridges, review, and delivery evidence

Tasks:

- [x] Remove temporary legacy dispatch/server bridges and orphaned classes/hooks/helpers.
- [ ] Audit application code for raw fetch/spawn/timers/listeners/global mutable state that still owns application behavior.
- [x] Classify remaining native calls as pure computation, synchronous host behavior, build API integration, or narrowly documented adapters.
- [ ] Audit every root runtime, background fiber, resource acquisition/finalizer, retry, timeout, cache, and output publication path.
- [ ] Verify no catch-all swallowing, type assertion workaround, duplicate state owner, or permanent compatibility facade remains.
- [ ] Compare scaffold bytes/dependencies and user output formats to the baseline.
- [ ] Run the final test/build/browser/performance matrix once on the final code; repeat only after relevant changes/failures.
- [x] Record local, browser, compiled artifact, CI, and target-platform evidence separately.
- [x] Update development architecture/testing docs while keeping user docs and the generated skill free of Effect implementation details.

Exit: all completion criteria below are met; full internal adoption is achieved; any unresolved blocker is named rather than hidden behind a partial migration claim.

## 8. Verification matrix

| Area | Required cases | Proof method |
| --- | --- | --- |
| Schema/contracts | Valid existing files; malformed JSON/YAML; invalid positions/scales; schema round trips; diagnostic messages | Focused service/contract tests |
| Layer ownership | One shared service instance; lazy browser acquisition; scoped finalization after startup failure | Layer tests with fake platform resources |
| Lock/registry | Concurrent starts; empty lock; stale owner; competing recovery; cleanup after ownership change; unverified PID | Fake filesystem tests plus real process integration |
| Launcher | Borrow existing; win/lose start race; timeout; interruption; child exit/error; background transfer; log descriptor cleanup | Clock/layer tests and real OS children |
| Browser resource | Single shared launch; release after final borrow; five-minute idle; active work never idle-closes; disconnect/reacquire | TestClock and fake Chromium service |
| Capture semaphore | More than four requests; canceled queued request; cancellation at each capture stage; permit reuse | Deterministic concurrency tests |
| Actual capture | React frame; image; overflow; readiness; scale 1/2; failed frame; page composition with notes/variations | Real Chromium PNG dimensions and rendered-image inspection |
| Output/cache | In-flight sharing; new version during old capture; stale failure completion; image replacement; same output races | Controlled adapter/filesystem tests plus integration |
| Rebuilds | Multiple filenames in one batch; event during initial build; event during build; continuous edits; overflow; worker recovery | TestClock, gated fake builders, real watch integration |
| Build consistency | Combined fallback; unchanged versions; CSS fallback; committed generation coherence; pinned capture assets; retention | Service tests and real Bun/Tailwind fixture builds |
| Live transport | Initial/current ordering; reconnect; disconnect cancellation; slow client; malformed data; protocol mismatch | In-memory RPC tests and real loopback connection |
| Persistence | Skip initial empty selection; older save finishes late; per-page position merging; write failure; unrelated canvas fields | Controller tests and UI/server integration |
| Canvas | Navigation; tools; selection; drag; viewport; shortcuts; iframe input; thumbnail/visibility transitions | Real browser interaction checks |
| Frame runtime | Boot error; user runtime error; bad images; slow fonts; ready/error version race; CSS hot-swap; listener/observer disposal | Existing and expanded actual Chromium tests |
| User isolation | Scaffold hashes; dependency graph; ordinary frame build; binary outside repo | Build/scaffold comparison and compiled integration |
| Distribution | macOS arm64/x64, Linux arm64/x64; embedded files/native addons; self-invocation | CI on each actual target |

Use `@effect/vitest` and `TestClock` for Effect lifetime/timing behavior. Use controlled Deferred/latches to force races; do not rely on arbitrary sleeps for unit-level concurrency assertions. Preserve actual Bun/compiler/process/browser checks because fake layers cannot prove those integrations.

Required assertions observe results and ownership: process exits, lock removal, frame output/dimensions, closed pages, returned permits, saved final positions, committed versions, bounded subscribers, and absence of orphan work. A passing empty-project capture is not evidence of Chromium capture. No silent skips or weakened assertions to make migration tests pass.

During implementation, add `test:effect`, `test:integration`, `test:all`, and a `check` command with explicitly documented runner requirements. Existing `bun run typecheck`, `bun run build:ui`, `bun run build:binary`, and user-facing commands retain their roles. Use focused tests per phase and full required checks at integration milestones.

Keep test discovery separate: `tests/effect/` contains Vitest service tests, and `tests/integration/` contains the existing and expanded Bun tests. Point each runner at its own directory explicitly and update moved fixtures/imports. The current `bun test tests` command would discover incompatible Vitest files if left unchanged. Make `bun run test` invoke the full intended suite and retain focused commands for development. Add `vitest.effect.config.ts` and include it in TypeScript checking so configuration errors do not escape validation.

## 9. User overhead and performance gates

Hard acceptance gates:

- Zero Effect or Effect ecosystem dependencies added to the generated design project.
- Zero Effect imports generated in user components/pages/hooks or required in their metadata.
- Zero server/CLI/Puppeteer/Tailwind services in canvas/frame browser bundles.
- Zero RPC or Atom React stack in the injected frame runtime.
- Zero new end-user runtime/setup requirement and zero always-on telemetry export.
- Preserve iframe culling, thumbnail substitution, shared design chunks, and lazy Chromium initialization.

Measure costs independently. Shared downloaded bytes do not eliminate per-iframe parse/evaluation time or memory. A warm canvas and a cold standalone screenshot need separate measurements.

Proposed initial engineering budgets, to be checked against the Phase 0 report before code migration:

| Measurement | Initial budget |
| --- | --- |
| Compressed internal canvas JS increase | At most 100 KiB |
| Compressed injected runtime increase | At most 35 KiB |
| Compiled binary size increase | At most 5 MiB for the measured target |
| Foreground server readiness/rebuild/warm capture latency | Median and p95 within baseline plus the greater of 10% or 25 ms |
| Steady server/canvas memory | Within baseline plus the greater of 10% or 5 MiB |
| Per mounted iframe memory | Within baseline plus the greater of 10% or 1 MiB, with no linear growth after dispose/recreate cycles |
| Retained snapshots/jobs/captures/assets | Bounded by documented queue/cache/lease limits; return to idle bounds after work |

These are engineering targets, not measurements or user-approved numeric commitments. Record exact baseline, environment, runner/browser versions, fixture size, sample count, medians, p95, raw/minified/compressed bytes, and mounted iframe count. Exclude browser-download/network-install variance from Effect runtime comparisons and report those separately.

A failed budget requires import-graph/runtime profiling and a concrete correction or a documented unresolved design decision. Do not silently loosen limits or remove measurements. If the core/Schema frame build exceeds the target, inspect narrow imports, tree shaking, and shared internal asset structure before considering an architectural exception. Such an exception must preserve the agreed user boundary and be discussed explicitly.

## 10. Integration and recovery strategy

Implement serially in reviewable commits matching the phases. Each phase includes its tests and removes the replaced owner's state/lifetime logic. Use one-shot host bridges only where needed to keep subsequent phases runnable, and track their exact removal in Phase 10.

Keep user files backward compatible so an earlier binary can still read the design project. New internal state/health fields are optional or versioned. Test old internal registry records and incompatible running servers. Do not rewrite user projects to adopt Effect.

During development, serve immutable generated assets associated with a known source build. Avoid mixing old embedded UI and new live protocol without detecting mismatch. Build candidates before replacing generated manifests/output. Use code/commit reversion for a failed phase; do not delete user designs, shared Chromium caches, or unrelated server processes as rollback.

Do not publish a release tag as part of planning. When implementation delivery is requested, report clean/dirty worktree state, commit, checks, browser proof, binary results, CI status, and target artifacts distinctly. PR creation/merge and release publication follow the user's requested delivery scope.

## 11. Final completion criteria

- [x] CLI command parsing, application services, and process entrypoint use Effect v4.
- [x] Server HTTP, live stream, project state, build coordination, and shutdown use Effect ownership.
- [ ] Chromium, pages, thumbnail sharing, temporary processes, locks, watchers, and connections have explicit tested lifetimes.
- [x] Canvas application state and async actions use Effect Atom/services with coherent React Flow integration.
- [ ] Frame runtime lifetime/readiness/reporting use the minimal scoped Effect design and meet overhead checks.
- [ ] Untrusted file/network/message inputs use shared Schema contracts; valid existing user formats remain compatible.
- [x] Recoverable user frame/theme errors remain isolated and agent-readable.
- [x] Cancellation, ordering, concurrency, and stale-result behavior have meaningful regression coverage.
- [x] Native adapters are narrow and documented; no legacy application wrapped wholesale in Effect remains.
- [x] Root/runtime/browser/package boundaries prevent user-facing Effect dependency bloat.
- [ ] Typecheck, Effect service tests, Bun integration tests, real browser checks, UI build, and compiled-binary checks pass.
- [ ] The four existing release targets have actual CI evidence before cross-platform delivery is claimed.
- [x] Final performance/bundle results and any remaining limitations are recorded accurately.
- [x] Temporary bridges and redundant runtime/state machinery are removed.

The first implementation milestone is the real screenshot path, including lifecycle cleanup. The final milestone is the complete internal application architecture above, with user design projects remaining ordinary React + Tailwind.

## Implementation checkpoint, 2026-10-01

The internal migration is implemented. Checked tasks describe delivered code or local evidence, not remote CI or a release approval. Unchecked tasks include incomplete audits, broader fault-injection/browser matrices, missing scale/heap measurements, and performance acceptance. Some phases therefore do not yet satisfy their full exit criteria.

See [architecture and validation](effect-v4-architecture.md), [baseline](effect-v4-baseline.json), and [compiled performance comparison](effect-v4-performance.json). Effect and its platform/Atom/testing packages are pinned to stable 4.0.0, which supersedes the RC version anticipated during planning.

The generated scaffold is byte-identical and adds no Effect dependency. Development uses Bun 1.4.2 and Node 24; distributed compiled binaries embed Bun and the user design stack remains React/Tailwind. Metadata expressions formerly evaluated as JavaScript now produce a diagnostic.

Open acceptance gates: server startup, idle RSS, and the latest rebuild median exceed the proposed budgets; 10/50/100-frame, canvas heap, per-iframe memory/disposal-cycle measurements and remote four-platform CI remain unproven. No budget has been relaxed. No commit, push, or release has been performed.
