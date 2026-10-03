# Effect architecture

This repository uses Effect TypeScript v4 internally. Before writing Effect code,
read `apps/framio/node_modules/effect/AGENTS.md` completely and follow its relevant links.
Resolve APIs against the installed `apps/framio/node_modules/effect/src` source.

Effect owns application services, concurrency, state transitions, errors, and
resource lifetimes. Keep third-party/native adapters narrow.

User designs stay ordinary React + Tailwind. Never add Effect dependencies or
imports to `apps/framio/src/scaffold`, generated design projects, or user frame entry modules.
Browser contracts must not import server implementations or Bun platform layers.

Use `bun run test:effect` for deterministic service tests and
`bun run test:integration` for actual Bun/process/compiler/browser tests.
Preserve existing dirty work and report local, browser, binary, and CI evidence
separately. Do not publish a release without a user delivery instruction.

# Writing

Never use em dashes in anything you write here: UI strings, page titles, scaffold
content, docs, README, code comments, commit messages, and PR text. Use a period,
comma, or colon instead. Join a project name and "Framio" in titles with a middle
dot, for example `my-app · Framio`. Design copy rules for generated projects live in
`apps/framio/src/scaffold/skill/references/copy.md`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
