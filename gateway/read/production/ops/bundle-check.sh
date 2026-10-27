#!/usr/bin/env bash
# The bundle check: the Worker must build, for every environment, with no unexpected field.
#
# `wrangler deploy --dry-run` validates the configuration and builds the bundle without
# publishing anything and without a credential. It is the check that a typo in wrangler.toml
# is caught before a deployment rather than during one.
#
# A configuration warning is a failure here. Wrangler warns about a field it did not expect
# in a table - a `workers_dev` that ended up inside the migrations table, for instance - and
# the value is then not applied. A deployment that quietly ignores half of its configuration
# is worse than one that refuses to start.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCTION="$(cd "$HERE/.." && pwd)"
cd "$PRODUCTION"

OUTDIR=".wrangler-dryrun"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

fail=0

for environment in "" "staging" "production"; do
  if [ -z "$environment" ]; then
    label="test"
    args=""
  else
    label="$environment"
    args="--env $environment"
  fi
  printf '   %-12s ' "$label"
  # shellcheck disable=SC2086
  if ! npx wrangler deploy --dry-run $args --outdir "$OUTDIR" >"$LOG" 2>&1; then
    echo "FAILED"
    sed 's/^/      /' "$LOG"
    fail=1
    continue
  fi
  if grep -qiE "unexpected field|^ *error" "$LOG"; then
    echo "FAILED (the configuration has a field wrangler did not expect)"
    grep -iE "unexpected field|^ *error" "$LOG" | sed 's/^/      /'
    fail=1
    continue
  fi
  size="$(grep -i "Total Upload" "$LOG" | head -1 | sed 's/\x1b\[[0-9;]*m//g' | tr -s ' ')"
  echo "ok  ${size:-built}"
done

if [ "$fail" -ne 0 ]; then
  echo "the bundle check failed" >&2
  exit 1
fi
echo "   the Worker builds for every environment, and every configuration is understood."
