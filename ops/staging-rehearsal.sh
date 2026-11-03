#!/usr/bin/env bash
# ops/staging-rehearsal.sh: prove that the disposable staging environment works, end to end.
#
# Stage 6.1 (plan task 6.1.2) establishes a disposable staging environment. A configuration that
# looks right is not a working environment, and this script is the difference between the two.
#
# It runs the two gateways against the REAL provider and the REAL local Workers runtime:
#
#   1. the **read** gateway is started with its staging configuration, a link is minted with the
#      SHIPPED client (`template/engine/tools/ctxlink.py`, the one that goes to consumers), and the
#      link is used to fetch the fixture file from the disposable source. The negative fixture,
#      which is outside the allowed prefixes, must be refused.
#
#   2. the **write** gateway is started with its staging configuration, a capability is minted with
#      the SHIPPED signing code, and the whole lifecycle is driven: create, append, read back,
#      commit, commit again, seal. The commit lands in the disposable submissions branch, the
#      retry must be a replay and not a second commit, and the writes after the seal must be
#      refused.
#
# Nothing is published. The two gateways run on the local runtime, which is the same code and the
# same runtime, and the provider is the real GitHub. That is a rehearsal and not a deployment:
# publishing is the operator's decision, with the operator's Cloudflare account.
#
# It needs one thing from the environment: GITHUB_TOKEN, a credential with write access to the
# disposable estate. The signing secrets are generated here and thrown away.
#
#     GITHUB_TOKEN=… ops/staging-rehearsal.sh
#
# It changes the disposable estate: it commits a file to the staging submissions branch. Run
# `ops/staging-estate.py dispose` afterwards to throw the estate away.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WRITE="$ROOT/gateway/write"
READ="$ROOT/gateway/read/production"
# A free port each: a leftover gateway from an earlier run must never be the one this run
# talks to, and two rehearsals must never fight over a port.
pick_port() {
  # A port from a fixed low range, not from the ephemeral range: the operating system hands the
  # ephemeral range out to outgoing connections, and a port that an outgoing connection takes
  # while the gateway is starting is a port the gateway cannot bind. 21000-21999 is below the
  # ephemeral range on every platform this runs on.
  python3 - <<'PYEOF'
import socket
for port in range(21000, 21999):
    probe = socket.socket()
    try:
        probe.bind(("127.0.0.1", port))
    except OSError:
        probe.close()
        continue
    probe.close()
    print(port)
    break
else:
    raise SystemExit("no free port between 21000 and 21999")
PYEOF
}
PORT_WRITE="$(pick_port)"
PORT_READ="$(pick_port)"

say() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }
fail() { printf '\n\033[1;31mREHEARSAL FAILED: %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "${GITHUB_TOKEN:-}" ] || fail "GITHUB_TOKEN is not set; it must be a credential with write access to the estate"

cleanup() {
  stop_gateway "$PORT_READ"
  stop_gateway "$PORT_WRITE"
}
trap cleanup EXIT

# Stop one gateway, completely.
#
# `wrangler dev` starts the Cloudflare runtime in a process group of its own, so killing the
# launcher leaves the runtime alive: it keeps the port, keeps its binary open and keeps
# answering requests. A "stop" that is not a stop is worse than no stop, because the next run
# talks to the gateway that was left behind. So the launcher goes first (it restarts the runtime
# if it notices the child died), and then the runtime itself.
stop_gateway() {
  local port="$1"
  pkill -f "wrangler dev --env staging --port $port" 2>/dev/null || true
  sleep 1
  pkill -f "socket-addr=entry=127.0.0.1:$port" 2>/dev/null || true
  sleep 1
}

# ---------------------------------------------------------------------------
say "the disposable estate"
python3 "$HERE/staging-estate.py" status || fail "the estate is not there; run staging-estate.py create"
SOURCE_HEAD="$(git --git-dir="$ROOT/.git" ls-remote origin "refs/heads/staging/source" | cut -f1)"
SUBMISSIONS_HEAD="$(git --git-dir="$ROOT/.git" ls-remote origin "refs/heads/staging/submissions" | cut -f1)"
[ -n "$SOURCE_HEAD" ] || fail "the staging source branch does not exist"
[ -n "$SUBMISSIONS_HEAD" ] || fail "the staging submissions branch does not exist"
note "staging/source        $SOURCE_HEAD"
note "staging/submissions   $SUBMISSIONS_HEAD"

# ---------------------------------------------------------------------------
say "the read gateway, against the real provider"
note "port $PORT_READ"
READ_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
READ_OPERATOR="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
cat > "$READ/.dev.vars.staging" <<EOF
SIGNING_KEYS={"s1":"$READ_SECRET"}
OPERATOR_TOKEN="$READ_OPERATOR"
GITHUB_TOKEN="$GITHUB_TOKEN"
EOF
chmod 600 "$READ/.dev.vars.staging"
# The launcher is started in its own session and then disowned, so that this shell does not
# announce its death when the gateway is stopped, and so that the whole tree can be stopped as
# one group.
WRANGLER_SEND_METRICS=false setsid bash -c 'cd "$1" && exec npx wrangler dev --env staging --port "$2" --ip 127.0.0.1' _ "$READ" "$PORT_READ" > /tmp/ctxgate-rehearsal-read.log 2>&1 &
disown
for _ in $(seq 1 40); do
  curl -s -m 2 "http://127.0.0.1:$PORT_READ/healthz" > /dev/null 2>&1 && break
  sleep 1
done
curl -s -m 5 "http://127.0.0.1:$PORT_READ/healthz" > /dev/null || fail "the read gateway did not start (see /tmp/ctxgate-rehearsal-read.log)"
note "the read gateway is running"

CTXGATE_SECRET="$READ_SECRET" python3 "$ROOT/template/engine/tools/ctxlink.py" mint \
  --base "http://127.0.0.1:$PORT_READ" --kid s1 --order wo-10008 --ref "$SOURCE_HEAD" --ttl 3600 \
  amk/context.md plans/pilot-001/package/brief.md plans/pilot-001/private/notes.md > /tmp/ctxgate-rehearsal-links.txt
ALLOWED="$(sed -n 1p /tmp/ctxgate-rehearsal-links.txt)"
SECOND="$(sed -n 2p /tmp/ctxgate-rehearsal-links.txt)"
DENIED="$(sed -n 3p /tmp/ctxgate-rehearsal-links.txt)"

CODE="$(curl -s -o /tmp/ctxgate-rehearsal-allowed.txt -w '%{http_code}' -m 20 "$ALLOWED")"
[ "$CODE" = "200" ] || fail "the allowed file was answered with $CODE"
grep -q "Context" /tmp/ctxgate-rehearsal-allowed.txt || fail "the allowed file did not come back"
note "the allowed file was served (200)"

CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$SECOND")"
[ "$CODE" = "200" ] || fail "the second allowed file was answered with $CODE"
note "the second allowed file was served (200)"

CODE="$(curl -s -o /tmp/ctxgate-rehearsal-denied.txt -w '%{http_code}' -m 20 "$DENIED")"
[ "$CODE" = "403" ] || fail "the file outside the allowed prefixes was answered with $CODE, expected 403"
note "the file outside the allowed prefixes was refused (403)"

stop_gateway "$PORT_READ"

# ---------------------------------------------------------------------------
say "the write gateway, against the real provider"
note "port $PORT_WRITE"
# The local runtime's Durable Object state is cleared, so that the rehearsal is repeatable: a
# task that a previous run sealed is still sealed, and a seal is durable by design (protocol
# section 8.4). This is the LOCAL runtime's state, not the estate: the estate is untouched.
rm -rf "$WRITE/.wrangler/state"
WRITE_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
WRITE_OPERATOR="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
cat > "$WRITE/.dev.vars.staging" <<EOF
SIGNING_KEYS={"sk1":"$WRITE_SECRET"}
GITHUB_TOKEN="$GITHUB_TOKEN"
OPERATOR_TOKEN="$WRITE_OPERATOR"
EOF
chmod 600 "$WRITE/.dev.vars.staging"
WRANGLER_SEND_METRICS=false setsid bash -c 'cd "$1" && exec npx wrangler dev --env staging --port "$2" --ip 127.0.0.1' _ "$WRITE" "$PORT_WRITE" > /tmp/ctxgate-rehearsal-write.log 2>&1 &
disown
for _ in $(seq 1 40); do
  curl -s -m 2 "http://127.0.0.1:$PORT_WRITE/healthz" > /dev/null 2>&1 && break
  sleep 1
done
curl -s -m 5 "http://127.0.0.1:$PORT_WRITE/healthz" > /dev/null || fail "the write gateway did not start (see /tmp/ctxgate-rehearsal-write.log)"
note "the write gateway is running"

DEPLOY_ENVIRONMENT="$(curl -s -m 5 "http://127.0.0.1:$PORT_WRITE/healthz" | python3 -c 'import sys,json; print(json.load(sys.stdin)["deploy_env"])')"
[ "$DEPLOY_ENVIRONMENT" = "staging" ] || fail "the write gateway reports the environment as '$DEPLOY_ENVIRONMENT'"
note "the write gateway reports deploy_env=staging"

export SIGNING_KEYS="{\"sk1\":\"$WRITE_SECRET\"}"
CAPABILITY="$(cd "$WRITE" && node --experimental-strip-types --import ./tests/helpers/register.mjs scripts/mint-root-url.ts \
  --kid sk1 --task 10008-1-001-01 --order wo-10008 --plan pilot-001 --writer agent-pilot \
  --head "$SUBMISSIONS_HEAD" --base "http://127.0.0.1:$PORT_WRITE" --ttl 3600 | sed -n 's/^capability: *//p')"
[ -n "$CAPABILITY" ] || fail "the capability could not be minted"
note "a capability was minted with the shipped signing code"

read -r DATA HASH < <(python3 - <<'PY'
import base64, hashlib
content = "# Pilot deliverable\n\nStaged by the Stage 6.1 rehearsal against the real provider.\n"
print(base64.urlsafe_b64encode(content.encode()).decode().rstrip("="), hashlib.sha256(content.encode()).hexdigest())
PY
)

jqf() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get("result")) if d.get("error") is None else "ERROR "+d["error"]["code"])'; }

RESULT="$(curl -s -m 30 "$CAPABILITY/create?path=report.md" | jqf)"
case "$RESULT" in *created*) note "the file was scaffolded" ;; *) fail "the create did not succeed: $RESULT" ;; esac

RESULT="$(curl -s -m 30 "$CAPABILITY/append?path=report.md&seq=1&hash=$HASH&data=$DATA" | jqf)"
case "$RESULT" in *sha256*) note "the chunk was staged" ;; *) fail "the append did not succeed: $RESULT" ;; esac

READBACK="$(curl -s -m 30 "$CAPABILITY/read?path=report.md")"
python3 - "$READBACK" "$HASH" <<'PYEOF' || fail "the staged content did not read back"
import base64, hashlib, json, sys
body = json.loads(sys.argv[1])
if body.get("error") is not None:
    print("the read back failed: " + body["error"]["code"], file=sys.stderr)
    raise SystemExit(1)
data = body["result"]["data"]
content = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8")
if hashlib.sha256(content.encode("utf-8")).hexdigest() != sys.argv[2]:
    print("the content that came back does not match the hash that went in", file=sys.stderr)
    raise SystemExit(1)
if "Pilot deliverable" not in content:
    print("the content that came back is not the content that was staged", file=sys.stderr)
    raise SystemExit(1)
PYEOF
note "the staged content reads back byte for byte"

COMMIT="$(curl -s -m 60 "$CAPABILITY/commit?files=report.md" | jqf)"
COMMIT_SHA="$(printf '%s' "$COMMIT" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["commit"])' 2>/dev/null || true)"
[ -n "$COMMIT_SHA" ] || fail "the commit did not succeed: $COMMIT"
note "the commit landed: $COMMIT_SHA"

REPLAY="$(curl -s -m 60 "$CAPABILITY/commit?files=report.md" | jqf)"
case "$REPLAY" in *'"replayed": true'*) note "the retry was a replay, not a second commit" ;; *) fail "the retry was not idempotent: $REPLAY" ;; esac

SEAL="$(curl -s -m 30 "$CAPABILITY/seal" | jqf)"
case "$SEAL" in *sealed*) note "the task was sealed" ;; *) fail "the seal did not succeed: $SEAL" ;; esac

RESULT="$(curl -s -m 30 "$CAPABILITY/create?path=after-the-seal.md" | jqf)"
case "$RESULT" in *"task-sealed"*) note "a write after the seal was refused" ;; *) fail "a write after the seal was accepted: $RESULT" ;; esac

# The commit is in the disposable branch, on the real provider.
REMOTE_HEAD="$(git --git-dir="$ROOT/.git" ls-remote origin "refs/heads/staging/submissions" | cut -f1)"
[ "$REMOTE_HEAD" = "$COMMIT_SHA" ] || fail "the branch head is $REMOTE_HEAD, not the commit $COMMIT_SHA"
note "the disposable branch points at the commit"

stop_gateway "$PORT_WRITE"

printf '\n\033[1;32mTHE REHEARSAL PASSED.\033[0m\n'
printf '   the read gateway served the authorised file and refused the unlisted one\n'
printf '   the write gateway staged, committed, replayed and sealed against the real provider\n'
printf '   the disposable estate now holds the pilot deliverable; dispose of it when the pilot is over\n'
