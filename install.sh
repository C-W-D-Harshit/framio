#!/bin/sh
# Framio installer: curl -fsSL https://raw.githubusercontent.com/C-W-D-Harshit/framio/main/install.sh | sh
# Env overrides: FRAMIO_VERSION (tag, default latest), FRAMIO_INSTALL (default ~/.framio), FRAMIO_REPO,
# FRAMIO_DOWNLOAD_URL (directory holding the release tarballs, for mirrors and testing).
set -eu

REPO="${FRAMIO_REPO:-C-W-D-Harshit/framio}"
VERSION="${FRAMIO_VERSION:-latest}"
INSTALL_ROOT="${FRAMIO_INSTALL:-$HOME/.framio}"
BIN_DIR="$INSTALL_ROOT/bin"

fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "framio supports macOS and Linux (got $(uname -s))." ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported CPU architecture $(uname -m)." ;;
esac

# An x64 shell under Rosetta on Apple Silicon should still get the native binary.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi

asset="framio-$os-$arch.tar.gz"
if [ -n "${FRAMIO_DOWNLOAD_URL:-}" ]; then
  url="$FRAMIO_DOWNLOAD_URL/$asset"
elif [ "$VERSION" = latest ]; then
  url="https://github.com/$REPO/releases/latest/download/$asset"
else
  url="https://github.com/$REPO/releases/download/$VERSION/$asset"
fi

command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading framio (%s-%s)…\n' "$os" "$arch"
curl --fail --location --progress-bar "$url" -o "$tmp/$asset" || fail "download failed: $url"
tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$BIN_DIR"
mv "$tmp/framio-$os-$arch" "$BIN_DIR/framio"
chmod +x "$BIN_DIR/framio"

printf 'Installed framio %s to %s\n' "$("$BIN_DIR/framio" --version)" "$BIN_DIR/framio"

case ":$PATH:" in
  *":$BIN_DIR:"*) on_path=1 ;;
  *) on_path=0 ;;
esac

if [ "$on_path" = 0 ]; then
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc="$HOME/.zshrc"; line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
    bash) rc="$HOME/.bashrc"; [ "$os" = darwin ] && rc="$HOME/.bash_profile"; line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
    fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path \"$BIN_DIR\"" ;;
    *) rc=""; line="" ;;
  esac
  if [ -n "$rc" ]; then
    mkdir -p "$(dirname "$rc")"
    grep -qsF "$BIN_DIR" "$rc" || printf '\n# framio\n%s\n' "$line" >>"$rc"
    printf 'Added %s to PATH in %s. Open a new terminal, or run:\n  %s\n' "$BIN_DIR" "$rc" "$line"
  else
    printf 'Add %s to your PATH to use framio.\n' "$BIN_DIR"
  fi
fi

printf '\nGet started:\n  cd your-project\n  framio init\n  framio start\n'
