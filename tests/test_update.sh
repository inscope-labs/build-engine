#!/usr/bin/env bash
# test_update.sh - the consumer side: install a release into a fresh git repo, then update it, and check the
# guarantees that matter (checksum enforced, seed config preserved, local edits never silently overwritten,
# dropped files removed, the gateway never present, the installed engine actually runs).
set -uo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAILN=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAILN=$((FAILN+1)); echo "  FAIL $1" >&2; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }
must_fail() { local name="$1" want="$2"; shift 2; local out; out="$("$@" 2>&1)"; local rc=$?
  if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then ok "$name"; else bad "$name (rc=$rc, wanted '$want', got: $(echo "$out" | tail -2 | tr '\n' ' '))"; fi; }

# a private copy of the source repo so the test can build two releases. The copy is a git checkout
# because the artifact is built from the tracked file list (Stage 3.1): a release is built from a
# committed tree, and so is this test.
mkdir "$T/src"; (cd "$SRC" && tar --exclude=.git --exclude=dist --exclude=node_modules -cf - .) | tar -C "$T/src" -xf -
( cd "$T/src" && git init -q && git config user.email test@example.invalid && git config user.name test && git add -A && git commit -qm baseline )
"$T/src/release/package.sh" "$T/d1" >/dev/null
V1="$(tr -d ' \n' < "$T/src/VERSION")"

echo "consumer update flow"
C="$T/consumer"; mkdir "$C"; git -C "$C" init -q; mkdir "$C/plans"
tar -xzf "$T/d1/build-engine-v$V1.tar.gz" -O engine/bin/update.sh > "$T/update.sh"
( cd "$C" && bash "$T/update.sh" --from-dir "$T/d1" --version "$V1" --repo OWNER/build-engine ) >"$T/o1" 2>&1 && ok "first install from a release directory" || bad "first install: $(tail -3 "$T/o1")"
check "payload installed" test -f "$C/engine/tools/plan_tool.py"
check "no gateway installed" bash -c "! find '$C' -path '$C/.git' -prune -o \( -name 'ctxgate.py' -o -name test_ctxgate.py -o -type d -name gateway \) -print | grep -q ."
check "seed config created" test -f "$C/engine/engine.json"
check "lock records repo and version" bash -c "grep -q '^version=$V1\$' '$C/.build-engine.lock' && grep -q '^repo=OWNER/build-engine\$' '$C/.build-engine.lock'"
check "installed engine passes its own tests" bash -c "cd '$C' && python3 -m unittest discover -s engine/tools >/dev/null 2>&1"
check "installed engine can create a plan" bash -c "cd '$C' && python3 engine/tools/plan_tool.py new demo --number 00001 --title Demo >/dev/null 2>&1 && test -f plans/demo/plan.json"

# consumer-owned config survives; an unchanged re-run is a no-op
sed -i 's#OWNER/PROJECT-dev#acme/widget-dev#' "$C/engine/engine.json"
( cd "$C" && bash engine/bin/update.sh --from-dir "$T/d1" --version "$V1" ) >"$T/o2" 2>&1 && ok "re-running the same version succeeds" || bad "re-run: $(tail -3 "$T/o2")"
check "seed config is not overwritten" grep -q 'acme/widget-dev' "$C/engine/engine.json"

# local edit of a managed file is a conflict
echo "local tweak" >> "$C/engine/AGENTS.md"; cp "$C/engine/AGENTS.md" "$T/agents.edited"
( cd "$C" && git add -A && git -c user.name=t -c user.email=t@x commit -qm base )
must_fail "a locally edited managed file blocks the update" "conflicts above" bash -c "cd '$C' && bash engine/bin/update.sh --from-dir '$T/d1' --version '$V1'"
check "...and nothing was changed" cmp -s "$C/engine/AGENTS.md" "$T/agents.edited"
( cd "$C" && bash engine/bin/update.sh --from-dir "$T/d1" --version "$V1" --force ) >/dev/null 2>&1
check "--force restores the released file" bash -c "! grep -q 'local tweak' '$C/engine/AGENTS.md'"

# a pre-existing, unrecorded file at a managed path is also a conflict (adopting an existing repo)
D="$T/adopt"; mkdir "$D"; git -C "$D" init -q; mkdir -p "$D/engine"; echo old > "$D/engine/AGENTS.md"
must_fail "first install over an existing engine file needs --force" "was not installed by update.sh" bash -c "cd '$D' && bash '$T/update.sh' --from-dir '$T/d1' --version '$V1'"

# second release: bump, add a doc, drop a doc. The change is committed first: a release is built
# from a committed tree.
( cd "$T/src" && release/set-version.sh 0.5.1 >/dev/null && echo "# new" > template/docs/NEW.md && rm template/docs/TEMPLATE.md \
  && git add -A && git commit -qm "release 0.5.1" )
"$T/src/release/package.sh" "$T/d2" >/dev/null
( cd "$C" && git add -A && git -c user.name=t -c user.email=t@x commit -qm v1 --allow-empty && bash engine/bin/update.sh --from-dir "$T/d2" --version 0.5.1 ) >"$T/o3" 2>&1 && ok "update to the next release" || bad "update: $(tail -3 "$T/o3")"
check "new file added" test -f "$C/docs/NEW.md"
check "file dropped by the release removed" test ! -e "$C/docs/TEMPLATE.md"
check "lock moved to the new version" grep -q '^version=0.5.1$' "$C/.build-engine.lock"
check "seed config still the consumer's" grep -q 'acme/widget-dev' "$C/engine/engine.json"
must_fail "--dry-run reports and exits" "dry run" bash -c "cd '$C' && bash engine/bin/update.sh --from-dir '$T/d1' --version '$V1' --dry-run && exit 1"
check "...and changes nothing" bash -c "test -f '$C/docs/NEW.md' && test ! -e '$C/docs/TEMPLATE.md' && grep -q '^version=0.5.1\$' '$C/.build-engine.lock'"

# integrity: a tampered artifact is refused before anything is unpacked
mkdir "$T/d3"; cp "$T/d2"/* "$T/d3"/; printf 'x' >> "$T/d3/build-engine-v0.5.1.tar.gz"
before="$(cd "$C" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)"
must_fail "a tampered artifact is refused" "checksum mismatch" bash -c "cd '$C' && bash engine/bin/update.sh --from-dir '$T/d3' --version 0.5.1"
after="$(cd "$C" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)"
[[ "$before" == "$after" ]] && ok "...and the repository is untouched" || bad "repository changed after a refused update"

echo "$PASS passed, $FAILN failed"; [[ $FAILN -eq 0 ]]
