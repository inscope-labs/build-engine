#!/usr/bin/env bash
# verify.sh ARTIFACT.tar.gz [--release] [--test-payload] - inspect a FINISHED artifact. Never trusts how it was built.
#
# The verifier does not trust how the artifact was built, and by default it does not RUN the artifact's code
# either: everything below is a static check on the archive and on the extracted files. The payload's own test
# suite is a separate, explicit step (--test-payload) for the side that built the artifact and therefore trusts
# it. Whoever downloads an artifact gets the static checks and nothing else.
#
# The verifier's only inputs beyond the artifact itself are its explicit policy inputs: release/manifest.txt
# (what may ship) and release/forbidden.txt (what may not). With --release it additionally reads the repository's
# own version sources and CHANGELOG.md, because that is a check about the repository, not about the artifact.
#
# Fails on: a bad or misdirected checksum, an unreadable or truncated archive, a non-regular entry, an unsafe or
# duplicated member name, a file outside the allowlist, anything forbidden.txt forbids (the gateway in particular),
# a bad release manifest, version disagreement, or - with --test-payload - a payload that does not pass its own tests.
# --release additionally requires a compatibility protocol version (build-engine/<major.minor>) that matches the release
# version and has a row in COMPATIBILITY.md, and a dated CHANGELOG entry.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
die() { echo "verify: FAIL: $*" >&2; exit 1; }
usage() { echo "usage: verify.sh ARTIFACT.tar.gz [--release] [--test-payload]" >&2; exit 2; }

# A path is safe when it is relative and every one of its components is a plain name. A name that merely
# contains two dots ("notes..v2.md") is safe; a ".." component is not. The same check is used by
# release/package.sh and by the shipped engine/bin/update.sh (F0-016) - keep the three in step.
safe_component_path() {
  local p="$1" part
  local -a parts
  [[ -n "$p" && "$p" != /* ]] || return 1
  IFS='/' read -r -a parts <<< "$p"
  for part in "${parts[@]}"; do
    [[ -n "$part" && "$part" != "." && "$part" != ".." ]] || return 1
  done
  return 0
}

ART=""; MODE=""; TEST_PAYLOAD=0
for arg in "$@"; do
  case "$arg" in
    --release) MODE=--release ;;
    --test-payload) TEST_PAYLOAD=1 ;;
    -h|--help) usage ;;
    -*) usage ;;
    *) [[ -z "$ART" ]] || usage; ART="$arg" ;;
  esac
done
[[ -n "$ART" ]] || usage
[[ -f "$ART" ]] || die "no such artifact: $ART"
ART="$(cd "$(dirname "$ART")" && pwd)/$(basename "$ART")"
base="$(basename "$ART")"
[[ "$base" =~ ^build-engine-v([0-9]+\.[0-9]+\.[0-9]+)\.tar\.gz$ ]] || die "unexpected artifact name '$base'"
AV="${BASH_REMATCH[1]}"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
X="$WORK/x"; mkdir -p "$X"

# 1. the checksum sidecar must exist, describe THIS artifact, and match it
SIDE="$ART.sha256"
[[ -f "$SIDE" ]] || die "missing $base.sha256"
[[ "$(grep -c . "$SIDE")" -eq 1 ]] || die "the checksum sidecar must hold exactly one line"
side_name="$(awk 'NF{print $2; exit}' "$SIDE")"; side_name="${side_name#\*}"
[[ "$side_name" == "$base" ]] || die "the checksum sidecar describes '${side_name:-nothing}', not $base"
(cd "$(dirname "$ART")" && sha256sum -c "$base.sha256" >/dev/null) || die "checksum mismatch"

# 2. the archive must be a readable gzip tar
tar -tzf "$ART" > "$WORK/names" 2>"$WORK/tar.err" \
  || { tail -2 "$WORK/tar.err" >&2; die "the artifact is not a readable gzip tar archive"; }
tar -tvzf "$ART" > "$WORK/listing" 2>/dev/null || die "the artifact is not a readable gzip tar archive"

# 3. only regular files may be in it: no directory, symlink, hardlink, device, socket or fifo entry
while IFS= read -r line; do
  [[ "${line:0:1}" == "-" ]] || die "non-regular tar entry: $line"
  case "${line:0:10}" in
    -rw-r--r--|-rwxr-xr-x) ;;
    *) die "unexpected file mode in the artifact: ${line:0:10} ($line)" ;;
  esac
done < "$WORK/listing"

# 4. every member name must be a safe relative path, and no name may appear twice
while IFS= read -r n; do
  [[ -n "$n" ]] || die "the archive contains an empty member name"
  [[ "$n" != *\\* ]] || die "unsafe member name (a backslash is never part of a shipped path): $n"
  safe_component_path "$n" || die "unsafe path in tar: $n"
done < "$WORK/names"
dups="$(LC_ALL=C sort "$WORK/names" | uniq -d)"
[[ -z "$dups" ]] || die "duplicate archive member: $(echo "$dups" | head -1)"
folds="$(tr 'A-Z' 'a-z' < "$WORK/names" | LC_ALL=C sort | uniq -d)"
[[ -z "$folds" ]] || die "two archive members are equal under case folding: $(echo "$folds" | head -1)"

# 5. the extracted tree must agree with the listing (the real names, not the escaped ones).
# engine/RELEASE-MANIFEST is the one file the artifact carries that is not in the listing: it is generated
# by the packager after the file list is fixed, so it is not a member of the archive.
tar -xzf "$ART" -C "$X" --no-same-owner
(cd "$X" && find . -type f | sed 's|^\./||' | grep -v '^engine/RELEASE-MANIFEST$' | LC_ALL=C sort) > "$WORK/extracted"
grep -vx 'engine/RELEASE-MANIFEST' "$WORK/names" | LC_ALL=C sort > "$WORK/members"
cmp -s "$WORK/extracted" "$WORK/members" || die "the extracted files and the archive listing disagree"

# 6. every file must be allowlisted (the release manifest is the only generated file). The allowlist is a
# policy input, so it is checked too: it may not declare a path twice, nor two paths that are equal under
# case folding (the artifact has to install on a case-insensitive filesystem).
: > "$WORK/policy"
while read -r mode path; do
  [[ -z "${mode:-}" || "$mode" == \#* ]] && continue
  [[ "$mode" == managed || "$mode" == seed ]] || die "the allowlist has a bad mode for $path"
  safe_component_path "$path" || die "the allowlist has an unsafe path: $path"
  echo "$path" >> "$WORK/policy"
done < "$ROOT/release/manifest.txt"
pdups="$(LC_ALL=C sort "$WORK/policy" | uniq -d)"
[[ -z "$pdups" ]] || die "the allowlist declares $(echo "$pdups" | head -1) twice"
pfolds="$(tr 'A-Z' 'a-z' < "$WORK/policy" | LC_ALL=C sort | uniq -d)"
[[ -z "$pfolds" ]] || die "the allowlist declares two paths equal under case folding: $(echo "$pfolds" | head -1)"
while IFS= read -r n; do
  [[ "$n" == engine/RELEASE-MANIFEST ]] && continue
  ok=0
  while IFS= read -r path; do
    if [[ "$n" == "$path" || "$n" == "$path"/* ]]; then ok=1; break; fi
  done < "$WORK/policy"
  [[ $ok -eq 1 ]] || die "not allowlisted: $n"
done < "$WORK/members"

# 7. forbidden paths and contents
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  kind="${line%%:*}"; re="${line#*: }"
  case "$kind" in
    path) grep -Eq -- "$re" "$WORK/members" && { grep -E -- "$re" "$WORK/members" | head -3 >&2; die "forbidden path rule hit: $re"; } ;;
    text) hits="$(grep -ralE -- "$re" "$X" || true)"; [[ -z "$hits" ]] || { echo "$hits" | head -3 >&2; die "forbidden content rule hit: $re"; } ;;
    *) die "forbidden.txt: bad rule '$line'" ;;
  esac
done < "$ROOT/release/forbidden.txt"

# 8. the release manifest must describe exactly the files that are in the artifact
RM="$X/engine/RELEASE-MANIFEST"; [[ -f "$RM" ]] || die "missing engine/RELEASE-MANIFEST"
head -1 "$RM" | grep -qx '# build-engine release manifest' || die "the release manifest has no header"
: > "$WORK/listed"
while read -r sha mode path extra; do
  [[ -z "${sha:-}" || "$sha" == \#* ]] && continue
  [[ -z "${extra:-}" ]] || die "the release manifest has an unexpected field for $path: $extra"
  [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || die "the release manifest has a malformed hash for $path"
  [[ "$mode" == managed || "$mode" == seed ]] || die "manifest: bad mode for $path"
  safe_component_path "$path" || die "the release manifest has an unsafe path: $path"
  [[ -f "$X/$path" ]] || die "manifest lists a file that is not in the artifact: $path"
  [[ "$(sha256sum "$X/$path" | cut -d' ' -f1)" == "$sha" ]] || die "hash mismatch: $path"
  echo "$path" >> "$WORK/listed"
done < "$RM"
mdups="$(LC_ALL=C sort "$WORK/listed" | uniq -d)"
[[ -z "$mdups" ]] || die "the release manifest lists $(echo "$mdups" | head -1) twice"
mfolds="$(tr 'A-Z' 'a-z' < "$WORK/listed" | LC_ALL=C sort | uniq -d)"
[[ -z "$mfolds" ]] || die "the release manifest lists two paths equal under case folding: $(echo "$mfolds" | head -1)"
cmp -s "$WORK/members" <(LC_ALL=C sort "$WORK/listed") || die "artifact files and release manifest disagree"

# 9. one version everywhere, inside the artifact
EV="$(tr -d ' \r\n' < "$X/engine/VERSION")"
JV="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["engine_version"])' "$X/engine/release.json")"
[[ "$EV" == "$AV" && "$JV" == "$AV" ]] || die "version disagreement: artifact $AV, engine/VERSION $EV, engine/release.json $JV"
grep -qx "# version $AV" "$RM" || die "release manifest version header disagrees"

# 6b. the retired compatibility key must be gone (Stage 1.2): readers and gates use `protocol` only
python3 -c 'import json,sys; sys.exit(1 if "implements_abstract" in json.load(open(sys.argv[1])) else 0)' "$X/engine/release.json" \
  || die "engine/release.json still carries the retired key implements_abstract: use protocol (e.g. build-engine/0.5)"

# 10. the payload is sound on its own: the shell scripts parse and the python compiles
bash -n "$X/operator/cbridge" || die "operator/cbridge does not parse"
sh -n "$X/operator/install.sh" || die "operator/install.sh does not parse"
bash -n "$X/engine/bin/update.sh" || die "engine/bin/update.sh does not parse"
(cd "$X" && python3 -m compileall -q engine/tools >/dev/null) || die "payload python does not compile"

# 11. running the payload's own tests is explicit: it is the only step that executes artifact code
if [[ $TEST_PAYLOAD -eq 1 ]]; then
  (cd "$X" && python3 -m unittest discover -s engine/tools >/dev/null 2>"$WORK/test.err") \
    || { tail -20 "$WORK/test.err" >&2; die "payload tests fail"; }
fi

# 12. the release gate: the repository's own sources must agree with the artifact
if [[ "$MODE" == "--release" ]]; then
  [[ -f "$ROOT/VERSION" ]] || die "the release gate needs the repository's VERSION"
  [[ "$(tr -d ' \r\n' < "$ROOT/VERSION")" == "$AV" ]] || die "repo VERSION differs from the artifact version"
  [[ -f "$ROOT/template/engine/VERSION" ]] || die "the release gate needs the repository's template/engine/VERSION"
  [[ "$(tr -d ' \r\n' < "$ROOT/template/engine/VERSION")" == "$AV" ]] || die "the repository's template/engine/VERSION differs from the artifact version"
  [[ -f "$ROOT/template/engine/release.json" ]] || die "the release gate needs the repository's template/engine/release.json"
  RJV="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["engine_version"])' "$ROOT/template/engine/release.json")"
  [[ "$RJV" == "$AV" ]] || die "the repository's engine/release.json differs from the artifact version"
  PROTO="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("protocol",""))' "$X/engine/release.json")"
  [[ -n "$PROTO" && "$PROTO" != UNSET ]] || die "engine/release.json protocol is missing or UNSET: record the compatibility protocol version this release implements (e.g. build-engine/0.5)"
  [[ "$PROTO" =~ ^build-engine/([0-9]+)\.([0-9]+)$ ]] || die "engine/release.json protocol '$PROTO' is not of the form build-engine/<major>.<minor>"
  [[ "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}" == "${AV%.*}" ]] || die "protocol $PROTO does not match release version $AV (expected build-engine/${AV%.*})"
  grep -Eq "^\| ${AV//./\\.}( \(unreleased\))? \| ${PROTO//./\\.} \|" "$ROOT/COMPATIBILITY.md" || die "COMPATIBILITY.md has no row recording engine $AV with protocol $PROTO"
  grep -Eq "^## $AV - [0-9]{4}-[0-9]{2}-[0-9]{2}\$" "$ROOT/CHANGELOG.md" || die "CHANGELOG.md has no dated '## $AV - YYYY-MM-DD' entry"
fi

echo "verify: OK ($base: $(wc -l < "$WORK/names") files, version $AV${MODE:+, $MODE}$( [[ $TEST_PAYLOAD -eq 1 ]] && echo ", payload tests run"))"
