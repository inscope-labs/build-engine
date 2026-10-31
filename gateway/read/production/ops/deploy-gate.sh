#!/usr/bin/env bash
# The deploy gate for the read gateway.
#
# Nothing is published until this has passed. The gate runs, in order:
#
#   1. the configuration is valid and wrangler.toml matches ops/environments.json;
#   2. the code type-checks;
#   3. the unit tests pass (the shared signing vectors, reproduced byte for byte);
#   4. the bundle builds, for every environment;
#   5. the shared conformance suite passes against the Worker, over real HTTP;
#   6. the abuse controls hold;
#   7. the operational checks hold (cold start, provider failures, expiry, revocation, key
#      rotation) and the exit gate of Phase 4;
#   8. the isolation proof holds (the gateway does not write to the source repository and does
#      not keep a copy of what it served);
#   9. and only then, with --deploy, the environment is published and checked afterwards.
#
# Every step fails closed: the first failure stops the gate, and no deployment happens.
#
#   ops/deploy-gate.sh                     the gate, without publishing anything
#   ops/deploy-gate.sh --env staging       the gate, for one environment
#   ops/deploy-gate.sh --env staging --deploy   the gate, then publish
#
# Publishing is an operator action (RELEASE-PLAN.md G-12). The --deploy flag is that action:
# without it the gate decides nothing, and with it the operator has said so.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCTION="$(cd "$HERE/.." && pwd)"
cd "$PRODUCTION"

ENVIRONMENT=""
DEPLOY=0
SKIP_INSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --deploy)
      DEPLOY=1
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

step=0
say() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }
fail() { printf '\n\033[1;31mGATE FAILED: %s\033[0m\n' "$1" >&2; exit 1; }

step() {
  step=$((step + 1))
  say "[$step] $1"
}

# ---------------------------------------------------------------------------
step "the tools are here"
for tool in node npm python3; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed"
done
note "node $(node --version), npm $(npm --version), python $(python3 --version 2>&1)"

# ---------------------------------------------------------------------------
step "the configuration is valid and has not drifted"
python3 ops/render-environments.py --check || fail "the configuration is invalid or out of date"
if [ -n "$ENVIRONMENT" ]; then
  python3 ops/render-environments.py --assert-deployable "$ENVIRONMENT" \
    || fail "the $ENVIRONMENT environment is not ready to deploy"
fi

# ---------------------------------------------------------------------------
step "the dependencies are the ones in the lockfile"
if [ "$SKIP_INSTALL" -eq 0 ]; then
  if [ -d node_modules ]; then
    # The tree is already there. A dry run checks the thing that matters - that the
    # lockfile and package.json agree - without touching the installed tree, which a
    # runtime that is still shutting down may have a file open.
    npm ci --dry-run >/dev/null || fail "package.json and package-lock.json disagree"
    note "the lockfile and package.json agree (the installed tree was left alone)"
  else
    npm ci || fail "npm ci failed"
  fi
else
  note "skipped (--skip-install)"
fi

# ---------------------------------------------------------------------------
step "the code type-checks"
npm run typecheck || fail "the type check failed"

# ---------------------------------------------------------------------------
step "the unit tests pass"
npm test || fail "the unit tests failed"

# ---------------------------------------------------------------------------
step "the bundle builds, for every environment"
bash ops/bundle-check.sh || fail "the bundle check failed"

# ---------------------------------------------------------------------------
step "the shared conformance suite passes"
npm run test:conformance || fail "the conformance suite failed"

# ---------------------------------------------------------------------------
step "the abuse controls hold"
npm run test:abuse || fail "the abuse controls failed"

# ---------------------------------------------------------------------------
step "the operational checks hold"
npm run test:staging || fail "the operational checks failed"

# ---------------------------------------------------------------------------
step "the isolation proof holds"
npm run test:isolation || fail "the isolation proof failed"

# ---------------------------------------------------------------------------
if [ "$DEPLOY" -eq 0 ]; then
  say "THE GATE PASSED. Nothing was published."
  note "publish with: ops/deploy-gate.sh --env <environment> --deploy"
  exit 0
fi

[ -n "$ENVIRONMENT" ] || fail "--deploy needs an environment: --env staging or --env production"

# ---------------------------------------------------------------------------
step "the environment has its own secrets"
LISTED="$(npx wrangler secret list --env "$ENVIRONMENT" 2>/dev/null || true)"
for secret in SIGNING_KEYS OPERATOR_TOKEN GITHUB_TOKEN; do
  printf '%s' "$LISTED" | grep -q "$secret" || fail "the $ENVIRONMENT environment has no $secret secret"
  note "$secret is set"
done

# ---------------------------------------------------------------------------
step "publishing to $ENVIRONMENT"
npx wrangler deploy --env "$ENVIRONMENT" || fail "the deployment failed"

# ---------------------------------------------------------------------------
step "the published gateway is the one that was intended"
BASE_URL="${CTXGATE_BASE_URL:-}"
[ -n "$BASE_URL" ] || fail "--deploy needs CTXGATE_BASE_URL: the public URL of the gateway"
python3 ops/verify-deployment.py --env "$ENVIRONMENT" --base-url "$BASE_URL" \
  || fail "the published gateway does not match the configuration"

say "THE GATE PASSED AND $ENVIRONMENT IS PUBLISHED."
