# Framio landing app

Minimal Astro app, built as static HTML and served by Cloudflare Workers Static Assets.
The landing page design is still to come.

## Development

From the repository root, using Bun 1.4.2 and Node.js 24 or newer:

```sh
bun install --frozen-lockfile
bun run dev:landing
bun run build:landing
bun run typecheck
```

## Cloudflare

Wrangler uses the account for `cwd.harshit911@gmail.com`, account ID
`72d2696f04ebb7cce691b7d29ca2590f`. The existing `framio.design` zone is active
in this account. `wrangler.jsonc` pins the account and configures `framio.design`
as the Worker's custom domain. Astro uses the same URL for its `site` setting.

Verify the local Wrangler login before deploying:

```sh
cd apps/landing
bunx wrangler whoami
```

If the email differs, run `bunx wrangler login` and sign in as
`cwd.harshit911@gmail.com`. Credentials stay in Wrangler's local configuration.
For CI, provide `CLOUDFLARE_API_TOKEN` with access to this account and zone.

Build and validate without publishing:

```sh
bun run build:landing
cd apps/landing
bun run deploy:dry-run
```

Deploy from the repository root:

```sh
bun run deploy:landing
```

Turbo builds the app before deploying. Deployment creates or updates the Worker
and attaches the configured custom domain. The landing starter is deployed at `https://framio.design`.
`bun run preview:worker` in this app serves the built assets locally with Wrangler.

## Installer

The landing build copies the repository root `install.sh` into its static output.
Turbo includes that source file in the build inputs so installer changes invalidate
the landing build cache. Update the root script and redeploy to publish changes.

```sh
curl -fsSL https://framio.design/install.sh | sh
```

The installer downloads CLI binaries from the existing GitHub releases.
