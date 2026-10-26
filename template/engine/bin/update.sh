#!/usr/bin/env bash
# update.sh - install or update the build-engine release payload in THIS repository.
#
#   update.sh [--version X.Y.Z] [--repo OWNER/build-engine] [--from-dir DIR] [--root DIR] [--dry-run] [--force]
#
# Downloads the release (gh), verifies its checksum and its release manifest, then replaces the managed files.
# - Managed files are vendored: they are replaced as a set, never hand-edited. A locally changed or unrecorded
#   managed file is a conflict: nothing is touched unless --force (review the result with git diff).
# - Seed files (engine/engine.json) are installed only when absent and never overwritten.
# - Files that an older release shipped and this one dropped are removed (if unmodified).
# - State is kept in .build-engine.lock at the repository root. Nothing is committed for you.
#
# First install (no update.sh yet):
#   gh release download vX.Y.Z -R OWNER/build-engine -D /tmp/be
#   tar -xzf /tmp/be/build-engine-vX.Y.Z.tar.gz -O engine/bin/update.sh > /tmp/update.sh
#   bash /tmp/update.sh --from-dir /tmp/be --version X.Y.Z --repo OWNER/build-engine
set -euo pipefail
LOCK=".build-engine.lock"
die() { echo "update: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

ROOT="" VERSION="" REPO="" FROM_DIR="" FORCE=0 DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?}"; shift 2 ;;
    --repo) REPO="${2:?}"; shift 2 ;;
    --from-dir) FROM_DIR="${2:?}"; shift 2 ;;
    --root) ROOT="${2:?}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 2 ;;
  esac
done
VERSION="${VERSION#v}"
[[ -z "$VERSION" || "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "bad --version '$VERSION'"
command -v sha256sum >/dev/null || die "sha256sum not found (pkg install coreutils)"

[[ -n "$ROOT" ]] || ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository (use --root DIR)"
cd "$ROOT"

# --- state from the previous install
declare -A OLD=()
LOCK_REPO="" LOCK_VERSION=""
if [[ -f "$LOCK" ]]; then
  while read -r k a b; do
    case "$k" in
      repo=*) LOCK_REPO="${k#repo=}" ;;
      version=*) LOCK_VERSION="${k#version=}" ;;
      file) OLD["$b"]="$a" ;;
    esac
  done < "$LOCK"
fi
[[ -n "$REPO" ]] || REPO="${BUILD_ENGINE_REPO:-$LOCK_REPO}"

# --- fetch
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/dl" "$WORK/x"
if [[ -n "$FROM_DIR" ]]; then
  if [[ -z "$VERSION" ]]; then
    n="$(ls "$FROM_DIR"/build-engine-v*.tar.gz 2>/dev/null | wc -l)"
    [[ "$n" -eq 1 ]] || die "--from-dir holds $n artifacts; pass --version"
    VERSION="$(basename "$(ls "$FROM_DIR"/build-engine-v*.tar.gz)" | sed -E 's/^build-engine-v(.*)\.tar\.gz$/\1/')"
  fi
  cp "$FROM_DIR/build-engine-v$VERSION.tar.gz" "$FROM_DIR/build-engine-v$VERSION.tar.gz.sha256" "$WORK/dl/" || die "artifact v$VERSION not found in $FROM_DIR"
else
  [[ -n "$REPO" ]] || die "no source: pass --repo OWNER/build-engine (or set BUILD_ENGINE_REPO)"
  command -v gh >/dev/null || die "gh not found (pkg install gh && gh auth login)"
  if [[ -z "$VERSION" ]]; then VERSION="$(gh release view -R "$REPO" --json tagName -q .tagName)"; VERSION="${VERSION#v}"; fi
  gh release download "v$VERSION" -R "$REPO" -D "$WORK/dl" -p "build-engine-v$VERSION.tar.gz" -p "build-engine-v$VERSION.tar.gz.sha256" >/dev/null
fi
NAME="build-engine-v$VERSION.tar.gz"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "bad version '$VERSION'"

# --- verify before anything is unpacked into the repository
(cd "$WORK/dl" && sha256sum -c "$NAME.sha256" >/dev/null) || die "checksum mismatch for $NAME: refusing"
while read -r line; do [[ "${line:0:1}" == "-" ]] || die "artifact contains a non-regular entry: refusing"; done < <(tar -tvzf "$WORK/dl/$NAME")
while read -r n; do [[ "$n" != /* && "$n" != *..* ]] || die "artifact has an unsafe path ($n): refusing"; done < <(tar -tzf "$WORK/dl/$NAME")
tar -xzf "$WORK/dl/$NAME" -C "$WORK/x" --no-same-owner
RM="$WORK/x/engine/RELEASE-MANIFEST"; [[ -f "$RM" ]] || die "artifact has no engine/RELEASE-MANIFEST"
declare -A NEW=() MODE=()
while read -r sha mode path; do
  [[ -z "${sha:-}" || "$sha" == \#* ]] && continue
  [[ "$path" != /* && "$path" != *..* ]] || die "manifest has an unsafe path: $path"
  [[ -f "$WORK/x/$path" && "$(sha256sum "$WORK/x/$path" | cut -d' ' -f1)" == "$sha" ]] || die "manifest does not match the artifact: $path"
  NEW["$path"]="$sha"; MODE["$path"]="$mode"
done < "$RM"
while read -r n; do [[ "$n" == engine/RELEASE-MANIFEST || -n "${NEW[$n]:-}" ]] || die "file not in the release manifest: $n"; done < <(cd "$WORK/x" && find . -type f | sed 's|^\./||')

# --- plan
# (arrays are expanded with the ${A[@]+"${A[@]}"} form so an empty one is safe under set -u on older bash)
ADD=() UPD=() SAME=() KEEP=() DEL=() CONFLICT=() FORCE_COPY=() FORCE_DEL=()
for p in "${!NEW[@]}"; do
  if [[ "${MODE[$p]}" == seed ]]; then
    if [[ -e "$p" ]]; then KEEP+=("$p"); else ADD+=("$p"); fi; continue
  fi
  if [[ ! -e "$p" ]]; then ADD+=("$p"); continue; fi
  cur="$(sha256sum "$p" | cut -d' ' -f1)"
  if [[ "$cur" == "${NEW[$p]}" ]]; then SAME+=("$p")
  elif [[ -n "${OLD[$p]:-}" && "$cur" == "${OLD[$p]}" ]]; then UPD+=("$p")
  elif [[ -n "${OLD[$p]:-}" ]]; then CONFLICT+=("$p (edited locally since the last install)"); FORCE_COPY+=("$p")
  else CONFLICT+=("$p (exists but was not installed by update.sh)"); FORCE_COPY+=("$p"); fi
done
for p in "${!OLD[@]}"; do
  [[ -n "${NEW[$p]:-}" && "${MODE[$p]}" == managed ]] && continue   # still shipped
  [[ -n "${NEW[$p]:-}" ]] && continue                                 # became a seed file: leave it alone
  [[ -e "$p" ]] || continue
  if [[ "$(sha256sum "$p" | cut -d' ' -f1)" == "${OLD[$p]}" ]]; then DEL+=("$p")
  else CONFLICT+=("$p (dropped by this release, but edited locally)"); FORCE_DEL+=("$p"); fi
done

echo "build-engine ${LOCK_VERSION:+$LOCK_VERSION -> }$VERSION: add ${#ADD[@]}, update ${#UPD[@]}, unchanged ${#SAME[@]}, remove ${#DEL[@]}, kept seed ${#KEEP[@]}"
if [[ ${#CONFLICT[@]} -gt 0 ]]; then
  printf 'conflict: %s\n' "${CONFLICT[@]}" | LC_ALL=C sort >&2
  [[ $FORCE -eq 1 ]] || die "conflicts above: nothing was changed (re-run with --force to overwrite, then review with git diff)"
fi
if [[ $DRY -eq 1 ]]; then
  for p in ${ADD[@]+"${ADD[@]}"}; do echo "  + $p"; done
  for p in ${UPD[@]+"${UPD[@]}"} ${FORCE_COPY[@]+"${FORCE_COPY[@]}"}; do echo "  ~ $p"; done
  for p in ${DEL[@]+"${DEL[@]}"} ${FORCE_DEL[@]+"${FORCE_DEL[@]}"}; do echo "  - $p"; done
  echo "dry run: nothing changed"; exit 0
fi

# --- apply (only reached with no conflicts, or with --force)
for p in ${ADD[@]+"${ADD[@]}"} ${UPD[@]+"${UPD[@]}"} ${FORCE_COPY[@]+"${FORCE_COPY[@]}"}; do
  mkdir -p "$(dirname "$p")"; cp -p "$WORK/x/$p" "$p"
done
for p in ${DEL[@]+"${DEL[@]}"} ${FORCE_DEL[@]+"${FORCE_DEL[@]}"}; do
  rm -f "$p"; rmdir -p "$(dirname "$p")" 2>/dev/null || true
done

# --- record
{
  echo "repo=${REPO:--}"
  echo "version=$VERSION"
  echo "tarball_sha256=$(cut -d' ' -f1 "$WORK/dl/$NAME.sha256")"
  for p in $(printf '%s\n' "${!NEW[@]}" | LC_ALL=C sort); do
    [[ "${MODE[$p]}" == managed ]] && echo "file ${NEW[$p]} $p"
  done
} > "$LOCK.tmp" && mv "$LOCK.tmp" "$LOCK"
echo "installed build-engine $VERSION. Review with: git status && git diff. Commit it on a branch and open a pull request."
