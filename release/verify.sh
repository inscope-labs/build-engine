#!/usr/bin/env bash
# verify.sh ARTIFACT.tar.gz [--release] - inspect a FINISHED artifact. Never trusts how it was built.
# Fails on: bad checksum, unsafe tar entries, paths outside the allowlist, anything in forbidden.txt (the gateway
# in particular), a bad release manifest, version disagreement, or a payload that does not pass its own tests.
# --release additionally requires an abstract version to be recorded and a dated CHANGELOG entry.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART="${1:-}"; MODE="${2:-}"
die() { echo "verify: FAIL: $*" >&2; exit 1; }
[[ -f "$ART" ]] || die "usage: verify.sh ARTIFACT.tar.gz [--release]"
ART="$(cd "$(dirname "$ART")" && pwd)/$(basename "$ART")"
base="$(basename "$ART")"
[[ "$base" =~ ^build-engine-v([0-9]+\.[0-9]+\.[0-9]+)\.tar\.gz$ ]] || die "unexpected artifact name '$base'"
AV="${BASH_REMATCH[1]}"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
X="$WORK/x"; mkdir -p "$X"

# 1. checksum
[[ -f "$ART.sha256" ]] || die "missing $base.sha256"
(cd "$(dirname "$ART")" && sha256sum -c "$base.sha256" >/dev/null) || die "checksum mismatch"

# 2. tar safety: regular files only, relative paths, no traversal
tar -tvzf "$ART" > "$WORK/listing"
while read -r line; do
  [[ "${line:0:1}" == "-" ]] || die "non-regular tar entry: $line"
done < "$WORK/listing"
tar -tzf "$ART" > "$WORK/names"
while read -r n; do
  [[ "$n" != /* && "$n" != *..* && "$n" != ./* ]] || die "unsafe path in tar: $n"
done < "$WORK/names"
tar -xzf "$ART" -C "$X" --no-same-owner

# 3. every file must be allowlisted (the release manifest is the only generated file)
while read -r n; do
  [[ "$n" == engine/RELEASE-MANIFEST ]] && continue
  ok=0
  while read -r mode path; do
    [[ -z "${mode:-}" || "$mode" == \#* ]] && continue
    if [[ "$n" == "$path" || "$n" == "$path"/* ]]; then ok=1; break; fi
  done < "$ROOT/release/manifest.txt"
  [[ $ok -eq 1 ]] || die "not allowlisted: $n"
done < "$WORK/names"

# 4. forbidden paths and contents
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  kind="${line%%:*}"; re="${line#*: }"
  case "$kind" in
    path) grep -Eq -- "$re" "$WORK/names" && { grep -E -- "$re" "$WORK/names" | head -3 >&2; die "forbidden path rule hit: $re"; } ;;
    text) hits="$(grep -rIlE -- "$re" "$X" || true)"; [[ -z "$hits" ]] || { echo "$hits" | head -3 >&2; die "forbidden content rule hit: $re"; } ;;
    *) die "forbidden.txt: bad rule '$line'" ;;
  esac
done < "$ROOT/release/forbidden.txt"

# 5. release manifest agrees with the files
RM="$X/engine/RELEASE-MANIFEST"; [[ -f "$RM" ]] || die "missing engine/RELEASE-MANIFEST"
: > "$WORK/listed"
while read -r sha mode path; do
  [[ -z "${sha:-}" || "$sha" == \#* ]] && continue
  [[ "$mode" == managed || "$mode" == seed ]] || die "manifest: bad mode for $path"
  [[ -f "$X/$path" ]] || die "manifest lists a file that is not in the artifact: $path"
  [[ "$(sha256sum "$X/$path" | cut -d' ' -f1)" == "$sha" ]] || die "hash mismatch: $path"
  echo "$path" >> "$WORK/listed"
done < "$RM"
grep -vx 'engine/RELEASE-MANIFEST' "$WORK/names" | LC_ALL=C sort > "$WORK/a"
LC_ALL=C sort "$WORK/listed" > "$WORK/b"
cmp -s "$WORK/a" "$WORK/b" || die "artifact files and release manifest disagree"

# 6. one version everywhere
EV="$(tr -d ' \r\n' < "$X/engine/VERSION")"
JV="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["engine_version"])' "$X/engine/release.json")"
[[ "$EV" == "$AV" && "$JV" == "$AV" ]] || die "version disagreement: artifact $AV, engine/VERSION $EV, engine/release.json $JV"
grep -q "^# version $AV\$" "$RM" || die "release manifest version header disagrees"
[[ ! -f "$ROOT/VERSION" || "$(tr -d ' \r\n' < "$ROOT/VERSION")" == "$AV" ]] || die "repo VERSION differs from the artifact version"

# 7. the payload works on its own (no gateway, no repo around it)
bash -n "$X/operator/cbridge"; sh -n "$X/operator/install.sh"; bash -n "$X/engine/bin/update.sh"
(cd "$X" && python3 -m compileall -q engine/tools >/dev/null) || die "payload python does not compile"
(cd "$X" && python3 -m unittest discover -s engine/tools >/dev/null 2>"$WORK/test.err") || { tail -20 "$WORK/test.err" >&2; die "payload tests fail"; }

# 8. release gate
if [[ "$MODE" == "--release" ]]; then
  PROTO="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("protocol") or d.get("implements_abstract",""))' "$X/engine/release.json")"
  [[ -n "$PROTO" && "$PROTO" != UNSET ]] || die "engine/release.json protocol is missing or UNSET: record the protocol version this release implements (e.g. build-engine/0.5)"
  grep -Eq "^## $AV - [0-9]{4}-[0-9]{2}-[0-9]{2}\$" "$ROOT/CHANGELOG.md" || die "CHANGELOG.md has no dated '## $AV - YYYY-MM-DD' entry"
fi
echo "verify: OK ($base: $(wc -l < "$WORK/names") files, version $AV${MODE:+, $MODE})"
