# Effect architecture

This repository uses Effect TypeScript v4 internally. Before writing Effect code,
read `node_modules/effect/AGENTS.md` completely and follow its relevant links.
Resolve APIs against the installed `node_modules/effect/src` source.

Read `docs/effect-v4-implementation-plan.md` for ownership and migration sequencing.
Effect owns application services, concurrency, state transitions, errors, and
resource lifetimes. Keep third-party/native adapters narrow.

User designs stay ordinary React + Tailwind. Never add Effect dependencies or
imports to `src/scaffold`, generated design projects, or user frame entry modules.
Browser contracts must not import server implementations or Bun platform layers.

Use `bun run test:effect` for deterministic service tests and
`bun run test:integration` for actual Bun/process/compiler/browser tests.
Preserve existing dirty work and report local, browser, binary, and CI evidence
separately. Do not publish a release without a user delivery instruction.
