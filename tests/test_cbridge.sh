#!/usr/bin/env bash
# test_cbridge.sh - Stage 2.3: Harden operator bridge and configuration
# Exercises cbridge commands in fully isolated temporary repositories.
# Does not require network or real GitHub credentials (CBRIDGE_NO_GH=1).
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CBRIDGE="$SRC/template/operator/cbridge"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

PASS=0; FAILN=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAILN=$((FAILN+1)); echo "  FAIL $1" >&2; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }
must_fail() {
  local name="$1" want="$2"; shift 2
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then
    ok "$name"
  else
    bad "$name (rc=$rc, wanted '$want', got: $(echo "$out" | tail -3 | tr '\n' ' '))"
  fi
}
must_ok() {
  local name="$1"; shift
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  if [[ $rc -eq 0 ]]; then ok "$name"; else bad "$name (rc=$rc: $(echo "$out" | tail -3 | tr '\n' ' '))"; fi
}

# ---------------------------------------------------------------------------
# Local bare-repo fixtures that stand in for private / upstream / outbox
# ---------------------------------------------------------------------------
setup_remotes() {
  local base="$1"
  mkdir -p "$base"/{private.git,upstream.git,outbox.git}

  git -C "$base/upstream.git" init -q --bare
  local u="$base/upstream-work"
  git clone -q "$base/upstream.git" "$u"
  git -C "$u" checkout -q -b main
  echo "public" > "$u/README.md"
  mkdir -p "$u/src"
  echo "code" > "$u/src/a.txt"
  git -C "$u" add -A
  git -C "$u" -c user.name=test -c user.email=t@t.com commit -q -m "upstream initial"
  git -C "$u" push -q origin main
  rm -rf "$u"

  git -C "$base/private.git" init -q --bare
  git -C "$base/outbox.git" init -q --bare
}

write_config() {
  local cfg="$1" base="$2"
  cat > "$cfg" <<EOF
PRIVATE_URL=$base/private.git
PRIVATE_SLUG=test/private-dev
UPSTREAM_URL=$base/upstream.git
UPSTREAM_SLUG=test/public
OUTBOX_URL=$base/outbox.git
OUTBOX_OWNER=test
WORKDIR=$base/work
ENGINE_WT=$base/engine
DENY_PATHS='^(engine/|plans/|\.github/)'
DENY_TEXT='private-dev|build-engine|plans/|submissions/'
GIT_NAME=cbridge-test
GIT_EMAIL=cbridge@test.local
EOF
  chmod 600 "$cfg"
}

run_cbridge() {
  local cfg="$1"; shift
  env CBRIDGE_CONFIG="$cfg" CBRIDGE_NO_GH=1 \
      PATH="/usr/bin:/bin:/usr/local/bin" \
      HOME="$T/home" \
      "$CBRIDGE" "$@"
}

echo "=== Stage 2.3 cbridge hardening tests ==="
echo

# ---------------------------------------------------------------------------
# 2.3.1 / 2.3.2  Missing / malformed configuration
# ---------------------------------------------------------------------------
echo "configuration and prerequisites"

CFG_MISSING="$T/no-such-config"
must_fail "missing config file" "missing config" \
  env CBRIDGE_CONFIG="$CFG_MISSING" CBRIDGE_NO_GH=1 "$CBRIDGE" doctor

setup_remotes "$T/r1"
write_config "$T/r1/config" "$T/r1"

# Empty PRIVATE_URL - the : "${PRIVATE_URL:?}" check at source time
printf 'PRIVATE_URL=\nPRIVATE_SLUG=x\nUPSTREAM_URL=x\nUPSTREAM_SLUG=x\nOUTBOX_URL=y\nOUTBOX_OWNER=z\n' > "$T/r1/config.empty"
out=$(env CBRIDGE_CONFIG="$T/r1/config.empty" CBRIDGE_NO_GH=1 "$CBRIDGE" doctor 2>&1) || rc=$?
if [[ ${rc:-0} -ne 0 ]]; then ok "empty required config var exits non-zero"; else bad "empty required config var should fail"; fi

# PRIVATE_URL == OUTBOX_URL rejected
write_config "$T/r1/config.same" "$T/r1"
sed -i 's|OUTBOX_URL=.*|OUTBOX_URL='"$T/r1/private.git"'|' "$T/r1/config.same"
must_fail "OUTBOX_URL must not equal PRIVATE_URL" "OUTBOX_URL must not be the private repo" \
  env CBRIDGE_CONFIG="$T/r1/config.same" CBRIDGE_NO_GH=1 "$CBRIDGE" doctor

# ---------------------------------------------------------------------------
# init + doctor + bootstrap + sync (isolated)
# ---------------------------------------------------------------------------
echo
echo "init / bootstrap / doctor / sync"

setup_remotes "$T/r2"
write_config "$T/r2/config" "$T/r2"
CFG="$T/r2/config"

must_ok "init" run_cbridge "$CFG" init
check "workdir has .git" test -d "$T/r2/work/.git"
check "upstream remote is read-only push" \
  bash -c "git -C '$T/r2/work' remote get-url --push upstream | grep -q DISABLED"

out=$(run_cbridge "$CFG" doctor 2>&1) && ok "doctor OK" || bad "doctor: $out"
[[ "$out" == *"privacy check skipped"* ]] && ok "doctor warns when CBRIDGE_NO_GH" || bad "doctor should warn about skipped privacy"

must_ok "bootstrap" run_cbridge "$CFG" bootstrap
# Explicit fetch so remote-tracking refs are present for the check
git -C "$T/r2/work" fetch -q --prune private
check "private main exists" git -C "$T/r2/work" rev-parse -q --verify refs/remotes/private/main
check "private build-engine exists" git -C "$T/r2/work" rev-parse -q --verify refs/remotes/private/build-engine

must_fail "bootstrap refuses existing main" "already has main" \
  run_cbridge "$CFG" bootstrap

must_ok "sync" run_cbridge "$CFG" sync
out=$(run_cbridge "$CFG" verify-main 2>&1); rc=$?
[[ $rc -eq 0 ]] && ok "verify-main equal (exit 0)" || bad "verify-main expected 0, got $rc ($out)"

# ---------------------------------------------------------------------------
# engine worktree helpers via halt / resume / upload
# ---------------------------------------------------------------------------
echo
echo "halt / resume / upload"

must_ok "halt global" run_cbridge "$CFG" halt
check "HALT marker on build-engine" test -f "$T/r2/engine/HALT"

must_ok "resume global" run_cbridge "$CFG" resume
check "HALT removed after resume" bash -c "! test -f '$T/r2/engine/HALT'"

# Simulate interrupted operation: remove engine path but leave worktree registration
rm -rf "$T/r2/engine"
# engine_sync must recover (prune + re-add)
must_ok "engine_sync recovers from missing worktree path" run_cbridge "$CFG" halt
must_ok "resume after recovery" run_cbridge "$CFG" resume

# Seed a plan into the recovered engine worktree and push it so upload can find it
mkdir -p "$T/r2/engine/plans/demo/tasks" "$T/r2/engine/engine/prompts"
echo '{"plan_id":"demo","title":"Demo","plan_number":"00001"}' > "$T/r2/engine/plans/demo/plan.json"
echo '{"stages":[{"id":"1-1","title":"S1"}],"phases":[{"id":"1","title":"P1"}]}' > "$T/r2/engine/plans/demo/stages.json"
git -C "$T/r2/engine" add -A
git -C "$T/r2/engine" -c user.name=cbridge-test -c user.email=cbridge@test.local \
  commit -q -m "seed plan demo"
git -C "$T/r2/engine" push -q private HEAD:refs/heads/build-engine

# Clean submission
SUB="$T/r2/submission"
mkdir -p "$SUB/task1/files/src"
echo '{"submission_id":"S001","plan_id":"demo"}' > "$SUB/SUBMISSION.json"
echo "## Summary" > "$SUB/task1/REPORT.md"
echo "payload" > "$SUB/task1/files/src/a.txt"

must_ok "upload clean submission" run_cbridge "$CFG" upload demo "$SUB"
check "submission landed" test -d "$T/r2/engine/plans/demo/submissions/S001"
check "UPLOAD.json written" test -f "$T/r2/engine/plans/demo/submissions/S001/UPLOAD.json"
check "MANIFEST.sha256 written" test -f "$T/r2/engine/plans/demo/submissions/S001/MANIFEST.sha256"

must_fail "duplicate upload rejected" "already exists" \
  run_cbridge "$CFG" upload demo "$SUB"

# Secret in submission rejected
echo "token ghp_abcdefghijklmnopqrstuvwx" > "$SUB/task1/files/src/secret.txt"
# Need a new submission id so we get past the existence check to the secret check
echo '{"submission_id":"S001b","plan_id":"demo"}' > "$SUB/SUBMISSION.json"
must_fail "secret pattern in submission rejected" "secret pattern" \
  run_cbridge "$CFG" upload demo "$SUB"
rm -f "$SUB/task1/files/src/secret.txt"
echo '{"submission_id":"S001","plan_id":"demo"}' > "$SUB/SUBMISSION.json"

# Zip with path traversal rejected
python3 - <<'PY' "$T/r2/evil2.zip"
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], "w")
z.writestr("../evil.txt", "bad")
z.writestr("SUBMISSION.json", '{"submission_id":"S002","plan_id":"demo"}')
z.close()
PY
must_fail "zip with .. paths rejected" "absolute or '..'" \
  run_cbridge "$CFG" upload demo "$T/r2/evil2.zip"

# ---------------------------------------------------------------------------
# publish guards (local only; no real gh PR)
# ---------------------------------------------------------------------------
echo
echo "publish guards"

git -C "$T/r2/work" fetch -q private
git -C "$T/r2/work" fetch -q upstream
git -C "$T/r2/work" checkout -q -B main refs/remotes/upstream/main

# Clean task branch
git -C "$T/r2/work" checkout -q -B task-T001
echo "change" >> "$T/r2/work/src/a.txt"
git -C "$T/r2/work" add -A
git -C "$T/r2/work" -c user.name=cbridge-test -c user.email=cbridge@test.local \
  commit -q -m "task change"
git -C "$T/r2/work" push -q private task-T001:refs/heads/task-T001

out=$(run_cbridge "$CFG" publish task-T001 -y 2>&1) || true
if [[ "$out" == *"denied paths"* || "$out" == *"DENY_TEXT"* || "$out" == *"secret pattern"* ]]; then
  bad "clean task branch incorrectly blocked: $out"
else
  ok "clean task branch passes local publish guards"
fi

# Branch that touches denied path (from clean main)
git -C "$T/r2/work" checkout -q -B task-BAD refs/remotes/upstream/main
mkdir -p "$T/r2/work/engine"
echo "leak" > "$T/r2/work/engine/secret.py"
git -C "$T/r2/work" add -A
git -C "$T/r2/work" -c user.name=cbridge-test -c user.email=cbridge@test.local \
  commit -q -m "touch engine"
git -C "$T/r2/work" push -q private task-BAD:refs/heads/task-BAD
must_fail "publish rejects denied paths" "denied paths" \
  run_cbridge "$CFG" publish task-BAD -y

# Branch with private name in commit message (from clean main, only src/)
git -C "$T/r2/work" checkout -q -B task-MSG refs/remotes/upstream/main
echo "ok" >> "$T/r2/work/src/a.txt"
git -C "$T/r2/work" add -A
git -C "$T/r2/work" -c user.name=cbridge-test -c user.email=cbridge@test.local \
  commit -q -m "fix for private-dev internal"
git -C "$T/r2/work" push -q private task-MSG:refs/heads/task-MSG
must_fail "publish rejects DENY_TEXT in commit message" "DENY_TEXT" \
  run_cbridge "$CFG" publish task-MSG -y

must_fail "publish rejects non task-* branch" "task-<id>" \
  run_cbridge "$CFG" publish main -y

# ---------------------------------------------------------------------------
# 2.3.4 Secrets must not appear in stdout/stderr
# ---------------------------------------------------------------------------
echo
echo "secret hygiene"

check "config is mode 600" bash -c "[[ \$(stat -c %a '$CFG') == 600 ]]"

if grep -EEq 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' "$CBRIDGE"; then
  bad "cbridge script contains hard-coded secret-like token"
else
  ok "cbridge script has no hard-coded secret tokens"
fi

out=$(run_cbridge "$CFG" status 2>&1 || true)
if echo "$out" | grep -EEq 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'; then
  bad "status output leaked a secret pattern"
else
  ok "status output free of secret patterns"
fi

# ---------------------------------------------------------------------------
# 2.3.5 Publication is explicit; bridge never auto-merges
# ---------------------------------------------------------------------------
echo
echo "explicit publication"

must_fail "publish without branch fails" "usage: publish" \
  run_cbridge "$CFG" publish

if grep -EEq '^\s*(cmd_merge|merge\)|auto-publish|auto_publish)' "$CBRIDGE"; then
  bad "cbridge exposes a merge/auto-publish command"
else
  ok "no merge/auto-publish command in cbridge"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "=== results: $PASS passed, $FAILN failed ==="
[[ $FAILN -eq 0 ]]
