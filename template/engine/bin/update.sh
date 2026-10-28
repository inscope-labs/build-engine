#!/usr/bin/env bash
# update.sh - install or update the build-engine release payload in THIS repository.
#
#   update.sh [--version X.Y.Z] [--repo OWNER/build-engine] [--from-dir DIR] [--root DIR] [--dry-run] [--force] [--allow-downgrade]
#
# Downloads the release (gh), verifies its checksum and its release manifest, then replaces the managed files.
# - Managed files are vendored: they are replaced as a set, never hand-edited. A locally changed or unrecorded
#   managed file is a conflict: nothing is touched unless --force (review the result with git diff).
# - Seed files (engine/engine.json) are installed only when absent and never overwritten.
# - Files that an older release shipped and this one dropped are removed (if unmodified).
# - All or nothing: new files are staged first, every file about to change is backed up in .build-engine.txn/, and a
#   failure or interruption restores the previous state. If the process is killed, the next run recovers by itself.
# - Refuses: a damaged lock or manifest, an artifact whose contents are a different version, a downgrade (unless
#   --allow-downgrade), and any path that goes through a symlink or a non-directory.
# - State is kept in .build-engine.lock at the repository root. Nothing is committed, staged or pushed for you.
# - Requires bash 4.4+, GNU coreutils (sha256sum), tar, gzip, find and sed; gh only when downloading.
#   Supported on Linux and Termux. Not supported on macOS's stock bash 3.2.
#
# First install (no update.sh yet):
#   gh release download vX.Y.Z -R OWNER/build-engine -D /tmp/be
#   tar -xzf /tmp/be/build-engine-vX.Y.Z.tar.gz -O engine/bin/update.sh > /tmp/update.sh
#   bash /tmp/update.sh --from-dir /tmp/be --version X.Y.Z --repo OWNER/build-engine
#
# Test hooks (used only by tests/test_update_hardening.sh, never needed in normal use):
#   BUILD_ENGINE_TEST_INTERRUPT=fail:N|kill:N   stop after step N (fail = clean error, kill = SIGKILL)
#   BUILD_ENGINE_TEST_BASH_MAJOR=N              pretend to run on bash N
#   BUILD_ENGINE_TEST_CASE_INSENSITIVE=1        pretend the filesystem ignores case
set -euo pipefail
LOCK=".build-engine.lock"
TXN=".build-engine.txn"
die() { echo "update: $*" >&2; exit 1; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# --- preflight: refuse early, with a clear message, on an unsupported environment
if [[ -n "${BUILD_ENGINE_TEST_BASH_MAJOR:-}" ]]; then major="$BUILD_ENGINE_TEST_BASH_MAJOR" minor=0
else major="${BASH_VERSINFO[0]:-0}" minor="${BASH_VERSINFO[1]:-0}"; fi
if ! [[ "$major" =~ ^[0-9]+$ ]] || (( major < 4 || (major == 4 && minor < 4) )); then
  die "bash 4.4 or newer is required (this is bash ${BASH_VERSION:-unknown}); use Linux or Termux, or install a newer bash"
fi
for tool in sha256sum tar gzip find sort cut sed mktemp cp mv rm mkdir rmdir tr cat dirname kill; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found (Termux: pkg install coreutils tar gzip findutils sed)"
done

# a repository-relative path: plain characters, no empty, '.' or '..' component, no leading '/'
safe_path() {
  [[ "$1" =~ ^[A-Za-z0-9._@+,=-]+(/[A-Za-z0-9._@+,=-]+)*$ ]] && [[ ! "$1" =~ (^|/)\.\.?(/|$) ]]
}
sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }

ROOT="" VERSION="" REPO="" FROM_DIR="" FORCE=0 DRY=0 DOWNGRADE=0
need() { [[ $# -ge 2 && -n "$2" ]] || die "$1 needs a value"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) need "$@"; VERSION="$2"; shift 2 ;;
    --repo) need "$@"; REPO="$2"; shift 2 ;;
    --from-dir) need "$@"; FROM_DIR="$2"; shift 2 ;;
    --root) need "$@"; ROOT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --allow-downgrade) DOWNGRADE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 2 ;;
  esac
done
VERSION="${VERSION#v}"
[[ -z "$VERSION" || "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "bad --version '$VERSION' (expected X.Y.Z)"

[[ -n "$ROOT" ]] || ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository (use --root DIR)"
cd "$ROOT"

# --- an interrupted earlier run? roll it back (or finish cleaning up) before looking at anything else
WORK="" APPLYING=0 OPN=0
rollback() {
  [[ -d "$TXN" ]] || return 0
  local p
  if [[ -s "$TXN/added" ]]; then while IFS= read -r p; do rm -f -- "$p"; done < "$TXN/added"; fi
  if [[ -s "$TXN/restore" ]]; then
    while IFS= read -r p; do
      if [[ -f "$TXN/backup/$p" ]]; then mkdir -p "$(dirname "$p")"; cp -p "$TXN/backup/$p" "$p.restoring" && mv -f "$p.restoring" "$p"; fi
    done < "$TXN/restore"
  fi
  if [[ -f "$TXN/backup/$LOCK" ]]; then cp -p "$TXN/backup/$LOCK" "$LOCK.restoring" && mv -f "$LOCK.restoring" "$LOCK"
  elif [[ -f "$TXN/lock_new" ]]; then rm -f -- "$LOCK"; fi
  if [[ -s "$TXN/dirs" ]]; then while IFS= read -r p; do rmdir "$p" 2>/dev/null || true; done < <(LC_ALL=C sort -r "$TXN/dirs"); fi
  rm -rf "$TXN"
}
if [[ -d "$TXN" ]]; then
  pid="$(cat "$TXN/pid" 2>/dev/null || true)"
  if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && "$pid" != "$$" ]] && kill -0 "$pid" 2>/dev/null; then
    die "another update (pid $pid) is in progress in this repository"
  fi
  if [[ -z "$pid" && -n "$(find "$TXN" -maxdepth 0 -mmin -1 2>/dev/null)" ]]; then die "another update is starting in this repository; retry in a moment"; fi
  [[ $DRY -eq 0 ]] || die "an interrupted update was found in $TXN: run update.sh without --dry-run to recover first"
  case "$(cat "$TXN/state" 2>/dev/null || echo none)" in
    applying) rollback; echo "update: recovered from an interrupted update: previous state restored" ;;
    *) rm -rf "$TXN"; echo "update: recovered from an interrupted update: cleaned up" ;;
  esac
fi

# --- state from the previous install (strictly parsed: a damaged lock stops here, before anything changes)
declare -A OLD=()
LOCK_REPO="" LOCK_VERSION=""
corrupt_lock() { die "$LOCK is corrupt ($1). Nothing was changed. Restore it with: git checkout -- $LOCK, or delete it and re-run with --force to re-adopt the managed files (then review with git diff)"; }
if [[ -f "$LOCK" ]]; then
  ln=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    ln=$((ln+1))
    [[ -z "$line" ]] && continue
    case "$line" in
      repo=*) LOCK_REPO="${line#repo=}" ;;
      version=*) LOCK_VERSION="${line#version=}"; [[ "$LOCK_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || corrupt_lock "bad version on line $ln" ;;
      tarball_sha256=*) [[ "${line#tarball_sha256=}" =~ ^[0-9a-f]{64}$ ]] || corrupt_lock "bad tarball hash on line $ln" ;;
      "file "*)
        rest="${line#file }"; lsha="${rest%% *}"; lpath="${rest#* }"
        [[ "$rest" == *" "* && "$lsha" =~ ^[0-9a-f]{64}$ ]] || corrupt_lock "bad file entry on line $ln"
        safe_path "$lpath" || corrupt_lock "unsafe path on line $ln"
        [[ -z "${OLD[$lpath]:-}" ]] || corrupt_lock "duplicate entry on line $ln"
        OLD["$lpath"]="$lsha" ;;
      *) corrupt_lock "unrecognised line $ln" ;;
    esac
  done < "$LOCK"
  [[ -n "$LOCK_VERSION" ]] || corrupt_lock "no version line"
fi
[[ -n "$REPO" ]] || REPO="${BUILD_ENGINE_REPO:-$LOCK_REPO}"
[[ -z "$REPO" || "$REPO" == - || ( "$REPO" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$ && "${REPO#*/}" != . && "${REPO#*/}" != .. ) ]] || die "bad --repo '$REPO' (expected OWNER/NAME)"

# --- fetch
WORK="$(mktemp -d)"
on_exit() {
  local rc=$?
  trap - EXIT
  if [[ $APPLYING -eq 1 && $rc -ne 0 ]]; then rollback || true; echo "update: failed; the previous state was restored" >&2; fi
  rm -rf "$WORK"
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
mkdir -p "$WORK/dl" "$WORK/x"
if [[ -n "$FROM_DIR" ]]; then
  if [[ -z "$VERSION" ]]; then
    n="$(ls "$FROM_DIR"/build-engine-v*.tar.gz 2>/dev/null | wc -l)"
    [[ "$n" -eq 1 ]] || die "--from-dir holds $n artifacts; pass --version"
    VERSION="$(basename "$(ls "$FROM_DIR"/build-engine-v*.tar.gz)" | sed -E 's/^build-engine-v(.*)\.tar\.gz$/\1/')"
  fi
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "bad version '$VERSION'"
  cp "$FROM_DIR/build-engine-v$VERSION.tar.gz" "$FROM_DIR/build-engine-v$VERSION.tar.gz.sha256" "$WORK/dl/" 2>/dev/null || die "artifact v$VERSION (and its .sha256 file) not found in $FROM_DIR"
else
  [[ -n "$REPO" && "$REPO" != - ]] || die "no source: pass --repo OWNER/build-engine (or set BUILD_ENGINE_REPO)"
  command -v gh >/dev/null || die "gh not found (pkg install gh && gh auth login)"
  if [[ -z "$VERSION" ]]; then VERSION="$(gh release view -R "$REPO" --json tagName -q .tagName)" || die "could not read the latest release of $REPO"; VERSION="${VERSION#v}"; fi
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "bad version '$VERSION'"
  gh release download "v$VERSION" -R "$REPO" -D "$WORK/dl" -p "build-engine-v$VERSION.tar.gz" -p "build-engine-v$VERSION.tar.gz.sha256" >/dev/null || die "could not download release v$VERSION from $REPO"
fi
NAME="build-engine-v$VERSION.tar.gz"

# --- verify before anything is unpacked into the repository
(cd "$WORK/dl" && sha256sum -c "$NAME.sha256" >/dev/null 2>&1) || die "checksum mismatch for $NAME: refusing"
while read -r line; do [[ "${line:0:1}" == "-" ]] || die "artifact contains a non-regular entry: refusing"; done < <(tar -tvzf "$WORK/dl/$NAME")
while read -r n; do safe_path "$n" || die "artifact has an unsafe path ($n): refusing"; done < <(tar -tzf "$WORK/dl/$NAME")
tar -xzf "$WORK/dl/$NAME" -C "$WORK/x" --no-same-owner
RM="$WORK/x/engine/RELEASE-MANIFEST"; [[ -f "$RM" ]] || die "artifact has no engine/RELEASE-MANIFEST"
declare -A NEW=() MODE=() FOLD=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  read -r msha mmode mpath <<<"$line"
  [[ "$msha" =~ ^[0-9a-f]{64}$ ]] || die "manifest has a bad hash on: $line"
  [[ "${mmode:-}" == managed || "${mmode:-}" == seed ]] || die "manifest has a bad mode (managed or seed expected) on: $line"
  safe_path "${mpath:-}" || die "manifest has an unsafe path: ${mpath:-<none>}"
  [[ -z "${NEW[$mpath]:-}" ]] || die "manifest lists a path twice: $mpath"
  [[ -f "$WORK/x/$mpath" && "$(sha_of "$WORK/x/$mpath")" == "$msha" ]] || die "manifest does not match the artifact: $mpath"
  NEW["$mpath"]="$msha"; MODE["$mpath"]="$mmode"
  fold="$(printf '%s' "$mpath" | LC_ALL=C tr 'A-Z' 'a-z')"
  if [[ -n "${FOLD[$fold]:-}" ]]; then FOLD["$fold"]="${FOLD[$fold]} $mpath"; else FOLD["$fold"]="$mpath"; fi
done < "$RM"
[[ ${#NEW[@]} -gt 0 ]] || die "the release manifest lists no files"
while read -r n; do [[ "$n" == engine/RELEASE-MANIFEST || -n "${NEW[$n]:-}" ]] || die "file not in the release manifest: $n"; done < <(cd "$WORK/x" && find . -type f | sed 's|^\./||')
[[ -f "$WORK/x/engine/VERSION" && "$(tr -d ' \n' < "$WORK/x/engine/VERSION")" == "$VERSION" ]] \
  || die "the artifact is version $(tr -d ' \n' < "$WORK/x/engine/VERSION" 2>/dev/null || echo unknown) but v$VERSION was requested: refusing"
if [[ -n "$LOCK_VERSION" && $DOWNGRADE -eq 0 && "$VERSION" != "$LOCK_VERSION" ]]; then
  [[ "$(printf '%s\n%s\n' "$LOCK_VERSION" "$VERSION" | LC_ALL=C sort -V | head -n1)" == "$LOCK_VERSION" ]] \
    || die "refusing to downgrade $LOCK_VERSION -> $VERSION (use --allow-downgrade if you mean it)"
fi

# --- this filesystem must be able to hold every path of the release
case_insensitive=0
probe=".build-engine-case-probe-$$"
if [[ -n "${BUILD_ENGINE_TEST_CASE_INSENSITIVE:-}" ]]; then case_insensitive=1
elif ( : > "$probe" ) 2>/dev/null; then [[ -e "${probe^^}" ]] && case_insensitive=1; rm -f -- "$probe"; fi
if [[ $case_insensitive -eq 1 ]]; then
  for k in "${!FOLD[@]}"; do [[ "${FOLD[$k]}" == *" "* ]] && die "this filesystem ignores case, but the release ships paths that differ only by case (${FOLD[$k]}): refusing"; done
fi

# --- nothing may be written through a symlink, over a directory, or under a non-directory
blocked() { # blocked PATH -> prints the reason and succeeds when PATH cannot be safely written
  local p="$1" d="" c
  local IFS=/
  for c in $p; do
    d="${d:+$d/}$c"
    if [[ -L "$d" ]]; then echo "$d is a symlink"; return 0; fi
    if [[ "$d" != "$p" && -e "$d" && ! -d "$d" ]]; then echo "$d is not a directory"; return 0; fi
  done
  if [[ -d "$p" ]]; then echo "$p is a directory"; return 0; fi
  return 1
}
while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  if reason="$(blocked "$p")"; then die "refusing to write $p: $reason. Nothing was changed"; fi
done < <(printf '%s\n' "${!NEW[@]}" "${!OLD[@]}" | LC_ALL=C sort -u)

# --- plan (deterministic order)
declare -A MDIR=()
for p in "${!OLD[@]}" "${!NEW[@]}"; do d="$(dirname "$p")"; while [[ "$d" != . ]]; do MDIR["$d"]=1; d="$(dirname "$d")"; done; done
ADD=() UPD=() SAME=() KEEP=() DEL=() CONFLICT=() FORCE_COPY=() FORCE_DEL=()
while IFS= read -r p; do
  if [[ "${MODE[$p]}" == seed ]]; then
    if [[ -e "$p" ]]; then KEEP+=("$p"); else ADD+=("$p"); fi; continue
  fi
  if [[ ! -e "$p" ]]; then ADD+=("$p"); continue; fi
  cur="$(sha_of "$p")"
  if [[ "$cur" == "${NEW[$p]}" ]]; then SAME+=("$p")
  elif [[ -n "${OLD[$p]:-}" && "$cur" == "${OLD[$p]}" ]]; then UPD+=("$p")
  elif [[ -n "${OLD[$p]:-}" ]]; then CONFLICT+=("$p (edited locally since the last install)"); FORCE_COPY+=("$p")
  else CONFLICT+=("$p (exists but was not installed by update.sh)"); FORCE_COPY+=("$p"); fi
done < <(printf '%s\n' "${!NEW[@]}" | LC_ALL=C sort)
while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  [[ -n "${NEW[$p]:-}" ]] && continue   # still shipped (managed), or became a seed file: leave it alone
  [[ -e "$p" ]] || continue
  if [[ "$(sha_of "$p")" == "${OLD[$p]}" ]]; then DEL+=("$p")
  else CONFLICT+=("$p (dropped by this release, but edited locally)"); FORCE_DEL+=("$p"); fi
done < <(printf '%s\n' "${!OLD[@]}" | LC_ALL=C sort)

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

# --- apply as a transaction
tick() { # test hook: stop after step N
  OPN=$((OPN+1))
  [[ -n "${BUILD_ENGINE_TEST_INTERRUPT:-}" ]] || return 0
  local kind="${BUILD_ENGINE_TEST_INTERRUPT%%:*}" n="${BUILD_ENGINE_TEST_INTERRUPT##*:}"
  if [[ "$OPN" == "$n" ]]; then [[ "$kind" == kill ]] && kill -KILL $$; die "simulated interruption after step $n"; fi
  return 0
}
mkdir_tracked() { # mkdir -p, remembering the directories this run created so a rollback can remove them
  local d="$1" stack=() i
  while [[ "$d" != . && ! -d "$d" ]]; do stack+=("$d"); d="$(dirname "$d")"; done
  for ((i=${#stack[@]}-1; i>=0; i--)); do mkdir "${stack[$i]}"; echo "${stack[$i]}" >> "$TXN/dirs"; done
}
TOUCH=(${ADD[@]+"${ADD[@]}"} ${UPD[@]+"${UPD[@]}"} ${FORCE_COPY[@]+"${FORCE_COPY[@]}"})
GONE=(${DEL[@]+"${DEL[@]}"} ${FORCE_DEL[@]+"${FORCE_DEL[@]}"})
mkdir "$TXN" 2>/dev/null || die "cannot create $TXN (is another update running?)"
mkdir -p "$TXN/backup" "$TXN/new"
: > "$TXN/added"; : > "$TXN/restore"; : > "$TXN/dirs"
echo "$$" > "$TXN/pid"
APPLYING=1
# 1. stage every new file and back up every file about to change or go, before the tree is touched
for p in ${TOUCH[@]+"${TOUCH[@]}"}; do mkdir -p "$TXN/new/$(dirname "$p")"; cp -p "$WORK/x/$p" "$TXN/new/$p"; done
for p in ${UPD[@]+"${UPD[@]}"} ${FORCE_COPY[@]+"${FORCE_COPY[@]}"} ${GONE[@]+"${GONE[@]}"}; do
  mkdir -p "$TXN/backup/$(dirname "$p")"; cp -p "$p" "$TXN/backup/$p"; echo "$p" >> "$TXN/restore"
done
for p in ${ADD[@]+"${ADD[@]}"}; do echo "$p" >> "$TXN/added"; done
if [[ -f "$LOCK" ]]; then cp -p "$LOCK" "$TXN/backup/$LOCK"; else : > "$TXN/lock_new"; fi
{
  echo "repo=${REPO:--}"
  echo "version=$VERSION"
  echo "tarball_sha256=$(cut -d' ' -f1 "$WORK/dl/$NAME.sha256")"
  for p in $(printf '%s\n' "${!NEW[@]}" | LC_ALL=C sort); do
    [[ "${MODE[$p]}" == managed ]] && echo "file ${NEW[$p]} $p"
  done
} > "$TXN/lock.new"
echo applying > "$TXN/state"
# 2. swap the files in (each move is atomic), then the lock, then mark the transaction committed
for p in ${ADD[@]+"${ADD[@]}"}; do mkdir_tracked "$(dirname "$p")"; mv -f "$TXN/new/$p" "$p"; tick; done
for p in ${UPD[@]+"${UPD[@]}"} ${FORCE_COPY[@]+"${FORCE_COPY[@]}"}; do mv -f "$TXN/new/$p" "$p"; tick; done
for p in ${GONE[@]+"${GONE[@]}"}; do
  rm -f -- "$p"
  d="$(dirname "$p")"   # remove directories this release's files emptied, never ones the consumer owns
  # only nested directories (depth 2+) are pruned; top-level directories such as plans/ belong to the consumer
  while [[ "$d" == */* && -n "${MDIR[$d]:-}" ]] && rmdir "$d" 2>/dev/null; do d="$(dirname "$d")"; done
  tick
done
mv -f "$TXN/lock.new" "$LOCK"; tick
echo committed > "$TXN/state"; tick
APPLYING=0
rm -rf "$TXN"
echo "installed build-engine $VERSION. Review with: git status && git diff. Commit it on a branch and open a pull request."
