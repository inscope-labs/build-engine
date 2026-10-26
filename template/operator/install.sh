#!/usr/bin/env sh
# Install or update the operator script from the private <project>-dev repo (build-engine branch).
# Requires: gh (logged in with access to the private repo), git, jq.
# Usage: CBRIDGE_REPO=OWNER/PROJECT-dev sh install.sh
#   pkg install gh git jq unzip coreutils python
#   gh auth login
set -eu
REPO="${CBRIDGE_REPO:-OWNER/PROJECT-dev}"
case "$REPO" in OWNER/*) echo "set CBRIDGE_REPO to the private <project>-dev repo (owner/name)" >&2; exit 1 ;; esac
REF="build-engine"
BIN="${CBRIDGE_BIN:-$HOME/bin}"
CFG="${CBRIDGE_CONFIG_DIR:-$HOME/.config/cbridge}"

command -v gh >/dev/null 2>&1 || { echo "gh not found: pkg install gh && gh auth login" >&2; exit 1; }
mkdir -p "$BIN" "$CFG"

fetch() {  # fetch <path-in-repo> <dest>
  gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/$1?ref=$REF" > "$2.tmp"
  mv "$2.tmp" "$2"
}

fetch operator/cbridge "$BIN/cbridge"
chmod +x "$BIN/cbridge"
if [ ! -f "$CFG/config" ]; then
  fetch operator/cbridge.config.example "$CFG/config"
  chmod 600 "$CFG/config"
  echo "wrote $CFG/config (review it)"
else
  echo "kept existing $CFG/config"
fi
echo "installed $BIN/cbridge"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "add to PATH: export PATH=\"$BIN:\$PATH\"" ;; esac
echo "next: cbridge init && cbridge doctor"
