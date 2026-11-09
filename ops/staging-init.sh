#!/usr/bin/env bash
# Initialise the staging Workers: create them if they do not exist yet, and set their three
# secrets (SIGNING_KEYS, OPERATOR_TOKEN, GITHUB_TOKEN).
#
#   ops/staging-init.sh --target read|write|both --reason "why" [--replace yes|no]
#
# SIGNING_KEYS and OPERATOR_TOKEN are generated here. GITHUB_TOKEN is the token the operator
# stored as a GitHub environment secret (READ_GH_TOKEN / WRITE_GH_TOKEN); it is copied, never
# created. Cloudflare cannot show a secret again once it is set, so the generated values are
# also written to an encrypted bundle that only the holder of the delivery private key can read.
# Nothing secret is ever printed.
#
# Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DELIVERY_PUBLIC_KEY (PEM, RSA),
#              READ_GH_TOKEN (read), WRITE_GH_TOKEN (write), OUT_DIR (default ./out).
# Staging only. This script never touches the production Workers.
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=""; REASON=""; REPLACE="no"; OUT="${OUT_DIR:-$ROOT/out}"

fail() { echo "staging-init: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --replace) REPLACE="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

case "$TARGET" in read|write|both) ;; *) fail "--target must be read, write or both" ;; esac
case "$REPLACE" in yes|no) ;; *) fail "--replace must be yes or no" ;; esac
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

# The staging key id comes from the repository's own configuration, never from here.
read_key_id() {
  python3 - "$ROOT/gateway/read/production/ops/environments.json" <<'PY'
import json,sys
ids=json.load(open(sys.argv[1]))["environments"]["staging"]["key_ids"]
assert len(ids)==1, "expected exactly one staging key id"
print(ids[0])
PY
}
write_key_id() {
  python3 - "$ROOT/gateway/write/wrangler.toml" <<'PY'
import sys,tomllib
d=tomllib.load(open(sys.argv[1],"rb"))
ids=[i.strip() for i in d["env"]["staging"]["vars"]["SIGNING_KEY_IDS"].split(",") if i.strip()]
assert len(ids)==1, "expected exactly one staging key id"
print(ids[0])
PY
}

echo '{}' > "$TMP/bundle.json"; chmod 600 "$TMP/bundle.json"
SUMMARY="$TMP/summary.md"
{ echo "## Staging init"; echo; echo "Reason: $REASON"; echo; } > "$SUMMARY"

init_one() {
  local label="$1" dir="$2" ghtoken="$3" keyid="$4" worker="$5"
  local signing operator signing_json listed err
  echo "== $label gateway ($worker)"
  cd "$ROOT/$dir"
  npm ci --no-audit --no-fund >/dev/null

  # No permissive fallback: a wrangler that cannot list the secrets is reported as such,
  # instead of being flattened into an empty list that the check below reads as "no secrets
  # yet".
  if ! listed="$(npx wrangler secret list --env staging 2>&1)"; then
    fail "$label: wrangler could not list the staging Worker's secrets: $(printf '%s' "$listed" | tail -n 1)"
  fi
  if printf '%s' "$listed" | grep -q SIGNING_KEYS \
     && printf '%s' "$listed" | grep -q OPERATOR_TOKEN \
     && printf '%s' "$listed" | grep -q GITHUB_TOKEN \
     && [ "$REPLACE" != yes ]; then
    fail "$label staging already has its secrets. Re-run with replace=yes to replace them (this invalidates every link and token minted for staging)."
  fi

  signing="$(rand 32)"; operator="$(rand 24)"
  signing_json="$(KEYID="$keyid" SIG="$signing" python3 -c 'import json,os;print(json.dumps({os.environ["KEYID"]:os.environ["SIG"]}))')"

  put() { printf '%s' "$2" | npx wrangler secret put "$1" --env staging >/dev/null; }
  err="$TMP/err.txt"
  if ! put GITHUB_TOKEN "$ghtoken" 2>"$err"; then
    cat "$err" >&2
    echo "the Worker probably does not exist yet: creating it with one staging deploy"
    npx wrangler deploy --env staging 2>&1 | tee "$TMP/deploy-$label.txt" >&2
    put GITHUB_TOKEN "$ghtoken"
  fi
  put SIGNING_KEYS "$signing_json"
  put OPERATOR_TOKEN "$operator"

  if ! listed="$(npx wrangler secret list --env staging 2>&1)"; then
    fail "$label: wrangler could not list the staging Worker's secrets after the run: $(printf '%s' "$listed" | tail -n 1)"
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
  local url=""
  # awk, not grep: grep answers 1 when it matches nothing, and under "set -e" that would end
  # the script before the summary below could be written. awk prints the first match and
  # answers 0 whether or not it found one.
  [ -f "$TMP/deploy-$label.txt" ] && url="$(awk 'match($0, /https:\/\/[^ ]*workers\.dev/) { print substr($0, RSTART, RLENGTH); exit }' "$TMP/deploy-$label.txt")"
  {
    echo "- **$label**: Worker \`$worker\`, key id \`$keyid\`, secrets set: SIGNING_KEYS, OPERATOR_TOKEN, GITHUB_TOKEN"
    [ -n "$url" ] && echo "  - URL printed by the deploy: \`$url\`"
  } >> "$SUMMARY"
  cd "$ROOT"
}

if [ "$TARGET" = read ] || [ "$TARGET" = both ]; then
  init_one read gateway/read/production "$READ_GH_TOKEN" "$(read_key_id)" ctxgate-read-staging
fi
if [ "$TARGET" = write ] || [ "$TARGET" = both ]; then
  init_one write gateway/write "$WRITE_GH_TOKEN" "$(write_key_id)" ctxgate-write-staging
fi

# Hybrid encryption: a random AES key encrypts the bundle; the delivery public key encrypts that key.
mkdir -p "$OUT"
openssl rand -out "$TMP/bundle.key" 32
openssl enc -aes-256-cbc -pbkdf2 -pass "file:$TMP/bundle.key" -in "$TMP/bundle.json" -out "$OUT/bundle.json.enc"
openssl pkeyutl -encrypt -pubin -inkey "$TMP/delivery.pub.pem" -pkeyopt rsa_padding_mode:oaep \
  -in "$TMP/bundle.key" -out "$OUT/bundle.key.enc"
{
  echo
  echo "Generated values are in the encrypted artifact only (bundle.key.enc + bundle.json.enc). See docs/release/STAGING-INIT.md to decrypt."
  echo "Set CTXGATE_BASE_URL to the read Worker URL: https://ctxgate-read-staging.<your-subdomain>.workers.dev"
} >> "$SUMMARY"
cp "$SUMMARY" "$OUT/summary.md"
echo "done: $(cat "$OUT/summary.md" | head -3 | tail -1)"
