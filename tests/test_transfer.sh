#!/usr/bin/env bash
# test_transfer.sh - the submissions-to-consumer transfer (ADR 0015, BE-6).
#
# Exercises the transfer against local bare repositories and a stand-in for the write
# gateway's operator channel. No network, no real GitHub credentials, no real gateway.
#
# The stage is accepted by four negative tests, each named in the report: a tampered hash, a
# moved destination head, an unsealed folder, and a partial-failure injection. Each must leave
# the destination **exactly as it was**. The happy path is here too, because a transfer that
# only ever refuses is not a transfer.
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CBRIDGE="$SRC/template/operator/cbridge"
T="$(mktemp -d)"
trap 'rm -rf "$T"; [ -n "${GW_PID:-}" ] && kill "$GW_PID" 2>/dev/null' EXIT

PASS=0; FAILN=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAILN=$((FAILN+1)); echo "  FAIL $1" >&2; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }
must_ok() {
  local name="$1"; shift
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  if [[ $rc -eq 0 ]]; then ok "$name"; else bad "$name (rc=$rc: $(echo "$out" | tail -3 | tr '
' ' '))"; fi
}
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

ORDER="10008-S001"; TASK="10008-1-201-01"; PLAN="pilot-001"
FOLDER="plans/$PLAN/submissions/$ORDER/$TASK"
# the second task: the partial-failure case needs a branch of its own, because the happy path
# has already opened one for the first
ORDER2="10009-S002"; TASK2="10009-1-202-02"
FOLDER2="plans/$PLAN/submissions/$ORDER2/$TASK2"

# ---------------------------------------------------------------------------
# The stand-in for the write gateway's operator channel. It answers exactly one route, and
# the fact it answers is whatever the test wrote: that is how each negative case is set up.
# ---------------------------------------------------------------------------
stop_gateway() {
  if [ -n "${GW_PID:-}" ]; then kill "$GW_PID" 2>/dev/null; wait "$GW_PID" 2>/dev/null; GW_PID=""; fi
}

start_gateway() {
  local fact="$1" portfile="$2"
  python3 - "$fact" "$portfile" <<'PY' >/dev/null 2>&1 &
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

fact = json.loads(open(sys.argv[1]).read())
portfile = sys.argv[2]

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(fact).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass

httpd = HTTPServer(("127.0.0.1", 0), Handler)
open(portfile, "w").write(str(httpd.server_address[1]))
httpd.serve_forever()
PY
  GW_PID=$!
  local i
  for i in $(seq 1 50); do [ -s "$portfile" ] && break; sleep 0.1; done
  GW_URL="http://127.0.0.1:$(cat "$portfile")"
}

# ---------------------------------------------------------------------------
# The repositories: the submissions repository (private) and the consumer repository (public).
# ---------------------------------------------------------------------------
setup_repos() {
  local base="$1"
  mkdir -p "$base"
  git -C "$base" init -q --bare consumer.git
  git -C "$base" init -q --bare private.git
  git -C "$base" init -q --bare outbox.git
  local c="$base/consumer-work"
  git clone -q "$base/consumer.git" "$c"
  git -C "$c" checkout -q -b main
  echo "public" > "$c/README.md"
  git -C "$c" add -A
  git -C "$c" -c user.name=test -c user.email=t@t.com commit -q -m "consumer initial"
  git -C "$c" push -q origin main
  rm -rf "$c"
  CONSUMER_HEAD="$(git -C "$base/consumer.git" rev-parse main)"
  # the submissions branch, with the task folder and the operator's placeholder
  local p="$base/private-work"
  git clone -q "$base/private.git" "$p"
  git -C "$p" checkout -q -b submissions
  mkdir -p "$p/$FOLDER"
  echo "# deliverable" > "$p/$FOLDER/deliverable.md"
  echo "# notes" > "$p/$FOLDER/notes.md"
  : > "$p/$FOLDER/.keep"
  # a second task, for the case that needs a branch of its own
  mkdir -p "$p/$FOLDER2"
  echo "# deliverable" > "$p/$FOLDER2/deliverable.md"
  echo "# notes" > "$p/$FOLDER2/notes.md"
  : > "$p/$FOLDER2/.keep"
  git -C "$p" add -A
  git -C "$p" -c user.name=test -c user.email=t@t.com commit -q -m "sealed submission"
  git -C "$p" push -q origin submissions
  SEAL_COMMIT="$(git -C "$p" rev-parse HEAD)"
  DELIVERABLE_SHA="$(sha256sum "$p/$FOLDER/deliverable.md" | cut -d' ' -f1)"
  NOTES_SHA="$(sha256sum "$p/$FOLDER/notes.md" | cut -d' ' -f1)"
  rm -rf "$p"
}

write_config() {
  local cfg="$1" base="$2"
  cat > "$cfg" <<EOF
PRIVATE_URL=$base/private.git
PRIVATE_SLUG=test/dev
UPSTREAM_URL=$base/consumer.git
UPSTREAM_SLUG=test/public
OUTBOX_URL=$base/outbox.git
OUTBOX_OWNER=test
WORKDIR=$base/work
ENGINE_WT=$base/engine
DENY_PATHS='^(engine/|plans/|\.github/)'
DENY_TEXT='dev|build-engine|plans/|submissions/'
GIT_NAME=cbridge-test
GIT_EMAIL=cbridge@test.local
EOF
  chmod 600 "$cfg"
}

# The fact the gateway answers. The hashes are the gateway's own record of what it sealed.
write_fact() {
  local file="$1" attested="$2" d="$3" n="$4" task="${5:-$TASK}" order="${6:-$ORDER}"
  jq -n --arg sha "$SEAL_COMMIT" --arg d "$d" --arg n "$n" --argjson attested "$attested" \
    --arg task "$task" --arg order "$order" \
    '{ok:true, task:$task, order:$order, known:true, state:"sealed", committed:true,
      sealed:true,
      commit:{sha:$sha, files:2, at:1800000000, task_match:true, order_match:true,
              hashes:{"deliverable.md":$d,"notes.md":$n}},
      seal:{at:1800000100, commit:$sha, files:2}, seal_attested:$attested}' > "$file"
}

run_transfer() {
  local cfg="$1"; shift
  env CBRIDGE_CONFIG="$cfg" \
      CTXGATE_WRITE_URL="$GW_URL" OPERATOR_TOKEN="op-token" \
      PATH="$T/bin:/usr/bin:/bin:/usr/local/bin" \
      HOME="$T/home" \
      "$CBRIDGE" "$@"
}

# The consumer repository's branch list, which is what "nothing was written" means.
consumer_branches() {
  git -C "$1/consumer.git" for-each-ref --format='%(refname:strip=2)' refs/heads/ | sort | tr '\n' ' '
}

echo "=== the transfer (ADR 0015) ==="
echo

mkdir -p "$T/bin" "$T/home"

# a fake gh, so the pull-request step is exercised without a network
# A stand-in for the gh CLI. The transfer asks it two things: whether the private repository
# is private (the operator's privacy check) and to open the pull request.
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  api) echo "true"; exit 0 ;;
  pr) echo "pull request: https://github.com/test/public/pull/7" >&2; exit 0 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$T/bin/gh"

BASE="$T/base"
setup_repos "$BASE"
CFG="$BASE/config"
write_config "$CFG" "$BASE"
write_fact "$BASE/fact.json" true "$DELIVERABLE_SHA" "$NOTES_SHA"
start_gateway "$BASE/fact.json" "$BASE/port"

echo "the happy path"

# the operator's clone, as `cbridge init` would make it
must_ok "init" env CBRIDGE_CONFIG="$CFG" CBRIDGE_NO_GH=1 PATH="/usr/bin:/bin:/usr/local/bin" HOME="$T/home" "$CBRIDGE" init

out=$(run_transfer "$CFG" transfer "$PLAN" "$ORDER" "$TASK" \
      --expect-head "$CONSUMER_HEAD" --dest-root "accepted/$ORDER" --title "Task $TASK" -y 2>&1) && rc=0 || rc=$?
if [[ ${rc:-0} -eq 0 ]]; then ok "the transfer succeeds"; else bad "the transfer failed: $(echo "$out" | tail -4 | tr '\n' ' ')"; fi
check "the branch exists in the consumer repository" \
  bash -c "git -C '$BASE/consumer.git' rev-parse --verify refs/heads/transfer/$ORDER >/dev/null 2>&1"
check "the file landed at the destination path" \
  bash -c "git -C '$BASE/consumer.git' show 'transfer/$ORDER:accepted/$ORDER/deliverable.md' | grep -q deliverable >/dev/null 2>&1"
check "the placeholder was not transferred" \
  bash -c "! git -C '$BASE/consumer.git' ls-tree -r --name-only 'transfer/$ORDER' | grep -q '\.keep' >/dev/null 2>&1"
check "the default branch was not written to" \
  bash -c "[ \"\$(git -C '$BASE/consumer.git' rev-parse main)\" = '$CONSUMER_HEAD' ]"
check "the audit record was written" \
  bash -c "ls '$BASE/work/transfer-audit/'*.json >/dev/null 2>&1"
check "the audit record carries no credential" \
  bash -c "! grep -qiE 'op-token|authorization|Bearer' '$BASE/work/transfer-audit/'*.json >/dev/null 2>&1"
check "the audit record names the sealed commit" \
  bash -c "grep -q '$SEAL_COMMIT' '$BASE/work/transfer-audit/'*.json >/dev/null 2>&1"

echo
echo "the four negative tests, each leaving the destination unchanged"

BEFORE="$(consumer_branches "$BASE")"

# (1) a tampered hash
cp "$BASE/fact.json" "$BASE/fact.tampered.json"
TAMPERED="$(printf '%064d' 1)"
write_fact "$BASE/fact.tampered.json" true "$TAMPERED" "$NOTES_SHA"
stop_gateway
start_gateway "$BASE/fact.tampered.json" "$BASE/port2"
GW_URL="http://127.0.0.1:$(cat "$BASE/port2")"
must_fail "a tampered hash is refused" "do not match the hash" \
  run_transfer "$CFG" transfer "$PLAN" "$ORDER" "$TASK" \
    --expect-head "$CONSUMER_HEAD" --dest-root "accepted/$ORDER" -y
check "nothing was written after the tampered hash" \
  bash -c "[ \"\$(git -C '$BASE/consumer.git' for-each-ref --format='%(refname:strip=2)' refs/heads/ | sort | tr '\n' ' ')\" = '$BEFORE' ]"

# (2) a moved destination head
stop_gateway
write_fact "$BASE/fact.json" true "$DELIVERABLE_SHA" "$NOTES_SHA"
stop_gateway
start_gateway "$BASE/fact.json" "$BASE/port3"
GW_URL="http://127.0.0.1:$(cat "$BASE/port3")"
must_fail "a moved destination head is refused" "destination head moved" \
  run_transfer "$CFG" transfer "$PLAN" "$ORDER" "$TASK" \
    --expect-head "0000000000000000000000000000000000000000" --dest-root "accepted/$ORDER" -y
check "nothing was written after the moved head" \
  bash -c "[ \"\$(git -C '$BASE/consumer.git' for-each-ref --format='%(refname:strip=2)' refs/heads/ | sort | tr '\n' ' ')\" = '$BEFORE' ]"

# (3) an unsealed folder
stop_gateway
write_fact "$BASE/fact.unsealed.json" false "$DELIVERABLE_SHA" "$NOTES_SHA"
stop_gateway
start_gateway "$BASE/fact.unsealed.json" "$BASE/port4"
GW_URL="http://127.0.0.1:$(cat "$BASE/port4")"
must_fail "an unsealed folder is refused" "not sealed" \
  run_transfer "$CFG" transfer "$PLAN" "$ORDER" "$TASK" \
    --expect-head "$CONSUMER_HEAD" --dest-root "accepted/$ORDER" -y
check "nothing was written after the unsealed folder" \
  bash -c "[ \"\$(git -C '$BASE/consumer.git' for-each-ref --format='%(refname:strip=2)' refs/heads/ | sort | tr '\n' ' ')\" = '$BEFORE' ]"

# (4) a partial failure: the branch is pushed, then the pull request cannot be opened
stop_gateway
write_fact "$BASE/fact.json" true "$DELIVERABLE_SHA" "$NOTES_SHA"
stop_gateway
start_gateway "$BASE/fact.json" "$BASE/port5"
GW_URL="http://127.0.0.1:$(cat "$BASE/port5")"
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  api) echo "true"; exit 0 ;;
  pr) echo "gh: could not open the pull request" >&2; exit 1 ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$T/bin/gh"
write_fact "$BASE/fact.second.json" true "$DELIVERABLE_SHA" "$NOTES_SHA" "$TASK2" "$ORDER2"
stop_gateway
start_gateway "$BASE/fact.second.json" "$BASE/port6"
GW_URL="http://127.0.0.1:$(cat "$BASE/port6")"
must_fail "a pull request that cannot be opened refuses" "could not be opened" \
  run_transfer "$CFG" transfer "$PLAN" "$ORDER2" "$TASK2" \
    --expect-head "$CONSUMER_HEAD" --dest-root "accepted/$ORDER2" -y
check "the branch was removed, so the destination is unchanged" \
  bash -c "[ \"\$(git -C '$BASE/consumer.git' for-each-ref --format='%(refname:strip=2)' refs/heads/ | sort | tr '\n' ' ')\" = '$BEFORE' ]"

echo
echo "the refusals are recorded"
check "an audit record exists for the refusal" \
  bash -c "[ \$(ls '$BASE/work/transfer-audit/'*.json >/dev/null 2>&1; ls '$BASE/work/transfer-audit/'*.json | wc -l) -gt 1 ]"
check "no audit record carries a credential" \
  bash -c "! grep -rqiE 'op-token|Bearer' '$BASE/work/transfer-audit/' >/dev/null 2>&1"

echo
echo "---"
echo "passed: $PASS   failed: $FAILN"
[ "$FAILN" -eq 0 ] || exit 1
