#!/bin/sh
# Framio installer: curl -fsSL https://framio.design/install.sh | sh
# Env overrides: FRAMIO_VERSION (tag, default latest), FRAMIO_INSTALL (default ~/.framio), FRAMIO_REPO,
# FRAMIO_DOWNLOAD_URL (directory holding the release tarballs, for mirrors and testing).
# NO_COLOR disables styling. CI and redirected output use plain task lines.
set -eu

REPO="${FRAMIO_REPO:-C-W-D-Harshit/framio}"
VERSION="${FRAMIO_VERSION:-latest}"
INSTALL_ROOT="${FRAMIO_INSTALL:-$HOME/.framio}"
BIN_DIR="$INSTALL_ROOT/bin"

interactive=0
if [ -t 1 ] && [ "${TERM:-}" != dumb ] && [ -z "${CI:-}" ]; then interactive=1; fi
accent=''; green=''; red=''; dim=''; bold=''; reset=''
if [ "$interactive" = 1 ] && [ "${NO_COLOR+x}" != x ]; then
  accent="$(printf '\033[94m')"; green="$(printf '\033[32m')"; red="$(printf '\033[31m')"
  dim="$(printf '\033[2m')"; bold="$(printf '\033[1m')"; reset="$(printf '\033[0m')"
fi
fail() { printf '  %serror:%s %s\n' "$red" "$reset" "$1" >&2; exit 1; }
done_step() { printf '  %s+%s %s\n' "$green" "$reset" "$1"; }
display_path() {
  case "$1" in
    "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

if [ "$interactive" = 1 ]; then
  printf '\n  %s+--- []%s\n  %s| +--%s   %sframio%s\n  %s| |%s     %sA design canvas for coding agents%s\n\n' "$accent" "$reset" "$accent" "$reset" "$bold" "$reset" "$accent" "$reset" "$dim" "$reset"
else
  printf '\n  framio installer\n\n'
fi

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

if [ "$os" = darwin ] && [ "$arch" != arm64 ]; then
  fail "No Framio release is available for this platform."
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
done_step "Platform  $os / $arch"

tmp="$(mktemp -d)" || fail 'Could not create a temporary download directory.'
trap 'rm -rf "$tmp"' EXIT
trap 'printf "  Installation cancelled.\n" >&2; exit 130' INT
trap 'printf "  Installation cancelled.\n" >&2; exit 143' TERM

printf '  %s>%s Download  %s\n' "$accent" "$reset" "$VERSION"
if [ "$interactive" = 1 ] && [ -t 2 ]; then
  curl --fail --location --progress-bar "$url" -o "$tmp/$asset" || fail "Download failed. Retry the installer. Source: $url"
else
  curl --fail --location --silent --show-error "$url" -o "$tmp/$asset" || fail "Download failed. Retry the installer. Source: $url"
fi
done_step 'Download  Complete'
tar -xzf "$tmp/$asset" -C "$tmp" || fail 'Could not extract the release archive. Retry the installer.'
downloaded="$tmp/framio-$os-$arch"
[ -f "$downloaded" ] || fail 'The release archive does not contain the Framio executable.'
chmod +x "$downloaded" || fail 'Could not make Framio executable.'
release_version="$("$downloaded" --version)" || fail 'The downloaded Framio executable could not run on this machine.'
mkdir -p "$BIN_DIR" || fail "Could not create $BIN_DIR. Check directory permissions."
mv "$downloaded" "$BIN_DIR/framio" || fail "Could not install Framio in $BIN_DIR. Check directory permissions."

done_step "Install   $release_version at $(display_path "$BIN_DIR/framio")"

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
    # Only the generated shell command counts, not comments or unrelated path mentions.
    if grep -qsFx "$line" "$rc"; then
      done_step "Shell     PATH already configured in $(display_path "$rc")"
    else
      printf '\n# framio\n%s\n' "$line" >>"$rc" || fail "Could not update $rc. Add $BIN_DIR to PATH manually."
      done_step "Shell     Updated $(display_path "$rc")"
    fi
    printf '\n  Open a new terminal, or run:\n\n    %s\n' "$line"
  else
    printf '\n  Add %s to your PATH to use framio.\n' "$BIN_DIR"
  fi
fi

printf '\n  %sInstalled successfully.%s\n\n  Get started in your project:\n\n    cd your-project\n    framio init\n    framio start\n\n' "$bold" "$reset"
