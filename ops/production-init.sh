#!/usr/bin/env bash
# Initialise the PRODUCTION Workers: set their three secrets (SIGNING_KEYS, OPERATOR_TOKEN,
# GITHUB_TOKEN), and create a Worker that does not exist yet only when asked to.
#
#   ops/production-init.sh --target read|write|both --reason "why" \
#       [--replace yes|no] [--create-if-missing yes|no]
#
# The production counterpart of ops/staging-init.sh, with three deliberate differences:
#
#   1. It refuses to run while the production configuration still carries a placeholder (the
#      read gateway's host and source repository, the write gateway's submissions repository).
#      A secret set on a gateway that points nowhere is a secret nobody can use or audit.
#   2. It never creates a Worker unless --create-if-missing yes is given. A Worker with no
#      SIGNING_KEYS refuses to start, so creating one is safe, but it is still a production
#      publish and is therefore an explicit choice.
#   3. The GitHub credentials are the PRODUCTION environment's own (READ_GH_TOKEN and
#      WRITE_GH_TOKEN of the `production` environment), never staging's (ADR 0008: distinct
#      credentials per environment).
#
# SIGNING_KEYS and OPERATOR_TOKEN are generated here. Cloudflare cannot show a secret again once
# it is set, so the generated values are also written to an encrypted bundle that only the holder
# of the delivery private key can read. Nothing secret is ever printed.
#
# Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DELIVERY_PUBLIC_KEY (PEM, RSA),
#              READ_GH_TOKEN (read), WRITE_GH_TOKEN (write), OUT_DIR (default ./out).
# Production only. This script never touches the staging Workers.
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=""; REASON=""; REPLACE="no"; CREATE="no"; OUT="${OUT_DIR:-$ROOT/out}"

fail() { echo "production-init: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --replace) REPLACE="${2:-}"; shift 2 ;;
    --create-if-missing) CREATE="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

case "$TARGET" in read|write|both) ;; *) fail "--target must be read, write or both" ;; esac
case "$REPLACE" in yes|no) ;; *) fail "--replace must be yes or no" ;; esac
case "$CREATE" in yes|no) ;; *) fail "--create-if-missing must be yes or no" ;; esac
[ -n "$REASON" ] || fail "--reason is required"
if [ -n "${GITHUB_REF:-}" ] && [ "$GITHUB_REF" != "refs/heads/main" ]; then
  fail "this may only run from main, not from $GITHUB_REF"
fi

need() { [ -n "${!1:-}" ] || fail "$1 is not set"; }
need CLOUDFLARE_API_TOKEN; need CLOUDFLARE_ACCOUNT_ID; need DELIVERY_PUBLIC_KEY
{ [ "$TARGET" = write ] || need READ_GH_TOKEN; }
{ [ "$TARGET" = read ] || need WRITE_GH_TOKEN; }

TMP="$(mktemp -d)"; chmod 700 "$TMP"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
printf '%s\n' "$DELIVERY_PUBLIC_KEY" > "$TMP/delivery.pub.pem"
openssl pkey -pubin -in "$TMP/delivery.pub.pem" -noout 2>/dev/null \
  || fail "DELIVERY_PUBLIC_KEY is not a valid public key (PEM)"

rand() { python3 -c 'import secrets,sys;print(secrets.token_hex(int(sys.argv[1])))' "$1"; }

READ_ENV="$ROOT/gateway/read/production/ops/environments.json"
WRITE_TOML="$ROOT/gateway/write/wrangler.toml"

# --- the production configuration must be real before a secret is set on it ---
placeholders_read() {
  python3 - "$READ_ENV" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))["environments"]["production"]
bad=[]
for r in p.get("routes",[]):
    if "REPLACE" in r.get("pattern","") or not r.get("pattern"): bad.append("route "+r.get("pattern",""))
repo=p.get("vars",{}).get("GITHUB_REPO","")
if not repo or "OWNER/REPO" in repo: bad.append("GITHUB_REPO "+repo)
print("; ".join(bad))
PY
}
if [ "$TARGET" = read ] || [ "$TARGET" = both ]; then
  bad="$(placeholders_read)"
  [ -z "$bad" ] || fail "the read gateway's production configuration still has a placeholder ($bad): name the production host and source repository first"
fi
if [ "$TARGET" = write ] || [ "$TARGET" = both ]; then
  python3 "$ROOT/gateway/write/scripts/check-production.py" >/dev/null \
    || fail "the write gateway's production configuration is not deployable: run gateway/write/scripts/check-production.py to see why"
fi

# --- values from the repository's own configuration, never from here ---
read_key_id() {
  python3 - "$READ_ENV" <<'PY'
import json,sys
ids=json.load(open(sys.argv[1]))["environments"]["production"]["key_ids"]
assert len(ids)==1, "expected exactly one production key id"
print(ids[0])
PY
}
read_worker() {
  python3 - "$READ_ENV" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))["environments"]["production"]["worker_name"])
PY
}
write_key_id() {
  python3 - "$WRITE_TOML" <<'PY'
import sys,tomllib
d=tomllib.load(open(sys.argv[1],"rb"))
ids=[i.strip() for i in d["vars"]["SIGNING_KEY_IDS"].split(",") if i.strip()]
assert len(ids)==1, "expected exactly one production key id"
print(ids[0])
PY
}
write_worker() {
  python3 - "$WRITE_TOML" <<'PY'
import sys,tomllib
print(tomllib.load(open(sys.argv[1],"rb"))["name"])
PY
}

echo '{}' > "$TMP/bundle.json"; chmod 600 "$TMP/bundle.json"
SUMMARY="$TMP/summary.md"
{ echo "## Production init"; echo; echo "Reason: $REASON"; echo; } > "$SUMMARY"

# init_one LABEL DIR GITHUB_TOKEN KEY_ID WORKER [wrangler environment args...]
# The read gateway's production is `--env production`; the write gateway's production is the
# top-level configuration, which takes no environment argument.
init_one() {
  local label="$1" dir="$2" ghtoken="$3" keyid="$4" worker="$5"; shift 5
  local envargs=("$@")
  local signing operator signing_json listed err
  echo "== $label gateway ($worker)"
  cd "$ROOT/$dir"
  npm ci --no-audit --no-fund >/dev/null

  # No permissive fallback: a wrangler that cannot list the secrets is reported as such,
  # instead of being flattened into an empty list that the checks below read as "no secrets
  # yet". Both readings block or permit the same way here, but only one of them tells the
  # operator what actually happened.
  if ! listed="$(npx wrangler secret list "${envargs[@]}" 2>&1)"; then
    fail "$label: wrangler could not list the production Worker's secrets: $(printf '%s' "$listed" | tail -n 1)"
  fi
  if printf '%s' "$listed" | grep -q SIGNING_KEYS \
     && printf '%s' "$listed" | grep -q OPERATOR_TOKEN \
     && printf '%s' "$listed" | grep -q GITHUB_TOKEN \
     && [ "$REPLACE" != yes ]; then
    fail "$label production already has its secrets. Re-run with replace=yes to replace them (this invalidates every link and token minted for production)."
  fi

  signing="$(rand 32)"; operator="$(rand 24)"
  signing_json="$(KEYID="$keyid" SIG="$signing" python3 -c 'import json,os;print(json.dumps({os.environ["KEYID"]:os.environ["SIG"]}))')"

  put() { printf '%s' "$2" | npx wrangler secret put "$1" "${envargs[@]}" >/dev/null; }
  err="$TMP/err.txt"
  if ! put GITHUB_TOKEN "$ghtoken" 2>"$err"; then
    cat "$err" >&2
    [ "$CREATE" = yes ] || fail "$label: the Worker probably does not exist yet. Re-run with create_if_missing=yes to create it with one production deploy (it starts with no secrets and refuses to serve until they are set)."
    echo "creating the production Worker with one deploy"
    npx wrangler deploy "${envargs[@]}" 2>&1 | tee "$TMP/deploy-$label.txt" >&2
    put GITHUB_TOKEN "$ghtoken"
  fi
  put SIGNING_KEYS "$signing_json"
  put OPERATOR_TOKEN "$operator"

  if ! listed="$(npx wrangler secret list "${envargs[@]}" 2>&1)"; then
    fail "$label: wrangler could not list the production Worker's secrets after the run: $(printf '%s' "$listed" | tail -n 1)"
  fi
  for s in SIGNING_KEYS OPERATOR_TOKEN GITHUB_TOKEN; do
    printf '%s' "$listed" | grep -q "$s" || fail "$label: $s is not set after the run"
  done

  LABEL="$label" WORKER="$worker" KEYID="$keyid" SIG="$signing" OP="$operator" B="$TMP/bundle.json" python3 - <<'PY'
import json,os
b=json.load(open(os.environ["B"]))
b[os.environ["LABEL"]]={"worker":os.environ["WORKER"],"key_id":os.environ["KEYID"],
  "signing_secret":os.environ["SIG"],"operator_token":os.environ["OP"]}
json.dump(b,open(os.environ["B"],"w"))
PY
  echo "- **$label**: Worker \`$worker\`, key id \`$keyid\`, secrets set: SIGNING_KEYS, OPERATOR_TOKEN, GITHUB_TOKEN" >> "$SUMMARY"
  cd "$ROOT"
}

if [ "$TARGET" = read ] || [ "$TARGET" = both ]; then
  init_one read gateway/read/production "$READ_GH_TOKEN" "$(read_key_id)" "$(read_worker)" --env production
fi
if [ "$TARGET" = write ] || [ "$TARGET" = both ]; then
  init_one write gateway/write "$WRITE_GH_TOKEN" "$(write_key_id)" "$(write_worker)"
fi

# Hybrid encryption: a random AES key encrypts the bundle; the delivery public key encrypts that key.
mkdir -p "$OUT"
openssl rand -out "$TMP/bundle.key" 32
openssl enc -aes-256-cbc -pbkdf2 -pass "file:$TMP/bundle.key" -in "$TMP/bundle.json" -out "$OUT/bundle.json.enc"
openssl pkeyutl -encrypt -pubin -inkey "$TMP/delivery.pub.pem" -pkeyopt rsa_padding_mode:oaep \
  -in "$TMP/bundle.key" -out "$OUT/bundle.key.enc"
{
  echo
  echo "Generated values are in the encrypted artifact only (bundle.key.enc + bundle.json.enc). See docs/release/STAGING-INIT.md for how to decrypt (the same procedure)."
  echo "Production secrets are for production only: do not reuse them anywhere else."
} >> "$SUMMARY"
cp "$SUMMARY" "$OUT/summary.md"
echo "done: $(sed -n 3p "$OUT/summary.md")"
