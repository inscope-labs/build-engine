#!/usr/bin/env bash
# package.sh [OUTDIR] - build the release artifact from template/ using ONLY release/manifest.txt.
#
# Output: OUTDIR/build-engine-vX.Y.Z.tar.gz and OUTDIR/build-engine-vX.Y.Z.tar.gz.sha256
#         (default OUTDIR: dist/).
#
# What this script guarantees (Stage 3.1):
#   - The artifact holds exactly the tracked files the allowlist covers, and nothing else. An
#     untracked or locally modified file under template/ (or a modified manifest) fails the build
#     instead of shipping whatever the working tree happens to hold.
#   - Every manifest line is validated: a managed|seed mode, a plain relative path, no traversal,
#     no whitespace, a target that exists, and no duplicate, case-folded or mode-conflicting entry.
#   - Only regular files are packaged. Symlinks, devices, sockets and fifos are refused.
#   - A tracked generated file (a .pyc, a node_modules tree, a .env, an archive) is refused, not
#     silently dropped.
#   - Modes are normalised (0644, or 0755 for a file whose git index mode is 100755), so the
#     builder's umask cannot change a single byte of the artifact.
#   - The output directory may not sit inside the packaged tree, and the artifact is written
#     atomically: a failed build never leaves a file that looks like a finished artifact.
#
# Requires bash >= 4, GNU coreutils and tar, and git.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/template"
MANIFEST="$ROOT/release/manifest.txt"
OUT="${1:-$ROOT/dist}"
die() { echo "package: $*" >&2; exit 1; }
note() { echo "package: $*" >&2; }

# ---------------------------------------------------------------- preflight
command -v git >/dev/null 2>&1 || die "git is required: the artifact is built from the tracked file list"
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "not inside a git checkout: the artifact is built from the tracked file list"
[[ -d "$TPL" ]] || die "template/ not found at $TPL"
[[ -f "$MANIFEST" ]] || die "release/manifest.txt not found at $MANIFEST"

VERSION="$(tr -d ' \r\n' < "$ROOT/VERSION")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "VERSION must be X.Y.Z, got '$VERSION'"
NAME="build-engine-v$VERSION.tar.gz"

# The output directory must exist before it can be checked against the packaged tree.
mkdir -p "$OUT"
OUT_ABS="$(cd "$OUT" && pwd -P)"
TPL_ABS="$(cd "$TPL" && pwd -P)"
case "$OUT_ABS/" in
  "$TPL_ABS/"*) die "the output directory ($OUT_ABS) is inside the packaged tree ($TPL_ABS): the artifact would be packaged into itself" ;;
esac

# Any artifact left in the output directory is from an earlier build. Remove it first, so a
# failed build can never leave a file that looks like the current output.
rm -f "$OUT_ABS/$NAME" "$OUT_ABS/$NAME.sha256"

WORK="$(mktemp -d)"
TMP_OUT=""
cleanup() { [[ -n "$TMP_OUT" ]] && rm -f "$TMP_OUT"; rm -rf "$WORK"; }
trap cleanup EXIT

# ---------------------------------------------------------------- the tree must be clean
DIRTY="$(git -C "$ROOT" status --porcelain -- template release/manifest.txt 2>/dev/null || true)"
if [[ -n "$DIRTY" ]]; then
  note "the template tree and the manifest must be committed and clean:"
  printf '%s\n' "$DIRTY" | sed 's/^/  /' >&2
  die "refusing to package a dirty tree (commit or remove the files above)"
fi

# ---------------------------------------------------------------- the tracked file list
# One git call, then everything downstream works from this list: no file that git does not track
# can enter the artifact, whatever the working tree holds.
: > "$WORK/tracked"          # <git mode> TAB <path relative to template/>
while IFS=$'\t' read -r meta tpath; do
  [[ -n "${tpath:-}" ]] || continue
  printf '%s\t%s\n' "${meta%% *}" "${tpath#template/}" >> "$WORK/tracked"
done < <(git -C "$ROOT" ls-files -s -- template/)
LC_ALL=C sort -k2 "$WORK/tracked" -o "$WORK/tracked"
[[ -s "$WORK/tracked" ]] || die "git tracks no file under template/"

# ---------------------------------------------------------------- manifest validation
declare -A DECL_MODE=()        # path -> declared mode
declare -A DECL_FOLDED=()      # case-folded path -> declared path
lineno=0
while IFS= read -r raw || [[ -n "$raw" ]]; do
  lineno=$((lineno + 1))
  raw="${raw%$'\r'}"
  trimmed="${raw#"${raw%%[![:space:]]*}"}"
  [[ -z "$trimmed" || "${trimmed:0:1}" == "#" ]] && continue

  read -r mode path <<< "$trimmed"
  [[ -n "${mode:-}" && -n "${path:-}" ]] || die "manifest line $lineno: expected '<managed|seed> <path>'"
  [[ "$mode" == managed || "$mode" == seed ]] || die "manifest line $lineno: mode must be 'managed' or 'seed', got '$mode'"
  [[ "$path" != /* ]] || die "manifest line $lineno: absolute path '$path' is not allowed"
  [[ "$path" != *[[:space:]]* ]] || die "manifest line $lineno: path '$path' contains whitespace"

  # Every component of a manifest path is checked on its own: an empty component, a '.' and a
  # '..' are each refused.
  IFS='/' read -r -a parts <<< "$path"
  for part in "${parts[@]}"; do
    [[ -n "$part" ]] || die "manifest line $lineno: path '$path' has an empty component"
    [[ "$part" != "." && "$part" != ".." ]] || die "manifest line $lineno: path '$path' has a '$part' component"
  done
  # F0-016: the substring rule below is deliberately stricter than the component rule above. It can
  # only be relaxed together with verify.sh and update.sh (Stage 3.2.2 / 2.4), otherwise packaging
  # would produce an artifact that the verifier refuses.
  [[ "$path" != *..* ]] || die "manifest line $lineno: path '$path' contains '..' (F0-016, relaxed in Stage 3.2.2)"

  if [[ -n "${DECL_MODE[$path]:-}" ]]; then
    [[ "${DECL_MODE[$path]}" == "$mode" ]] \
      || die "manifest line $lineno: '$path' is declared as '${DECL_MODE[$path]}' and as '$mode' (a path may not be both managed and seed)"
    die "manifest line $lineno: '$path' is declared twice"
  fi
  folded="${path,,}"
  if [[ -n "${DECL_FOLDED[$folded]:-}" ]]; then
    die "manifest line $lineno: '$path' collides with '${DECL_FOLDED[$folded]}' under case folding (the artifact must install on a case-insensitive filesystem)"
  fi
  DECL_MODE["$path"]="$mode"
  DECL_FOLDED["$folded"]="$path"
done < "$MANIFEST"
[[ "${#DECL_MODE[@]}" -gt 0 ]] || die "the manifest declares no files"

# ---------------------------------------------------------------- manifest resolution
# A path must exist and must be of the kind its mode allows. A managed entry may be a directory
# (it then covers everything tracked beneath it); a seed entry is always a single file.
for path in "${!DECL_MODE[@]}"; do
  mode="${DECL_MODE[$path]}"
  target="$TPL/$path"
  if [[ -L "$target" ]]; then
    die "manifest lists '$path', which is a symlink (only regular files are packaged)"
  elif [[ -d "$target" ]]; then
    [[ "$mode" == managed ]] || die "manifest: seed entries must be files ('$path')"
  elif [[ -f "$target" ]]; then
    :
  else
    die "manifest lists '$path' but template/$path does not exist"
  fi
done

# ---------------------------------------------------------------- expansion
# The expansion is the set of tracked files the allowlist covers. Every file ends up with exactly
# one mode: a file covered by two entries with different modes is a conflict and is refused.
: > "$WORK/modes"             # <managed|seed> <path relative to template/>
declare -A FILE_MODE=()
add_file() {                 # $1 = mode, $2 = path relative to template/
  local mode="$1" path="$2" prev
  if [[ -n "${FILE_MODE[$path]:-}" ]]; then
    [[ "${FILE_MODE[$path]}" == "$mode" ]] \
      || die "'$path' is covered by the allowlist as both '${FILE_MODE[$path]}' and '$mode'"
    return 0
  fi
  FILE_MODE["$path"]="$mode"
  printf '%s %s\n' "$mode" "$path" >> "$WORK/modes"
}

for path in "${!DECL_MODE[@]}"; do
  mode="${DECL_MODE[$path]}"
  if [[ -d "$TPL/$path" ]]; then
    while IFS=$'\t' read -r gmode rel; do
      [[ -n "${rel:-}" ]] || continue
      [[ "$rel" == "$path"/* ]] || continue
      add_file "$mode" "$rel"
    done < "$WORK/tracked"
  else
    gmode=""
    while IFS=$'\t' read -r gm rel; do
      [[ "${rel:-}" == "$path" ]] && gmode="$gm"
    done < "$WORK/tracked"
    [[ -n "$gmode" ]] || die "manifest lists '$path' but it is not tracked by git (commit it, or remove the line)"
    add_file "$mode" "$path"
  fi
done
[[ -s "$WORK/modes" ]] || die "the manifest expanded to no files"
LC_ALL=C sort -k2 "$WORK/modes" -o "$WORK/modes"

# ---------------------------------------------------------------- per-file checks
# Only regular files are packaged, and a file that should not exist in a consumer artifact is
# refused rather than quietly left out.
is_generated() {
  case "$1" in
    */__pycache__/*|__pycache__/*) return 0 ;;
    *.pyc|*.pyo) return 0 ;;
    */node_modules/*|node_modules/*) return 0 ;;
    .env|.env.*) return 0 ;;
    *.pat|*.token|*.pem|*.key|*.p12) return 0 ;;
    *.tar|*.tar.gz|*.tgz|*.zip|*.whl) return 0 ;;
    .git|.git/*|*/.git/*) return 0 ;;
    .DS_Store|*~|*.orig|*.rej|*.swp) return 0 ;;
  esac
  return 1
}
declare -A GIT_MODE=()
while IFS=$'\t' read -r gmode rel; do
  [[ -n "${rel:-}" ]] || continue
  GIT_MODE["$rel"]="$gmode"
done < "$WORK/tracked"

while read -r mode rel; do
  [[ -n "${rel:-}" ]] || continue
  src="$TPL/$rel"
  [[ -L "$src" ]] && die "'$rel' is a symlink (only regular files are packaged)"
  [[ -f "$src" ]] || die "'$rel' is not a regular file (only regular files are packaged)"
  is_generated "$rel" && die "'$rel' is a generated or local file and must not be tracked in template/ (remove it from git, or from the allowlist)"
done < "$WORK/modes"

# ---------------------------------------------------------------- staging
# Modes are set explicitly: the artifact's bytes must not depend on the builder's umask.
STAGE="$WORK/stage"; mkdir -p "$STAGE"
while read -r mode rel; do
  [[ -n "${rel:-}" ]] || continue
  dst="$STAGE/$rel"
  mkdir -p "$(dirname "$dst")"
  cp "$TPL/$rel" "$dst"
  if [[ "${GIT_MODE[$rel]:-}" == 100755 ]]; then chmod 0755 "$dst"; else chmod 0644 "$dst"; fi
done < "$WORK/modes"

# ---------------------------------------------------------------- the release manifest
# One line per packaged file: the sha256 of the file, its ownership mode and its path. The file
# count and the path set are checked against the staged tree, so the manifest can never describe
# something other than what is in the artifact.
mkdir -p "$STAGE/engine"
{
  echo "# build-engine release manifest"
  echo "# version $VERSION"
  echo "# <sha256> <managed|seed> <path>"
  while read -r mode rel; do
    printf '%s %s %s\n' "$(sha256sum "$STAGE/$rel" | cut -d' ' -f1)" "$mode" "$rel"
  done < "$WORK/modes"
} > "$STAGE/engine/RELEASE-MANIFEST"
chmod 0644 "$STAGE/engine/RELEASE-MANIFEST"

grep -v '^#' "$STAGE/engine/RELEASE-MANIFEST" | awk '{print $3}' | LC_ALL=C sort > "$WORK/rm_paths"
(cd "$STAGE" && find . -type f | sed 's|^\./||' | grep -v '^engine/RELEASE-MANIFEST$') | LC_ALL=C sort > "$WORK/staged_paths"
cmp -s "$WORK/rm_paths" "$WORK/staged_paths" \
  || die "internal error: the release manifest and the staged files do not describe the same set"
[[ "$(wc -l < "$WORK/rm_paths")" -eq "$(wc -l < "$WORK/staged_paths")" ]] \
  || die "internal error: the release manifest lists $(wc -l < "$WORK/rm_paths") files but $(wc -l < "$WORK/staged_paths") were staged"

# ---------------------------------------------------------------- the artifact
# The file list is sorted, the mtime is fixed, the owner is fixed and the gzip header carries no
# name or timestamp: the same commit produces the same bytes everywhere.
(cd "$STAGE" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) > "$WORK/all"
TMP_OUT="$OUT_ABS/.$NAME.tmp"
tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner --format=gnu \
    -C "$STAGE" -cf - -T "$WORK/all" | gzip -n -9 > "$TMP_OUT"
mv -f "$TMP_OUT" "$OUT_ABS/$NAME"
TMP_OUT=""
(cd "$OUT_ABS" && sha256sum "$NAME" > ".$NAME.sha256.tmp" && chmod 0644 ".$NAME.sha256.tmp" && mv -f ".$NAME.sha256.tmp" "$NAME.sha256")

note "packaged $(wc -l < "$WORK/rm_paths") files, $VERSION"
echo "$OUT/$NAME"
