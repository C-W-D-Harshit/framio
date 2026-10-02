# Release notes

Before tagging a release, add `releases/v<package-version>.md`. The tag must match `apps/framio/package.json`.

Start with a human-written paragraph of at most 280 characters. Describe what users gain from this release. Put detailed changes after a blank line and a heading. The workflow publishes this file as the GitHub release body. The canvas reads its first paragraph as plain text.

If users need to update their project separately, add a paragraph beginning with `Project update required:` and give the actual steps. Do not imply that binary installation updates project skills, dependencies, themes, or designs.

Example:

```markdown
Framio can download an update while you keep designing. Install it when you are ready, then resume the same project at the same URL.

## Changes

- Added a shared updater for the canvas and CLI.
- Added executable rollback and restart recovery.
```

Release archives contain exactly one regular executable named `framio-<os>-<arch>`. The release includes `SHA256SUMS` covering every archive. Checksums verify integrity relative to the trusted GitHub release metadata. They do not independently authenticate the publisher.
