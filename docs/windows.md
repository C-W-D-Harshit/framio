# Windows support

Framio supports Windows x64 on Windows 10 version 1809 or later. Install from
PowerShell with `irm https://framio.design/install.ps1 | iex`. Windows ARM64 does
not have a native Framio release in this change.

The installer uses the same release tarballs and SHA256SUMS as the Unix installer.
The Windows archive is `framio-win32-x64.tar.gz` and contains
`framio-win32-x64.exe`. Installation uses `~/.framio/bin/framio.exe` and the user
PATH, without elevation. `FRAMIO_VERSION`, `FRAMIO_INSTALL`, `FRAMIO_REPO`, and
`FRAMIO_DOWNLOAD_URL` have the same meanings as in `install.sh`. The `-NoPath`
parameter skips PATH changes when invoking the downloaded script as a file.

## Compatibility research

- [Bun installation](https://bun.sh/docs/installation) requires Windows 10 1809
  or later. [Standalone executables](https://bun.sh/docs/bundler/executables)
  support Windows targets and use an `.exe` suffix.
- [Node child processes](https://nodejs.org/api/child_process.html) require a
  command interpreter for `.cmd` files. Framio invokes npm's Node entry point
  directly for registry installation and gives shadcn a `bun.cmd` adapter.
- [Node process signals](https://nodejs.org/api/process.html#signal-events) do
  not provide Unix SIGTERM shutdown on Windows. `framio stop` verifies the
  server's identity, writes a local stop request, and lets Effect close the
  server scope. Temporary server cleanup terminates the owned process tree if
  it must force termination.
- Windows locks loaded executables against overwrites. Installation and updates
  rename the old image before publishing the verified replacement. Running
  canvases keep their existing image until restart. The updater retains
  `previous.exe` for rollback. Old images still in use are removed on a later
  update once Windows releases them.

## Verification

The Windows PR check and release job run typechecking, all deterministic Effect
service tests, native executable and archive tests, and compiled smoke checks.
The smoke checks cover a custom install path with spaces, checksum refusal,
standalone package installation, registry files and dependencies, background
server reuse, Chrome screenshots and layer sources, watched edits, graceful
shutdown, installation while a canvas is running, shared updater state, and
rollback.

The existing integration suite contains Unix shell fixtures. It continues to run
on Linux and macOS. Native Windows checks live in `tests/windows` and
`scripts/smoke-windows.py` rather than skipping those Unix fixtures silently.
