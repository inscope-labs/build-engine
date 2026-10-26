#!/usr/bin/env bash
# test-release.sh - self-test of the release machinery. Proves the pipeline passes on a clean tree AND fails,
# for the stated reason, on each mistake it exists to catch (above all: the gateway leaking into a release).
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILN=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAILN=$((FAILN+1)); echo "  FAIL $1" >&2; }

fresh() { rm -rf "$T/r"; mkdir "$T/r"; (cd "$SRC" && tar --exclude=.git --exclude=dist --exclude=node_modules -cf - .) | tar -C "$T/r" -xf -; R="$T/r"; }
build() { rm -rf "$R/dist"; "$R/release/package.sh" "$R/dist" >"$T/pkg.out" 2>&1; }
ART() { echo "$R/dist/build-engine-v$(tr -d ' \n' < "$R/VERSION").tar.gz"; }
# must_fail "<name>" "<expected text>" cmd...
must_fail() { local name="$1" want="$2"; shift 2; local out; out="$("$@" 2>&1)"; local rc=$?
  if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then ok "$name"; else bad "$name (rc=$rc, wanted '$want', got: $(echo "$out" | tail -2 | tr '\n' ' '))"; fi; }
must_pass() { local name="$1"; shift; if "$@" >"$T/o" 2>&1; then ok "$name"; else bad "$name: $(tail -3 "$T/o" | tr '\n' ' ')"; fi; }

echo "release machinery self-test"
fresh; must_pass "clean tree packages" build
must_pass "clean artifact verifies" "$R/release/verify.sh" "$(ART)"
a="$(sha256sum "$(ART)" | cut -d' ' -f1)"; build; [[ "$a" == "$(sha256sum "$(ART)" | cut -d' ' -f1)" ]] && ok "packaging is reproducible" || bad "packaging is not reproducible"
must_fail "release gate refuses an UNSET abstract version / undated changelog" "UNSET" "$R/release/verify.sh" "$(ART)" --release
[[ -z "$(tar -tzf "$(ART)" | grep -E '(^|/)(gateway/|ctxgate\.py|test_ctxgate\.py)')" ]] && ok "clean artifact has no gateway file" || bad "clean artifact contains gateway files"

fresh; cp "$R/gateway/ctxgate.py" "$R/template/engine/tools/ctxgate.py"; build
must_fail "gateway copied into an allowlisted directory is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

fresh; cp "$R/gateway/ctxgate.py" "$R/template/engine/tools/transport.py"; build
must_fail "gateway under a different name is caught by its code" "forbidden content rule" "$R/release/verify.sh" "$(ART)"

fresh; mkdir "$R/template/gateway"; echo x > "$R/template/gateway/readme.txt"; echo "managed gateway" >> "$R/release/manifest.txt"; build
must_fail "gateway directory added to the manifest is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

fresh; cp "$R/gateway/write/wrangler.toml" "$R/template/engine/tools/wrangler.toml"; build
must_fail "Worker config copied into the payload is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

fresh; cp "$R/gateway/write/src/session/task-session.ts" "$R/template/engine/tools/session.ts"; build
must_fail "Worker code under another name is caught by its content" "forbidden content rule" "$R/release/verify.sh" "$(ART)"

fresh; mkdir -p "$R/template/docs/node_modules/x"; echo '{}' > "$R/template/docs/node_modules/x/package.json"; build
must_fail "node_modules in the payload is caught" "forbidden path rule" "$R/release/verify.sh" "$(ART)"

fresh; echo "managed does/not/exist" >> "$R/release/manifest.txt"
must_fail "manifest entry that does not exist stops packaging" "does not exist" "$R/release/package.sh" "$R/dist"

fresh; ln -s ../../docs/GATES.md "$R/template/engine/tools/link.md"
must_fail "symlink stops packaging" "symlink" "$R/release/package.sh" "$R/dist"

fresh; build; mkdir "$T/x"; tar -xzf "$(ART)" -C "$T/x"; echo stray > "$T/x/evil.txt"
(cd "$T/x" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | tar -cf - -T - | gzip -n > "$(ART)" ); (cd "$R/dist" && sha256sum "$(basename "$(ART)")" > "$(basename "$(ART)").sha256")
must_fail "a file outside the allowlist is caught" "not allowlisted" "$R/release/verify.sh" "$(ART)"; rm -rf "$T/x"

fresh; printf 'token: %s\n' "ghp_$(printf 'A%.0s' $(seq 36))" > "$R/template/docs/leak.md"; build
must_fail "a credential-shaped string is caught" "forbidden content rule" "$R/release/verify.sh" "$(ART)"

fresh; echo "9.9.9" > "$R/template/engine/VERSION"; build
must_fail "version disagreement is caught" "version disagreement" "$R/release/verify.sh" "$(ART)"

fresh; build; printf 'x' >> "$(ART)"
must_fail "a tampered artifact fails its checksum" "checksum" "$R/release/verify.sh" "$(ART)"

fresh; echo "this is not python (" > "$R/template/engine/tools/broken.py"; build
must_fail "a payload module that does not compile is caught" "does not compile" "$R/release/verify.sh" "$(ART)"

fresh; printf 'import unittest\nclass T(unittest.TestCase):\n    def test_x(self): self.fail("boom")\n' > "$R/template/engine/tools/test_broken.py"; build
must_fail "a payload that fails its own tests is caught" "payload tests fail" "$R/release/verify.sh" "$(ART)"

fresh; python3 - "$R" <<'PY'
import json, sys
p = sys.argv[1] + "/template/engine/ENGINE.json"; d = json.load(open(p)); d["implements_abstract"] = "1.2.3"
open(p, "w").write(json.dumps(d, indent=2) + "\n")
PY
v="$(tr -d ' \n' < "$R/VERSION")"; sed -i "s/^## $v - unreleased\$/## $v - 2026-01-01/" "$R/CHANGELOG.md"; build
must_pass "release gate passes once the abstract version and a dated changelog entry exist" "$R/release/verify.sh" "$(ART)" --release

echo "$PASS passed, $FAILN failed"; [[ $FAILN -eq 0 ]]
