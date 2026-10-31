#!/usr/bin/env bash
# test-release.sh - self-test of the release machinery. Proves the pipeline passes on a clean tree AND fails,
# for the stated reason, on each mistake it exists to catch (above all: the gateway leaking into a release).
#
# Since Stage 3.1 the artifact is built from the tracked file list, so every test runs inside a git
# checkout: a tree that has been changed on purpose is committed before the build, so the build
# reaches the gate the test is about instead of stopping at the "dirty tree" gate.
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILN=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAILN=$((FAILN+1)); echo "  FAIL $1" >&2; }

# a fresh copy of the repository, committed, so the tree is clean and every file is tracked
fresh() { rm -rf "$T/r"; mkdir "$T/r"; (cd "$SRC" && tar --exclude=.git --exclude=dist --exclude=node_modules -cf - .) | tar -C "$T/r" -xf -
  (cd "$T/r" && git init -q . && git config user.email test@example.invalid && git config user.name test \
    && git add -A && git commit -qm "baseline"); R="$T/r"; }
# commit what the test just planted, so the tree is clean again
plant() { (cd "$R" && git add -A && git commit -qm "planted" --allow-empty) >/dev/null 2>&1; }
build() { rm -rf "$R/dist"; "$R/release/package.sh" "$R/dist" >"$T/pkg.out" 2>&1; }
ART() { echo "$R/dist/build-engine-v$(tr -d ' \n' < "$R/VERSION").tar.gz"; }
# must_fail "<name>" "<expected text>" cmd...
must_fail() { local name="$1" want="$2"; shift 2; local out; out="$("$@" 2>&1)"; local rc=$?
  if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then ok "$name"; else bad "$name (rc=$rc, wanted '$want', got: $(echo "$out" | tail -2 | tr '\n' ' '))"; fi; }
must_pass() { local name="$1"; shift; if "$@" >"$T/o" 2>&1; then ok "$name"; else bad "$name: $(tail -3 "$T/o" | tr '\n' ' ')"; fi; }
# put a line in the manifest and commit it, so the build reaches the manifest rules
manifest_line() { printf '%s\n' "$1" >> "$R/release/manifest.txt"; plant; }

echo "release machinery self-test"
fresh; must_pass "clean tree packages" build
must_pass "clean artifact verifies" "$R/release/verify.sh" "$(ART)"
a="$(sha256sum "$(ART)" | cut -d' ' -f1)"; build; [[ "$a" == "$(sha256sum "$(ART)" | cut -d' ' -f1)" ]] && ok "packaging is reproducible" || bad "packaging is not reproducible"
fresh; sed -i -E "s/^## ([0-9.]+) - [0-9]{4}-[0-9]{2}-[0-9]{2}\$/## \1 - unreleased/" "$R/CHANGELOG.md"; plant; build
must_fail "release gate refuses an undated changelog entry" "no dated" "$R/release/verify.sh" "$(ART)" --release
[[ -z "$(tar -tzf "$(ART)" | grep -E '(^|/)(gateway/|ctxgate\.py|test_ctxgate\.py)')" ]] && ok "clean artifact has no gateway file" || bad "clean artifact contains gateway files"

# ---------------------------------------------------------------- Stage 3.1: the allowlist
fresh; echo scratch > "$R/template/docs/.scratch-local.txt"
must_fail "an untracked file in template/ stops packaging" "dirty tree" "$R/release/package.sh" "$R/dist"

fresh; echo local >> "$R/template/engine/VERSION"
must_fail "a locally modified file stops packaging" "dirty tree" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "managed engine/VERSION"
must_fail "a path declared twice is refused" "declared twice" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "seed engine/VERSION"
must_fail "a path declared managed and seed is refused" "may not be both managed and seed" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "managed engine/Version"
must_fail "a case-folded duplicate is refused" "case folding" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "managed /etc"
must_fail "an absolute manifest path is refused" "absolute path" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "managed engine/../engine/tools"
must_fail "a traversal component is refused" "has a '..' component" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "managed engine/tools/ctx link.py"
must_fail "whitespace in a manifest path is refused" "contains whitespace" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "sideload engine/tools/ctxlink.py"
must_fail "an unknown manifest mode is refused" "mode must be" "$R/release/package.sh" "$R/dist"

fresh; manifest_line "managed does/not/exist"
must_fail "manifest entry that does not exist stops packaging" "does not exist" "$R/release/package.sh" "$R/dist"

fresh; ln -s ../../docs/GATES.md "$R/template/engine/tools/link.md"; plant
must_fail "symlink stops packaging" "symlink" "$R/release/package.sh" "$R/dist"

fresh; printf 'not python\n' > "$R/template/docs/junk.pyc"; (cd "$R" && git add -f template/docs/junk.pyc) >/dev/null 2>&1; plant
must_fail "a tracked generated file stops packaging" "generated or local file" "$R/release/package.sh" "$R/dist"

fresh; mkdir -p "$R/template/docs/node_modules/x"; echo '{}' > "$R/template/docs/node_modules/x/package.json"
(cd "$R" && git add -f template/docs/node_modules) >/dev/null 2>&1; plant
must_fail "a tracked node_modules tree stops packaging" "generated or local file" "$R/release/package.sh" "$R/dist"

fresh; must_fail "an output directory inside the packaged tree is refused" "inside the packaged tree" "$R/release/package.sh" "$R/template/docs/dist"

fresh; build
echo x > "$R/template/docs/.scratch-local.txt"
must_fail "a dirty tree stops the build" "dirty tree" "$R/release/package.sh" "$R/dist"
[[ -f "$R/dist/$(basename "$(ART)")" ]] && bad "a failed build left an artifact behind" || ok "a failed build leaves no artifact behind"
rm -f "$R/template/docs/.scratch-local.txt"

# the same commit, built under a different umask and a different checkout mode, is the same artifact
fresh; build; a="$(sha256sum "$(ART)" | cut -d' ' -f1)"
chmod -R g+w "$R/template"; build; b="$(sha256sum "$(ART)" | cut -d' ' -f1)"
[[ "$a" == "$b" ]] && ok "a group-writable checkout builds the same bytes" || bad "the artifact depends on the checkout modes"
fresh; build; a="$(sha256sum "$(ART)" | cut -d' ' -f1)"
( umask 002; "$R/release/package.sh" "$R/dist" >/dev/null 2>&1 ); b="$(sha256sum "$(ART)" | cut -d' ' -f1)"
[[ "$a" == "$b" ]] && ok "a different umask builds the same bytes" || bad "the artifact depends on the umask"

# the artifact holds exactly the allowlisted files, and the release manifest describes all of them
fresh; build
n_member="$(tar -tzf "$(ART)" | wc -l)"
n_listed="$(tar -xzOf "$(ART)" engine/RELEASE-MANIFEST | grep -vc '^#')"
[[ "$n_member" -eq $((n_listed + 1)) ]] && ok "the release manifest lists every packaged file" || bad "the release manifest lists $n_listed of $((n_member - 1)) files"
bad_hash=0
while read -r sha mode path; do
  [[ -z "${sha:-}" || "$sha" == \#* ]] && continue
  [[ "$(tar -xzOf "$(ART)" "$path" | sha256sum | cut -d' ' -f1)" == "$sha" ]] || bad_hash=1
done < <(tar -xzOf "$(ART)" engine/RELEASE-MANIFEST)
[[ $bad_hash -eq 0 ]] && ok "every release manifest hash matches the packaged file" || bad "a release manifest hash does not match"
n_exec="$(tar -tvzf "$(ART)" | grep -c '^-rwxr-xr-x')"
[[ "$n_exec" -eq 3 ]] && ok "the artifact ships exactly the three executables" || bad "the artifact ships $n_exec executables, expected 3"
tar -tvzf "$(ART)" | grep -v '^-rw-r--r--' | grep -v '^-rwxr-xr-x' | grep -q . && bad "the artifact ships a file with an unexpected mode" || ok "every packaged file ships 0644 or 0755"

# ---------------------------------------------------------------- Stage 3.2: the verifier
# The verifier must fail closed on a hostile artifact, and must not run the artifact's code while doing it.
fresh; build
PRISTINE="$T/pristine.tar.gz"; cp "$(ART)" "$PRISTINE"; cp "$(ART).sha256" "$T/pristine.sha256"
restore() { cp "$PRISTINE" "$(ART)"; cp "$T/pristine.sha256" "$(ART).sha256"; }
hostile() { restore; python3 "$R/release/test-fixtures.py" add-member "$(ART)" "$@"; }
patch_artifact() { restore; python3 "$R/release/test-fixtures.py" patch-file "$(ART)" "$1"; }
# the release manifest as it sits inside the artifact
rm_body() { tar -xzOf "$(ART)" engine/RELEASE-MANIFEST | grep -v '^#'; }

hostile symlink "engine/tools/evil" "/etc/passwd"
must_fail "an archive with a symlink entry is refused" "non-regular tar entry" "$R/release/verify.sh" "$(ART)"
hostile hardlink "engine/tools/evil" "engine/VERSION"
must_fail "an archive with a hardlink entry is refused" "non-regular tar entry" "$R/release/verify.sh" "$(ART)"
hostile fifo "engine/tools/evil"
must_fail "an archive with a fifo entry is refused" "non-regular tar entry" "$R/release/verify.sh" "$(ART)"
hostile chr "engine/tools/evil"
must_fail "an archive with a device entry is refused" "non-regular tar entry" "$R/release/verify.sh" "$(ART)"
hostile dir "engine/tools/evil"
must_fail "an archive with a directory entry is refused" "non-regular tar entry" "$R/release/verify.sh" "$(ART)"
hostile file "/etc/passwd"
must_fail "an absolute path in the archive is refused" "unsafe path in tar" "$R/release/verify.sh" "$(ART)"
hostile file "../evil.txt"
must_fail "a traversal path in the archive is refused" "unsafe path in tar" "$R/release/verify.sh" "$(ART)"
hostile file "engine/../../evil.txt"
must_fail "a nested traversal path in the archive is refused" "unsafe path in tar" "$R/release/verify.sh" "$(ART)"
hostile file "engine/./evil.txt"
must_fail "a dot component in the archive is refused" "unsafe path in tar" "$R/release/verify.sh" "$(ART)"
hostile file "engine//evil.txt"
must_fail "an empty component in the archive is refused" "unsafe path in tar" "$R/release/verify.sh" "$(ART)"
hostile file "engine/evil\\name.txt"
must_fail "a backslash in a member name is refused" "backslash" "$R/release/verify.sh" "$(ART)"
hostile dup "engine/tools/dup.txt"
must_fail "a duplicate archive member is refused" "duplicate archive member" "$R/release/verify.sh" "$(ART)"
restore; python3 "$R/release/test-fixtures.py" truncate "$(ART)"
must_fail "a truncated archive is refused" "not a readable gzip tar" "$R/release/verify.sh" "$(ART)"
restore; rm -f "$(ART).sha256"
must_fail "a missing checksum sidecar is refused" "missing" "$R/release/verify.sh" "$(ART)"
restore; printf '%s  other-file.tar.gz\n' "$(sha256sum "$(ART)" | cut -d' ' -f1)" > "$(ART).sha256"
must_fail "a sidecar that describes another file is refused" "describes" "$R/release/verify.sh" "$(ART)"
restore; printf 'x' >> "$(ART)"
must_fail "a tampered artifact fails its checksum" "checksum mismatch" "$R/release/verify.sh" "$(ART)"

# the release manifest inside the artifact must describe exactly the files that are in it
restore; { tar -xzOf "$(ART)" engine/RELEASE-MANIFEST; tar -xzOf "$(ART)" engine/RELEASE-MANIFEST | grep -v '^#' | tail -1; } \
  | python3 "$R/release/test-fixtures.py" patch-file "$(ART)" engine/RELEASE-MANIFEST
must_fail "a release manifest with a duplicate entry is refused" "twice" "$R/release/verify.sh" "$(ART)"
restore; tar -xzOf "$(ART)" engine/RELEASE-MANIFEST | sed 's/^[0-9a-f]\{64\}/not-a-hash/' \
  | python3 "$R/release/test-fixtures.py" patch-file "$(ART)" engine/RELEASE-MANIFEST
must_fail "a release manifest with a malformed hash is refused" "malformed hash" "$R/release/verify.sh" "$(ART)"
restore; tar -xzOf "$(ART)" engine/RELEASE-MANIFEST | sed 's/^\([0-9a-f]\{64\}\) managed /\1 sideways /' \
  | python3 "$R/release/test-fixtures.py" patch-file "$(ART)" engine/RELEASE-MANIFEST
must_fail "a release manifest with a bad mode is refused" "bad mode" "$R/release/verify.sh" "$(ART)"
restore; tar -xzOf "$(ART)" engine/RELEASE-MANIFEST | sed 's/^\([0-9a-f]\{64\} managed .*\)$/\1 unexpected/' \
  | python3 "$R/release/test-fixtures.py" patch-file "$(ART)" engine/RELEASE-MANIFEST
must_fail "a release manifest with an unexpected field is refused" "unexpected field" "$R/release/verify.sh" "$(ART)"
restore; { tar -xzOf "$(ART)" engine/RELEASE-MANIFEST; echo "0000000000000000000000000000000000000000000000000000000000000000 managed engine/ghost.txt"; } \
  | python3 "$R/release/test-fixtures.py" patch-file "$(ART)" engine/RELEASE-MANIFEST
must_fail "a release manifest listing a missing file is refused" "not in the artifact" "$R/release/verify.sh" "$(ART)"
restore; grep -v '^# build-engine release manifest' <(tar -xzOf "$(ART)" engine/RELEASE-MANIFEST) \
  | python3 "$R/release/test-fixtures.py" patch-file "$(ART)" engine/RELEASE-MANIFEST
must_fail "a release manifest without a header is refused" "no header" "$R/release/verify.sh" "$(ART)"

# the policy file (the allowlist) is an input too: it may not contradict itself
fresh; build; printf 'managed engine/VERSION\n' >> "$R/release/manifest.txt"
must_fail "an allowlist that declares a path twice is refused" "declares engine/VERSION twice" "$R/release/verify.sh" "$(ART)"
fresh; build; printf 'managed engine/Version\n' >> "$R/release/manifest.txt"
must_fail "an allowlist with a case-folded duplicate is refused" "equal under case folding" "$R/release/verify.sh" "$(ART)"
fresh; build; printf 'managed engine/../engine/tools\n' >> "$R/release/manifest.txt"
must_fail "an allowlist with an unsafe path is refused" "unsafe path" "$R/release/verify.sh" "$(ART)"

# the verifier must not run the artifact's code
fresh; cat > "$R/template/engine/tools/test_marker.py" <<'PY'
import os, unittest
class T(unittest.TestCase):
    def test_marker(self):
        p = os.environ.get("BE_MARKER")
        if p: open(p, "w").write("executed")
PY
plant; build
rm -f "$T/marker"
BE_MARKER="$T/marker" "$R/release/verify.sh" "$(ART)" >/dev/null 2>&1
[[ -f "$T/marker" ]] && bad "verification executed the payload" || ok "verification does not execute the payload"
rm -f "$T/marker"
BE_MARKER="$T/marker" "$R/release/verify.sh" "$(ART)" --test-payload >/dev/null 2>&1
[[ -f "$T/marker" ]] && ok "the payload tests run when they are asked for" || bad "the payload tests did not run with --test-payload"

# a name that merely contains two dots is a safe name, in the packer and in the verifier (F0-016)
fresh; echo "notes" > "$R/template/docs/notes..v2.md"; plant; build
must_pass "a file whose name contains two dots is packaged" test -f "$R/dist/build-engine-v$(tr -d ' \n' < "$R/VERSION").tar.gz"
must_pass "a file whose name contains two dots verifies" "$R/release/verify.sh" "$(ART)"

# ---------------------------------------------------------------- Stage 3.2: what forbidden.txt has to catch
# The rules are the second line of defence: a file that the allowlist permits can still be refused.
fresh; printf 'class Gateway:\n    pass\n' > "$R/template/engine/tools/transport.py"; plant; build
must_fail "an indented copy of the gateway code is caught" "forbidden content rule" "$R/release/verify.sh" "$(ART)"
fresh; printf 'def make_server(gateway):\n    pass\n' > "$R/template/engine/tools/serve.py"; plant; build
must_fail "a copy of the gateway entry point is caught" "forbidden content rule" "$R/release/verify.sh" "$(ART)"
fresh; printf '{"vectors_version": 1, "vectors": []}\n' > "$R/template/docs/vectors.json"; plant; build
must_fail "a renamed copy of the conformance vectors is caught" "forbidden content rule" "$R/release/verify.sh" "$(ART)"
# a credential hidden in a binary file: the content rules are matched against binary files too
fresh; { printf 'token: ghp_%s' "$(printf 'A%.0s' $(seq 36))"; printf '\000\001\002\003'; } > "$R/template/docs/blob.bin"; plant; build
must_fail "a credential in a binary file is caught" "forbidden content rule" "$R/release/verify.sh" "$(ART)"
# the path rules are checked on a crafted artifact: the packager would refuse some of these files first,
# but the verifier must catch them however they got in
fresh; build
hostile file "docs/.build-engine.lock"
must_fail "a local state file is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"
hostile file "engine/tools/.env"
must_fail "an .env file is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"
hostile file "docs/server.pem"
must_fail "a key file is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"
hostile file "engine/tools/.dev.vars"
must_fail "a Worker secrets file is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"
hostile file "engine/tools/wrangler.toml"
must_fail "a Worker config is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"
hostile file "docs/node_modules/x/package.json"
must_fail "a node_modules tree is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"
hostile file "variants/object-storage/README.md"
must_fail "a variants tree is caught" "not allowlisted" "$R/release/verify.sh" "$(ART)"
hostile file "conformance/signing-vectors.json"
must_fail "a conformance tree is caught" "not allowlisted" "$R/release/verify.sh" "$(ART)"
# the forbidden rules are a second, independent layer: even with the allowlist widened they still refuse
fresh; build; printf 'managed variants\nmanaged conformance\n' >> "$R/release/manifest.txt"
hostile file "variants/object-storage/README.md"
must_fail "a variants tree is caught even when the allowlist allows it" "forbidden path rule" "$R/release/verify.sh" "$(ART)"
hostile file "conformance/signing-vectors.json"
must_fail "a conformance tree is caught even when the allowlist allows it" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

# ---------------------------------------------------------------- the release gate
fresh; python3 - "$R" <<'PY'
import json, sys
p = sys.argv[1] + "/template/engine/release.json"; d = json.load(open(p)); d["protocol"] = "UNSET"; json.dump(d, open(p, "w"))
PY
plant; build
must_fail "release gate refuses an UNSET protocol" "protocol is missing or UNSET" "$R/release/verify.sh" "$(ART)" --release

fresh; cp "$R/gateway/read/reference/ctxgate.py" "$R/template/engine/tools/ctxgate.py"; plant; build
must_fail "gateway copied into an allowlisted directory is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

fresh; cp "$R/gateway/read/reference/ctxgate.py" "$R/template/engine/tools/transport.py"; plant; build
must_fail "gateway under a different name is caught by its code" "forbidden content rule" "$R/release/verify.sh" "$(ART)"

fresh; mkdir "$R/template/gateway"; echo x > "$R/template/gateway/readme.txt"; manifest_line "managed gateway"; build
must_fail "gateway directory added to the manifest is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

fresh; cp "$R/gateway/write/wrangler.toml" "$R/template/engine/tools/wrangler.toml"; plant; build
must_fail "Worker config copied into the payload is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

fresh; cp "$R/gateway/write/src/session/task-session.ts" "$R/template/engine/tools/session.ts"; plant; build
must_fail "Worker code under another name is caught by its content" "forbidden content rule" "$R/release/verify.sh" "$(ART)"

fresh; mkdir -p "$R/template/docs/variants"; echo x > "$R/template/docs/variants/readme.md"; plant; build
must_fail "a variants/ tree in the payload is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

# node_modules is refused by the packaging gate; the verifier still refuses it in a tampered artifact
fresh; build; mkdir "$T/x"; tar -xzf "$(ART)" -C "$T/x"; mkdir -p "$T/x/docs/node_modules/x"; echo '{}' > "$T/x/docs/node_modules/x/package.json"
(cd "$T/x" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | tar -cf - -T - | gzip -n > "$(ART)" ); (cd "$R/dist" && sha256sum "$(basename "$(ART)")" > "$(basename "$(ART)").sha256")
must_fail "node_modules in a tampered artifact is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"; rm -rf "$T/x"

fresh; build; mkdir "$T/x"; tar -xzf "$(ART)" -C "$T/x"; echo stray > "$T/x/evil.txt"
(cd "$T/x" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | tar -cf - -T - | gzip -n > "$(ART)" ); (cd "$R/dist" && sha256sum "$(basename "$(ART)")" > "$(basename "$(ART)").sha256")
must_fail "a file outside the allowlist is caught" "not allowlisted" "$R/release/verify.sh" "$(ART)"; rm -rf "$T/x"

fresh; printf 'token: %s\n' "ghp_$(printf 'A%.0s' $(seq 36))" > "$R/template/docs/leak.md"; plant; build
must_fail "a credential-shaped string is caught" "forbidden content rule" "$R/release/verify.sh" "$(ART)"

fresh; echo "9.9.9" > "$R/template/engine/VERSION"; plant; build
must_fail "version disagreement is caught" "version disagreement" "$R/release/verify.sh" "$(ART)"

fresh; build; printf 'x' >> "$(ART)"
must_fail "a tampered artifact fails its checksum" "checksum" "$R/release/verify.sh" "$(ART)"

fresh; echo "this is not python (" > "$R/template/engine/tools/broken.py"; plant; build
must_fail "a payload module that does not compile is caught" "does not compile" "$R/release/verify.sh" "$(ART)"

fresh; printf 'import unittest\nclass T(unittest.TestCase):\n    def test_x(self): self.fail("boom")\n' > "$R/template/engine/tools/test_broken.py"; plant; build
must_fail "a payload that fails its own tests is caught" "payload tests fail" "$R/release/verify.sh" "$(ART)" --test-payload

fresh; python3 - "$R" <<'PY'
import json, sys
p = sys.argv[1] + "/template/engine/release.json"; d = json.load(open(p)); d["protocol"] = "build-engine/0.5"
open(p, "w").write(json.dumps(d, indent=2) + "\n")
PY
plant; v="$(tr -d ' \n' < "$R/VERSION")"; sed -i "s/^## $v - unreleased\$/## $v - 2026-01-01/" "$R/CHANGELOG.md"; build
must_pass "release gate passes once the compatibility protocol version and a dated changelog entry exist" "$R/release/verify.sh" "$(ART)" --release

# ---------------------------------------------------------------- Stage 1.2: compatibility protocol gate
# helper: merge a JSON object into release.json (null deletes a key), date the changelog, commit, build
relprep() { python3 - "$R" "$1" <<'PY'
import json, sys
p = sys.argv[1] + "/template/engine/release.json"; d = json.load(open(p)); d.update(json.loads(sys.argv[2]))
for k in [k for k, v in d.items() if v is None]: del d[k]
open(p, "w").write(json.dumps(d, indent=2) + "\n")
PY
  local v; v="$(tr -d ' \n' < "$R/VERSION")"; sed -i "s/^## $v - unreleased\$/## $v - 2026-01-01/" "$R/CHANGELOG.md"; plant; build; }

fresh; relprep '{"implements_abstract": "build-engine/0.5"}'
must_fail "the retired implements_abstract key is rejected" "retired key implements_abstract" "$R/release/verify.sh" "$(ART)"

fresh; relprep '{"protocol": null, "implements_abstract": "build-engine/0.5"}'
must_fail "the retired key no longer satisfies the release gate" "retired key implements_abstract" "$R/release/verify.sh" "$(ART)" --release

fresh; relprep '{"protocol": "build-engine-0.5"}'
must_fail "a malformed protocol value is refused" "not of the form build-engine/<major>.<minor>" "$R/release/verify.sh" "$(ART)" --release

fresh; relprep '{"protocol": "build-engine/0.6"}'
must_fail "a protocol that disagrees with the release version is refused" "does not match release version" "$R/release/verify.sh" "$(ART)" --release

fresh; sed -i '/^| 0\.5\.0/d' "$R/COMPATIBILITY.md"; relprep '{"protocol": "build-engine/0.5"}'
must_fail "a missing COMPATIBILITY.md row is refused" "COMPATIBILITY.md has no row" "$R/release/verify.sh" "$(ART)" --release

fresh; sed -i -E 's#^\| 0\.5\.0( \(unreleased\))? \| build-engine/0\.5 \|#| 0.5.0\1 | build-engine/0.4 |#' "$R/COMPATIBILITY.md"; relprep '{"protocol": "build-engine/0.5"}'
must_fail "a COMPATIBILITY.md row with a different protocol is refused" "COMPATIBILITY.md has no row" "$R/release/verify.sh" "$(ART)" --release

# set-version.sh keeps every compatibility record in step, and running it twice changes nothing more
fresh; "$R/release/set-version.sh" 0.6.0 >/dev/null; "$R/release/set-version.sh" 0.6.0 >/dev/null
sv_ok=1
[[ "$(tr -d ' \n' < "$R/VERSION")" == 0.6.0 && "$(tr -d ' \n' < "$R/template/engine/VERSION")" == 0.6.0 ]] || sv_ok=0
python3 - "$R" <<'PY' || sv_ok=0
import json, sys
d = json.load(open(sys.argv[1] + "/template/engine/release.json"))
sys.exit(0 if d == {"engine_version": "0.6.0", "protocol": "build-engine/0.6"} else 1)
PY
[[ "$(grep -c '^| 0\.6\.0 (unreleased) | build-engine/0\.6 |' "$R/COMPATIBILITY.md")" == 1 ]] || sv_ok=0
[[ "$(grep -c '^## 0\.6\.0 - ' "$R/CHANGELOG.md")" == 1 ]] || sv_ok=0
[[ $sv_ok -eq 1 ]] && ok "set-version.sh syncs VERSION, release.json, COMPATIBILITY.md and CHANGELOG.md (idempotent)" || bad "set-version.sh left a compatibility record out of step"

"$R/release/set-version.sh" 0.6.1 >/dev/null
grep -q '"protocol": "build-engine/0.6"' "$R/template/engine/release.json" && grep -q '^| 0\.6\.1 (unreleased) | build-engine/0\.6 |' "$R/COMPATIBILITY.md" \
  && ok "a patch bump keeps the protocol and adds its own COMPATIBILITY.md row" || bad "a patch bump did not record its compatibility row"

sed -i "s/^## 0\.6\.1 - unreleased\$/## 0.6.1 - 2026-01-01/" "$R/CHANGELOG.md"; plant; build
must_pass "a version set with set-version.sh passes the release gate" "$R/release/verify.sh" "$(ART)" --release

echo "$PASS passed, $FAILN failed"; [[ $FAILN -eq 0 ]]
