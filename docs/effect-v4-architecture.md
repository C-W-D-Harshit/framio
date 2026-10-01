# Framio internal Effect v4 architecture

Framio uses Effect 4.0.0 for its own CLI, server, capture services, browser application state, and injected runtime. Generated designs remain ordinary React and Tailwind. No Effect package, import, setup step, or service declaration is added to a user's project. Scaffold hashes are checked against `effect-v4-baseline.json`.

## Development

Use Bun 1.4.2 or newer and Node 24 or newer for development. The pinned toolchain is also used by validation and release workflows. A compiled binary embeds Bun and works without an external Node/Bun runtime on PATH.

```sh
bun install --frozen-lockfile
bun run build:ui
bun run check
bun run build:binary
python3 scripts/smoke-binary.py dist/bin/framio-darwin-arm64
```

Use the filename for your platform for the final command. `test:effect` uses Vitest and `@effect/vitest` for service scheduling/resource tests. `test:integration` uses Bun for filesystem watching, process lifecycle, compiler output, RPC, and real Chromium rendering. Chromium is downloaded on first use; test prerequisites are distinct from runtime regressions.

Read the installed `node_modules/effect/AGENTS.md` before changing Effect code. Resolve v4 APIs against installed source. There are no patched Effect dependencies.

## Ownership

| Owner | Responsibilities and lifetime |
| --- | --- |
| `src/cli.ts`, `commands/command-tree.ts` | One CLI root runtime, Effect CLI parsing, lazy public command construction, schema-validated internal server dispatch |
| `ServerRegistry` | Health and protocol validation, identity-checked stop, exclusive scoped locks, stale-owner recovery, scoped registration |
| `ServerLauncher` | Borrowed server versus owned temporary, foreground, and detached background processes; only owned processes are cleaned up |
| `server-application.ts` | Canonical root, lock, initial build, HTTP readiness, registration, optional browser launch, shutdown |
| `BuildCoordinator` | Accumulated file changes, serialized publication, capture barrier, generation leases |
| `ProjectState` | Immutable generation publication through SubscriptionRef, frame/theme diagnostics, bounded old assets and staged image bytes |
| `server/server.ts` | Bun HTTP server, schema-first HttpApi handlers, versioned static assets, scoped streaming RPC and upgraded sockets |
| `capture-resources.ts` | RcRef Chromium reuse, page acquire/release, four page permits, disconnect invalidation, bounded cleanup |
| `screenshots.ts` | Stable-generation captures, visual-version thumbnail cache, page composition, atomic output writes |
| `ui/services/project-client.ts` | One scoped RPC connection, typed HTTP actions, sequenced persistence worker, connection and save-error state |
| `ui/state.ts` | Effect Atom runtime and canonical selection, tool, page, measured heights, optimistic moved positions |
| `runtime/runtime.ts` | Scoped iframe listeners and observers, readiness, status queue, version-aware CSS replacement, unload disposal |

Effect owns application workflows and resources directly. Promise conversion is confined to host libraries such as Puppeteer and Bun's compiler. React Flow continues to own pointer, viewport, and rendering mechanics.

## Limits and ordering

- Watch ingress holds 1024 events. Overflow requests a full scan. `.state` and `node_modules` do not feed rebuilds.
- Build wakeups coalesce, but filenames accumulate independently. A 60ms quiet window has a 500ms maximum wait.
- The screenshot barrier drains pending changes and pins the generation during capture. Frame source used by Bun's build plugin comes from the scan, keeping metadata and entry source consistent.
- At most two previous asset generations are retained, within a combined 32MiB budget. Source/image bytes remain internal and never enter browser snapshots.
- Chromium idles for five minutes through RcRef. Page captures have four permits. Thumbnail cache capacity is 128; concurrent callers share in-flight work and failures invalidate entries.
- Selection/canvas persistence coalesces for 150ms and runs sequentially. Canvas updates merge per page. Optimistic positions clear when matching server positions echo.
- Frame swaps time out after eight seconds. Readiness waits for root content, fonts, decoded images, and two animation frames, with a 20-second limit.
- CSS keeps the last good sheet while loading; superseded versions cannot commit, and failed/interrupted loads remove the candidate.
- Live RPC reconnects after one second and retains the last snapshot while disconnected. Exponential backoff/jitter is not implemented.
- Upgraded sockets close before RPC shutdown, with a five-second drain limit. Shutdown, locks, registry files, watchers, browser pages, and owned child processes have explicit finalizers.
- A diagnostic-file write failure logs and skips that write, preserving later writes. Watch failures log and retry after one second.

## Native adapters and bundle boundaries

`platform/server-child.ts` retains native process detachment and descriptor-backed logging. `platform/project-watch.ts` supplies bounded native watch ingress. `platform/chromium.ts` wraps Puppeteer operations with typed failures and cancellation/cleanup. Bun compiler plugins, image header inspection, metadata AST extraction, and screenshot HTML composition remain host integration or pure computation.

Embedded scaffold paths use Bun's virtual filesystem. `init` reads those bytes with `Bun.file` before writing with Effect FileSystem; node filesystem copy cannot read `/$bunfs` paths. The compiled smoke check compares every destination hash outside the checkout and verifies overwrite protection.

Canvas contracts import neither server implementations nor Bun platform services. The injected iframe runtime imports narrow core Effect/Schema modules and excludes RPC, React Atom, CLI, Chromium, and server services. User frame entry code has no Effect imports. Bundle size alone does not prove per-iframe memory cost.

## Compatibility changes

Frame metadata is parsed as literal data with Acorn rather than executed with `new Function`. Objects, arrays, primitive literals, signed numbers, and static template strings are supported. Calls, getters, spreads, computed keys, shorthand properties, and dynamic expressions produce a frame diagnostic. This deliberately changes previously executable metadata behavior and prevents discovery from executing metadata code.

The internal health/RPC protocol is `framio-v4-1`. A CLI command cannot borrow an older healthy server; it asks the user to stop and restart it. Stop checks root/PID identity without requiring the new protocol. Persisted canvas extra fields survive saves, and stale frame-status reports cannot override a newer build's state.

## Validation and remaining gates

Local macOS arm64 evidence on 2026-10-01:

- Typecheck, 11 deterministic Effect tests, and 24 Bun integration tests passed.
- Integration includes actual React/image PNG dimensions, temporary/borrowed process ownership, watched RPC generations, stale status rejection, metadata rejection, canvas extra-field preservation, CSS replacement ordering/failure, and safe stop of older protocol servers.
- UI and compiled binary builds passed. Compiled version/init work with Node/Bun absent from PATH; 79 scaffold/skill destinations are byte-identical to baseline.
- Final collaborative browser inspection showed two ready frames and a Live connection; a live source edit replaced the primary iframe at version3 while its variation remained at version2. Earlier checks exercised selection and tools. The task-owned UI server was stopped after inspection. This is not a complete drag/persistence/reconnect/disposal fault matrix.
- React Doctor previously reported 72 with no errors and seven component-complexity/callback warnings. This is diagnostic evidence, not a release gate.

The reproducible compiled comparison is in `effect-v4-performance.json`. It uses 13 samples after one excluded warmup, alternating startup order, a single React frame, isolated process state, and no Node/Bun on PATH. It measures committed snapshot rebuilds, not save-to-visible browser latency. RSS excludes Chromium and browser UI; warm RSS and cold capture are single observations.

Startup and idle server RSS exceed the proposed acceptance budgets. The latest rebuild median also exceeds the latency budget, although earlier samples passed; repeatable rebuild acceptance remains unresolved. Lazy CLI construction and narrow imports reduced unnecessary work but did not resolve these regressions. Further profiling must distinguish module/schema initialization, filesystem runtime costs, and retained service state. The budgets have not been changed. There are no measured canvas/per-iframe heap results or 10/50/100-frame distributions yet.

Remote CI has not run for this work. The four release targets remain unverified. Changes are local and uncommitted; no release has been requested or performed. Several broader audit and performance tasks in the implementation plan remain open, so the migration is not yet acceptance-complete.
