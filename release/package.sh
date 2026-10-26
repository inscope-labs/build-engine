#!/usr/bin/env bash
# package.sh [OUTDIR] - build the release artifact from template/ using ONLY release/manifest.txt.
# Output: OUTDIR/build-engine-vX.Y.Z.tar.gz and .sha256 (default OUTDIR: dist/). Deterministic: same tree, same bytes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/template"
OUT="${1:-$ROOT/dist}"
die() { echo "package: $*" >&2; exit 1; }

VERSION="$(tr -d ' \r\n' < "$ROOT/VERSION")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "VERSION must be X.Y.Z, got '$VERSION'"
NAME="build-engine-v$VERSION.tar.gz"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"; mkdir -p "$STAGE"
: > "$WORK/files"; : > "$WORK/modes"

# 1. expand the allowlist into an explicit file list
while read -r mode path; do
  [[ -z "${mode:-}" || "$mode" == \#* ]] && continue
  [[ "$mode" == managed || "$mode" == seed ]] || die "manifest: bad mode '$mode' (managed|seed)"
  [[ -n "${path:-}" && "$path" != /* && "$path" != *..* ]] || die "manifest: bad path '$path'"
  [[ -e "$TPL/$path" ]] || die "manifest lists '$path' but template/$path does not exist"
  if [[ -d "$TPL/$path" ]]; then
    [[ "$mode" == managed ]] || die "manifest: seed entries must be files ('$path')"
    [[ -z "$(find "$TPL/$path" -type l -print -quit)" ]] || die "symlink under template/$path (not allowed)"
    (cd "$TPL" && find "$path" -type f ! -path '*/__pycache__/*' ! -name '*.pyc' -print) | while read -r f; do printf '%s %s\n' "$mode" "$f"; done >> "$WORK/modes"
  else
    [[ ! -L "$TPL/$path" ]] || die "symlink template/$path (not allowed)"
    printf '%s %s\n' "$mode" "$path" >> "$WORK/modes"
  fi
done < "$ROOT/release/manifest.txt"
LC_ALL=C sort -u -k2 "$WORK/modes" -o "$WORK/modes"
[[ -s "$WORK/modes" ]] || die "manifest expanded to nothing"
awk '{ $1=""; sub(/^ /,""); print }' "$WORK/modes" > "$WORK/files"
[[ "$(sort "$WORK/files" | uniq -d | wc -l)" -eq 0 ]] || die "a path is listed as both managed and seed"

# 2. stage exactly those files, then write the release manifest (hash + mode per file)
tar -C "$TPL" -cf - -T "$WORK/files" | tar -C "$STAGE" -xf -
mkdir -p "$STAGE/engine"
{
  echo "# build-engine release manifest"
  echo "# version $VERSION"
  echo "# <sha256> <managed|seed> <path>"
  while read -r mode path; do
    printf '%s %s %s\n' "$(sha256sum "$STAGE/$path" | cut -d' ' -f1)" "$mode" "$path"
  done < "$WORK/modes"
} > "$STAGE/engine/RELEASE-MANIFEST"

# 3. deterministic tarball (no wrapper directory: it unpacks at a repository root)
(cd "$STAGE" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) > "$WORK/all"
mkdir -p "$OUT"
tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner --format=gnu \
    -C "$STAGE" -cf - -T "$WORK/all" | gzip -n -9 > "$OUT/$NAME"
(cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256")
echo "$OUT/$NAME"
