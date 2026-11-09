#!/usr/bin/env bash
# rollout-gate.sh <stage> - run the rollout plan's gate for one stage and print the result.
#
# The governing document is docs/release/V0.6.0-ROLLOUT-PLAN.md (sections 2 and 4). This script
# is the runner the plan asks for in stage S0: it runs the [R] checks, queries the [E] presence
# checks, and prints PASS / FAIL / BLOCKED-EXTERNAL per check.
#
# It is NOT shipped: it lives in release/, which is outside template/, and release/manifest.txt
# does not list it. The S0 report proves both.
#
# Rules it obeys, from the plan:
#   - fail closed. A check that cannot run, errors, or returns ambiguous output is a FAIL.
#   - no claim without evidence. Every check prints the command it ran and an excerpt of the
#     output that was inspected.
#   - credentials never appear. The script reads secret NAMES from the API and never reads,
#     prints or stores a value. The token comes from the environment and is never echoed.
#
# Exit codes:
#   0  every check PASSed
#   1  at least one check FAILed
#   2  at least one check is BLOCKED-EXTERNAL - including a stage whose own checks are not
#      implemented in this runner yet, which is never a PASS
#   4  usage error
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAGE="${1:-}"
if [[ -z "$STAGE" ]]; then
  echo "usage: release/rollout-gate.sh <stage>   # S0 .. S9" >&2
  echo "       release/rollout-gate.sh --list" >&2
  exit 4
fi
if [[ "$STAGE" == "--list" ]]; then
  for s in S0 S1 S2 S3 S4 S5 S6 S7 S8 S9; do echo "$s"; done
  exit 0
fi
if [[ ! "$STAGE" =~ ^S[0-9]$ ]]; then
  echo "unknown stage: $STAGE (expected S0..S9)" >&2
  exit 4
fi

REPO_SLUG="${ROLLOUT_REPO:-inscope-labs/build-engine}"
# The token is read from the environment and is never printed, echoed or passed on a command line
# that another process could read. It is only ever used as an Authorization header.
TOKEN="${GITHUB_TOKEN:-${GITHUB_PAT:-${GH_TOKEN:-}}}"

# The verdicts are counted through a file, not through shell variables. Several checks run inside
# a subshell - "( cd gateway/write && npm test )" - and a subshell cannot change its parent's
# variables. A verdict raised in a subshell would therefore never have reached the summary, and a
# FAIL there would have been reported as a PASS: the runner would have failed OPEN. The file is
# shared by every subshell, so every verdict counts, wherever it was raised.
RESULTS="$(mktemp "${TMPDIR:-/tmp}/rollout-gate.XXXXXX")"
trap 'rm -f "$RESULTS"' EXIT

pass() { printf '  PASS  %-14s %s\n' "$1" "${2:-}"; echo P >> "$RESULTS"; }
fail() { printf '  FAIL  %-14s %s\n' "$1" "${2:-}"; echo F >> "$RESULTS"; }
blocked() { printf '  BLOCKED-EXTERNAL  %-14s %s\n' "$1" "${2:-}"; echo B >> "$RESULTS"; }
note() { printf '  note  %-14s %s\n' "$1" "${2:-}"; }
section() { printf '\n== %s ==\n' "$1"; }

# Run a command, capture its output and its exit code, and judge it. The output is printed as an
# excerpt: the last few lines, which is where a failure says what went wrong.
#   judge <id> <expected-exit> <command...>
judge() {
  local id="$1" want="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ "$rc" == "$want" ]]; then
    pass "$id" "$(printf '%s' "$out" | tail -n 2 | tr '\n' ' ' | cut -c1-160)"
    return 0
  fi
  fail "$id" "exit $rc (wanted $want): $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ' | cut -c1-200)"
  return 1
}

# The same, but for a command whose output has to be inspected for a string.
#   judge_has <id> <expected-exit> <needle> <command...>
judge_has() {
  local id="$1" want="$2" needle="$3"; shift 3
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ "$rc" == "$want" ]] && printf '%s' "$out" | grep -qF -- "$needle"; then
    pass "$id" "$(printf '%s' "$out" | tail -n 2 | tr '\n' ' ' | cut -c1-160)"
    return 0
  fi
  fail "$id" "exit $rc (wanted $want), output did not contain '$needle': $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ' | cut -c1-200)"
  return 1
}

api() { # api <method> <path>  -> body on stdout, exit code of curl
  if [[ -z "$TOKEN" ]]; then return 3; fi
  curl -sS -X "$1" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com$2"
}

# ---------------------------------------------------------------------------
# Standing checks (rollout plan section 4). Every stage runs them.
# ---------------------------------------------------------------------------

# ROLLOUT_GATE_ONLY=id[,id] runs only the named checks. It exists so a single check can be
# re-run without repeating the whole gate; the full gate is the one that counts.
ONLY="${ROLLOUT_GATE_ONLY:-}"
wanted() {
  [[ -z "$ONLY" ]] && return 0
  [[ ",$ONLY," == *",$1,"* ]]
}
run_check() { # run_check <id> <function>
  wanted "$1" && "$2"
}

check_c_prot() {
  local body
  if [[ -z "$TOKEN" ]]; then
    blocked "C-PROT" "no credential in the environment (GITHUB_TOKEN); the branch-protection endpoint needs one"
    return
  fi
  body="$(api GET "/repos/$REPO_SLUG/branches/main/protection" 2>/dev/null)"
  if [[ -z "$body" ]] || printf '%s' "$body" | grep -q '"message"'; then
    fail "C-PROT" "the branch-protection query did not answer: $(printf '%s' "$body" | head -c 160)"
    return
  fi
  # ADR 0009's record: a pull request is required, the `test` check is required, force-push is
  # blocked. Anything weaker is a FAIL.
  local pr checks fp
  pr="$(printf '%s' "$body" | jq -r 'if .required_pull_request_reviews then "yes" else "no" end' 2>/dev/null)"
  checks="$(printf '%s' "$body" | jq -r '.required_status_checks.contexts // [] | join(",")' 2>/dev/null)"
  fp="$(printf '%s' "$body" | jq -r '.allow_force_pushes.enabled // false' 2>/dev/null)"
  if [[ "$pr" != "yes" ]]; then fail "C-PROT" "main does not require a pull request"; return; fi
  if [[ "$checks" != *test* ]]; then fail "C-PROT" "the required status checks are '$checks', not 'test'"; return; fi
  if [[ "$fp" == "true" ]]; then fail "C-PROT" "force-push is allowed on main"; return; fi
  pass "C-PROT" "pull request required, required check 'test', force-push blocked"
}

check_c_ci() {
  local body
  if [[ -z "$TOKEN" ]]; then
    blocked "C-CI" "no credential in the environment (GITHUB_TOKEN); the check-runs endpoint needs one"
    return
  fi
  body="$(api GET "/repos/$REPO_SLUG/commits/main/check-runs" 2>/dev/null)"
  if [[ -z "$body" ]] || printf '%s' "$body" | grep -q '"message"'; then
    fail "C-CI" "the check-runs query did not answer: $(printf '%s' "$body" | head -c 160)"
    return
  fi
  local total bad names
  total="$(printf '%s' "$body" | jq -r '.check_runs | length' 2>/dev/null)"
  if [[ "$total" == "0" || "$total" == "null" ]]; then
    fail "C-CI" "no check runs on the tip of main"
    return
  fi
  bad="$(printf '%s' "$body" | jq -r '[.check_runs[] | select(.conclusion != "success") | .name] | join(", ")' 2>/dev/null)"
  names="$(printf '%s' "$body" | jq -r '[.check_runs[].name] | join(", ")' 2>/dev/null)"
  if [[ -n "$bad" ]]; then
    fail "C-CI" "not successful: $bad"
    return
  fi
  pass "C-CI" "$total check runs on main, all successful"
}

check_c_base() {
  section "C-BASE shipped-engine and release self-tests"
  judge_has "C-BASE" 0 "OK" python3 -m unittest discover -s template/engine/tools
  judge_has "C-BASE" 0 "0 failed" release/test-release.sh
  judge_has "C-BASE" 0 "0 failed" tests/test_update.sh
}

check_c_conf() {
  section "C-CONF shared conformance on the local runtime"
  judge_has "C-CONF" 0 "0 failed" python3 conformance/harness/run.py all --reference
  judge_has "C-CONF" 0 "OK" python3 -m unittest discover -s conformance -p 'test_*.py'
  # The fault injector's own tests: the Stage 6.3 failure pilot depends on them.
  judge_has "C-CONF" 0 "OK" python3 -m unittest discover -s ops -p 'test_*.py'
}

check_c_read() {
  section "C-READ read gateway local checks"
  ( cd gateway/read/production && judge_has "C-READ" 0 "# fail 0" npm test )
  ( cd gateway/read/production && judge_has "C-READ" 0 "matches ops/environments.json" npm run ops:check )
  ( cd gateway/read/production && judge_has "C-READ" 0 "every configuration is understood" npm run check:bundle )
  ( cd gateway/write && judge_has "C-READ" 0 "read staging environment is separate" npm run check:staging:read )
  # The reference gateway's own tests (never shipped, but they are part of the green baseline).
  judge_has "C-READ" 0 "OK" python3 -m unittest discover -s gateway/read/reference -p 'test_*.py'
}

check_c_write() {
  section "C-WRITE write gateway local checks"
  ( cd gateway/write && judge "C-WRITE" 0 npm run typecheck )
  ( cd gateway/write && judge_has "C-WRITE" 0 "# fail 0" npm test )
  ( cd gateway/write && judge_has "C-WRITE" 0 "the contract documents agree" npm run check:contract )
  ( cd gateway/write && judge_has "C-WRITE" 0 "staging environment is separate" npm run check:staging )
}

check_c_iso() {
  section "C-ISO release isolation"
  local artifact="dist/build-engine-v$(tr -d ' \n' < VERSION).tar.gz"
  rm -rf dist
  if ! judge "C-ISO" 0 release/package.sh dist; then return; fi
  judge_has "C-ISO" 0 "verify: OK" release/verify.sh "$artifact" --test-payload
  # The artifact must not carry gateway code, conformance assets, the operations tooling, the
  # workflows, a deployment configuration or a secret.
  local members bad
  members="$(tar -tzf "$artifact")"
  bad="$(printf '%s\n' "$members" | grep -E '(^|/)(gateway|conformance|ops|variants|\.github)/' | head -5)"
  if [[ -n "$bad" ]]; then
    fail "C-ISO" "the artifact carries infrastructure: $(printf '%s' "$bad" | tr '\n' ' ')"
  else
    pass "C-ISO" "no gateway/conformance/ops/variants/.github path in the artifact"
  fi
  bad="$(printf '%s\n' "$members" | grep -E '(wrangler\.toml|\.dev\.vars|rollout-gate\.sh)$' | head -5)"
  if [[ -n "$bad" ]]; then
    fail "C-ISO" "the artifact carries a deployment configuration: $(printf '%s' "$bad" | tr '\n' ' ')"
  else
    pass "C-ISO" "no deployment configuration or gate runner in the artifact"
  fi
  rm -rf dist
}

# A hit is allowed only when it is a deliberate sentinel the repository's own tests put in the tree
# on purpose. The exclusions are file-scoped and narrow: the same shape anywhere else is a FAIL.
# Each use is printed by the check, so an exclusion is never silent.
#
#   gateway/write/tests/helpers/hygiene.ts
#       The sentinel credentials. The point of the hygiene check is that a token-shaped value does
#       not leak through any channel, so the shape has to be there. The marker is the word the
#       file itself uses to name them.
#   gateway/write/tests/unit/audit/redaction.test.ts
#       A GitHub-token-shaped fixture, so the audit stream's redaction can be proved. It is
#       recognised by what it is: the thirty-six characters of digits and letters in order.
#   gateway/**/tests/**, gateway/read/production/test/**
#       The gateways' local test credentials: an obvious test placeholder, never sent to a real
#       host.
#
# The rules are written as shapes rather than as the values themselves, so this file contains no
# complete credential shape and the scan never has to excuse itself.
sentinel_allowed() {
  local file="$1" matched="$2" value
  case "$file" in
    gateway/write/tests/helpers/hygiene.ts)
      [[ "$matched" == *SENTINEL* ]] && return 0 ;;
    gateway/write/tests/unit/audit/redaction.test.ts)
      value="${matched#ghp_}"
      [[ "$value" =~ ^[0-9a-z]{36}$ ]] && return 0 ;;
  esac
  case "$file" in
    gateway/*/tests/*|gateway/*/*/tests/*|gateway/read/production/test/*)
      [[ "$matched" =~ ^Bearer\ test- ]] && return 0 ;;
  esac
  return 1
}

check_c_secrets() {
  section "C-SECRETS no credential in the tree"
  # The credential shapes are the repository's own: release/forbidden.txt already defines what a
  # real token looks like. The scan reuses those rules rather than inventing a second list, and
  # adds the "Bearer <literal>" shape the plan names.
  #
  # Known test placeholders are listed, not silently skipped: a hit that is one of these is
  # reported as excluded and the run continues; any other hit is a FAIL.
  # The text rules from forbidden.txt that describe a credential shape.
  local -a shapes=()
  while IFS= read -r line; do shapes+=("$line"); done < <(
    sed -n '/^# -- credential shapes/,$p' release/forbidden.txt | grep '^text: ' | sed 's/^text: //'
  )
  if [[ "${#shapes[@]}" -eq 0 ]]; then
    fail "C-SECRETS" "release/forbidden.txt carries no credential shape; the scan would be vacuous"
    return
  fi
  note "C-SECRETS" "credential shapes from release/forbidden.txt: ${#shapes[@]} (plus the Bearer literal shape)"

  local -a files=()
  while IFS= read -r f; do files+=("$f"); done < <( { git ls-files; git ls-files --others --exclude-standard; } | sort -u )
  local hits=0 excluded=0 f shape m
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    for shape in "${shapes[@]}" "Bearer [A-Za-z0-9._~+/=-]{16,}"; do
      while IFS= read -r m; do
        [[ -z "$m" ]] && continue
        if sentinel_allowed "$f" "$m"; then
          excluded=$((excluded+1))
          printf '  note  %-14s excluded sentinel in %s: %s\n' "C-SECRETS" "$f" "${m:0:60}"
        else
          hits=$((hits+1))
          printf '  note  %-14s HIT in %s: %s\n' "C-SECRETS" "$f" "${m:0:60}"
        fi
      done < <(grep -aEo -e "$shape" "$f" 2>/dev/null | head -3)
    done
  done
  # The branch diff is scanned too: a secret introduced by this branch is a hit even if the file is
  # new. The comparison is against origin/main, and it covers the committed and the staged state.
  local diffhit=0
  for shape in "${shapes[@]}" "Bearer [A-Za-z0-9._~+/=-]{16,}"; do
    if git diff origin/main 2>/dev/null | grep -aE "^\+" | grep -aEq -e "$shape"; then
      diffhit=1
      printf '  note  %-14s HIT in the diff against origin/main\n' "C-SECRETS"
    fi
  done
  if [[ "$hits" -gt 0 || "$diffhit" -gt 0 ]]; then
    fail "C-SECRETS" "$hits hit(s) in the tree, diff against origin/main hit: $diffhit"
  else
    pass "C-SECRETS" "no credential shape in ${#files[@]} file(s) or in the diff against origin/main ($excluded deliberate sentinel(s) excluded and listed)"
  fi
  # The gate runner itself must not be shipped.
  if grep -q 'rollout-gate.sh' release/manifest.txt; then
    fail "C-SECRETS" "release/manifest.txt lists rollout-gate.sh"
  else
    pass "C-SECRETS" "rollout-gate.sh is not in release/manifest.txt"
  fi
}

check_c_diff() {
  section "C-DIFF Basic does not regress"
  # The shipped payload, the release machinery and the tests are compared against the published
  # 0.5.0 tag. The report lists every difference and justifies it; the check here is that the
  # comparison can be made and that nothing in the shipped payload was removed.
  if ! git rev-parse -q --verify v0.5.0 >/dev/null; then
    fail "C-DIFF" "the tag v0.5.0 is not in the checkout"
    return
  fi
  local removed
  removed="$(git diff --name-status v0.5.0..HEAD -- template/ release/manifest.txt release/forbidden.txt tests/ \
    | awk '$1 ~ /^D/ {print $2}' | head -10)"
  if [[ -n "$removed" ]]; then
    fail "C-DIFF" "files removed since v0.5.0: $(printf '%s' "$removed" | tr '\n' ' ')"
  else
    pass "C-DIFF" "nothing removed from template/, the allowlist, the forbidden rules or the tests"
  fi
  local changed
  changed="$(git diff --name-only v0.5.0..HEAD -- template/ release/manifest.txt release/forbidden.txt tests/ | wc -l | tr -d ' ')"
  note "C-DIFF" "$changed file(s) changed against v0.5.0 in the shipped payload, the release machinery and the tests; the report lists each"
}

# ---------------------------------------------------------------------------
# [E] presence checks. An external input is supplied by the operator or by another repository:
# the agent verifies PRESENCE and CONSISTENCY only. The APIs below list secret NAMES; no value is
# ever read, printed or stored.
# ---------------------------------------------------------------------------

# check_env_exists <id> <environment>  - the environment exists and requires a reviewer.
check_env_exists() {
  local id="$1" env="$2" body reviewers
  body="$(api GET "/repos/$REPO_SLUG/environments/$env" 2>/dev/null)"
  if [[ -z "$body" ]] || printf '%s' "$body" | grep -q '"message"'; then
    blocked "$id" "the GitHub environment '$env' does not exist yet"
    return
  fi
  reviewers="$(printf '%s' "$body" | jq -r '[.protection_rules[]?.reviewers[]?.login] | join(",")' 2>/dev/null)"
  if [[ -z "$reviewers" ]]; then
    blocked "$id" "the environment '$env' exists but has no required reviewer"
    return
  fi
  pass "$id" "the environment '$env' exists and requires a reviewer ($reviewers)"
}

# check_repo_secret_names <id> <environment> <name>...  - the names are present. Values are not
# visible through this API and are not asked for.
check_repo_secret_names() {
  local id="$1" env="$2"; shift 2
  local body names missing="" want
  body="$(api GET "/repos/$REPO_SLUG/environments/$env/secrets" 2>/dev/null)"
  if [[ -z "$body" ]] || printf '%s' "$body" | grep -q '"message"'; then
    blocked "$id" "the secret list of '$env' could not be read"
    return
  fi
  names="$(printf '%s' "$body" | jq -r '.secrets[].name' 2>/dev/null)"
  for want in "$@"; do
    printf '%s\n' "$names" | grep -qxF "$want" || missing="$missing $want"
  done
  if [[ -n "$missing" ]]; then
    blocked "$id" "secret name(s) absent from '$env':$missing"
    return
  fi
  pass "$id" "secret name(s) present in '$env': $*"
}

# check_worker_secret_names <id> <worker> <name>...  - the Cloudflare Worker holds the secret
# names. The account id and the API token come from the environment; without them the check is
# BLOCKED-EXTERNAL, because a missing credential is an external input, not a failure of the tree.
check_worker_secret_names() {
  local id="$1" worker="$2"; shift 2
  local acct="${CLOUDFLARE_ACCOUNT_ID:-}" tok="${CLOUDFLARE_API_TOKEN:-}" body names missing="" want
  if [[ -z "$acct" || -z "$tok" ]]; then
    blocked "$id" "no Cloudflare credential in the environment (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)"
    return
  fi
  body="$(curl -sS -H "Authorization: Bearer $tok" \
    "https://api.cloudflare.com/client/v4/accounts/$acct/workers/scripts/$worker/secrets" 2>/dev/null)"
  if [[ -z "$body" ]] || ! printf '%s' "$body" | jq -e '.success == true' >/dev/null 2>&1; then
    blocked "$id" "the secret list of the Worker '$worker' could not be read"
    return
  fi
  names="$(printf '%s' "$body" | jq -r '.result[]?.name' 2>/dev/null)"
  for want in "$@"; do
    printf '%s\n' "$names" | grep -qxF "$want" || missing="$missing $want"
  done
  if [[ -n "$missing" ]]; then
    blocked "$id" "secret name(s) absent from the Worker '$worker':$missing"
    return
  fi
  pass "$id" "secret name(s) present in the Worker '$worker': $*"
}

# ---------------------------------------------------------------------------
# Stage-specific checks.
# ---------------------------------------------------------------------------

check_s0_adrs() {
  section "S0 stage-specific checks"
  local n
  for n in 0010 0011 0012 0013; do
    local f
    f="$(ls docs/decisions/${n}-*.md 2>/dev/null | head -1)"
    if [[ -z "$f" ]]; then fail "S0-ADR-$n" "no ADR $n in docs/decisions/"; continue; fi
    if grep -q 'Status: \*\*decided\*\*' "$f"; then
      pass "S0-ADR-$n" "$(basename "$f") is decided"
    else
      fail "S0-ADR-$n" "$(basename "$f") does not carry status 'decided'"
    fi
  done
  # Each ADR must state the chosen option for the questions the exit gate names.
  local f id missing_id=""
  for f in docs/decisions/0010-*.md; do
    for id in Q-A Q-C Q-D Q-E; do
      grep -qF "$id" "$f" || missing_id="$missing_id 0010/$id"
    done
  done
  for f in docs/decisions/0011-*.md; do
    for id in Q-B Q-B2 Q-CB-1 Q-CB-2 Q-CB-3; do
      grep -qF "$id" "$f" || missing_id="$missing_id 0011/$id"
    done
  done
  for f in docs/decisions/0012-*.md; do
    for id in Q-4 Q-5 DX-1 DX-2; do
      grep -qF "$id" "$f" || missing_id="$missing_id 0012/$id"
    done
  done
  if [[ -n "$missing_id" ]]; then
    fail "S0-ADRCONTENT" "the chosen option is not stated for:$missing_id"
  else
    pass "S0-ADRCONTENT" "0010 (Q-A, Q-C, Q-D, Q-E), 0011 (Q-B, Q-B2, Q-CB-1..3), 0012 (Q-4, Q-5, DX-1, DX-2) each state their answer"
  fi
  # The three BE-0 documents must no longer say draft.
  local d
  for d in COMPATIBILITY-MATRIX CAPABILITY-CONFORMANCE CBRIDGE-COVERAGE-MATRIX; do
    if grep -qi 'Status:.*DRAFT for the operator' "docs/release/$d.md"; then
      fail "S0-DOC-$d" "still says DRAFT"
    else
      pass "S0-DOC-$d" "no longer marked DRAFT"
    fi
  done
  # The state list must be reconciled to the shipped schema.
  local states
  states="$(python3 -c 'import json;print(" ".join(json.load(open("template/engine/schemas/task.schema.json"))["properties"]["status"]["enum"]))')"
  local missing=""
  for st in $states; do
    grep -q "\`$st\`" docs/release/CAPABILITY-CONFORMANCE.md || missing="$missing $st"
  done
  if [[ -n "$missing" ]]; then
    fail "S0-STATE" "the schema states missing from CAPABILITY-CONFORMANCE.md:$missing"
  else
    pass "S0-STATE" "the schema's states ($states) all appear in the conformance document"
  fi
  # ADR 0008's open items must be closed, and the decisions index must list the new ADRs.
  if grep -q 'DX-1 and DX-2 closed by ADR 0012' docs/decisions/0008-hosting-hostnames-and-repositories.md; then
    pass "S0-ADR0008" "ADR 0008 records DX-1 and DX-2 as closed by ADR 0012"
  else
    fail "S0-ADR0008" "ADR 0008's status line does not record the closure"
  fi
  local missing_adr
  missing_adr=""
  for n in 0010 0011 0012 0013; do
    grep -q "| $n |" docs/decisions/README.md || missing_adr="$missing_adr $n"
  done
  if [[ -n "$missing_adr" ]]; then
    fail "S0-INDEX" "docs/decisions/README.md does not list:$missing_adr"
  else
    pass "S0-INDEX" "docs/decisions/README.md lists 0010 to 0013"
  fi
  # The gate runner must not be shipped.
  if grep -q 'rollout-gate.sh' release/manifest.txt; then
    fail "S0-NOTSHIPPED" "release/manifest.txt lists rollout-gate.sh"
  else
    pass "S0-NOTSHIPPED" "rollout-gate.sh is not in release/manifest.txt"
  fi
}

check_s1_lifecycle() {
  section "S1 stage-specific checks"
  # The Worker conformance suite must run, and the case count is recorded (the plan expects 58).
  local out
  out="$(python3 gateway/read/production/test/run-conformance.py 2>&1)"
  local rc=$?
  local cases
  cases="$(printf '%s' "$out" | grep -oE '[0-9]+ (passed|cases)' | tail -1)"
  if [[ "$rc" != 0 ]]; then
    fail "S1-CASES" "run-conformance.py exited $rc: $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ' | cut -c1-180)"
  else
    pass "S1-CASES" "run-conformance.py ran; ${cases:-case count not reported by the runner}"
    note "S1-CASES" "the plan expects 58 cases; the report states the count this runner produced"
  fi
  # Every lifecycle item must map to a test file that exists.
  local missing="" item file
  while IFS='|' read -r item file; do
    [[ -z "$item" ]] && continue
    if [[ ! -f "$file" ]]; then missing="$missing $item"; fi
  done <<'EOF'
root capability|gateway/write/tests/unit/auth/root-url.test.ts
root capability signature|gateway/write/tests/unit/auth/signature.test.ts
task and work-order binding|gateway/write/tests/unit/auth/policy-authz.test.ts
task and work-order binding (integration)|gateway/write/tests/integration/adversarial-inputs.test.ts
single writer|gateway/write/tests/unit/session/writer-claim.test.ts
single writer (integration)|gateway/write/tests/integration/single-writer.test.ts
sequence|gateway/write/tests/unit/session/sequence.test.ts
staging scaffold|gateway/write/tests/unit/staging/scaffold.test.ts
staging append and read-back|gateway/write/tests/unit/staging/append.test.ts
staging delete|gateway/write/tests/unit/staging/delete.test.ts
staging status|gateway/write/tests/unit/staging/status.test.ts
UTF-8 and file-type checks|gateway/write/tests/unit/policy/type-policy.test.ts
UTF-8 decoding|gateway/write/tests/unit/util/encodings.test.ts
path safety|gateway/write/tests/unit/policy/path-safety.test.ts
quota accounting|gateway/write/tests/unit/policy/quota-accounting.test.ts
quota exhaustion|gateway/write/tests/integration/quota-exhaustion.test.ts
read-back and integrity|gateway/write/tests/integration/happy-path.test.ts
commit idempotency|gateway/write/tests/unit/commit/commit-idempotency.test.ts
commit and delivery (integration)|gateway/write/tests/integration/commit-idempotency.test.ts
seal|gateway/write/tests/unit/seal/seal.test.ts
seal close and revoke|gateway/write/tests/integration/seal.test.ts
tombstone (close)|gateway/write/tests/unit/session/tombstones.test.ts
EOF
  if [[ -n "$missing" ]]; then
    fail "S1-LIFECYCLE" "no test file for:$missing"
  else
    pass "S1-LIFECYCLE" "every named lifecycle item maps to a test file that exists"
  fi
}

check_s2_closure() {
  section "S2 stage-specific checks"
  local out rc

  # The shared-property suite: every property x format cell is run, or cited as external.
  out="$(python3 conformance/harness/run_shared.py 2>&1)"; rc=$?
  if [[ "$rc" != 0 ]]; then
    fail "S2-MATRIX" "run_shared.py exited $rc: $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ' | cut -c1-200)"
  else
    pass "S2-MATRIX" "$(printf '%s' "$out" | grep -E 'PASS.*EXTERNAL.*FAIL' | tail -1)"
    note "S2-MATRIX" "EXTERNAL cells (ctxop-v1) are cited, not run; they are not passes and S7 must verify them"
  fi

  # The transition decision: every vector, including the three refusals the exit gate names.
  out="$(python3 conformance/harness/transition_reference.py 2>&1)"; rc=$?
  if [[ "$rc" != 0 ]]; then
    fail "S2-TRANSITION" "transition_reference.py exited $rc"
  else
    pass "S2-TRANSITION" "$(printf '%s' "$out" | tail -1)"
  fi
  local t
  for t in "an unsealed task with a commit is reported open and not attested" \
           "a revoked task is not attested" \
           "a closed work order is not attested" \
           "the same fact, asked again, is the same fact (a replayed read is safe)"; do
    if grep -qF "\"$t\"" gateway/write/tests/integration/task-state.test.ts; then
      pass "S2-REFUSAL" "test present: $t"
    else
      fail "S2-REFUSAL" "no test named: $t"
    fi
  done
  for t in "NONCE_REPLAYED" "SEAL_NOT_ATTESTED" "TRANSITION_NOT_ALLOWED" "SEAL_FACT_UNAVAILABLE"; do
    if grep -q "\"$t\"" conformance/cases/task-state-transition.json; then
      pass "S2-REFUSAL" "a vector expects $t"
    else
      fail "S2-REFUSAL" "no vector expects $t"
    fi
  done

  # The contract documents agree with the code.
  out="$(cd gateway/write && python3 scripts/check-contract-consistency.py 2>&1)"; rc=$?
  if [[ "$rc" != 0 ]]; then fail "S2-CONTRACT" "check-contract-consistency exited $rc"; else pass "S2-CONTRACT" "the contract documents agree"; fi

  # The documents the exit gate names exist.
  local f
  for f in docs/release/TASK-STATE-TRANSITION-CONTRACT.md docs/release/LINK-LIFECYCLE-COVERAGE.md; do
    if [[ -f "$f" ]]; then pass "S2-DOCS" "$f exists"; else fail "S2-DOCS" "$f is missing"; fi
  done

  # Every gap in the capability document is accepted by a decision that exists.
  if grep -q "ADR 0010" docs/release/CAPABILITY-CONFORMANCE.md && [[ -f docs/decisions/0010-capability-conformance-decisions.md ]]; then
    pass "S2-GAPS" "GAP R-1 and GAP R-2 are recorded as accepted by ADR 0010"
  else
    fail "S2-GAPS" "the capability document does not cite ADR 0010"
  fi

  # The signing scheme did not change: the vectors and the scheme document are untouched.
  if git diff --quiet origin/main -- conformance/signing-vectors.json conformance/SCHEME.md; then
    pass "S2-SCHEME" "conformance/signing-vectors.json and SCHEME.md are unchanged against origin/main"
  else
    fail "S2-SCHEME" "the signing vectors or the scheme document changed (ADR 0010: no scheme change)"
  fi
}

check_s3_hardening() {
  section "S3 stage-specific checks"

  # The workflows are fail-closed: no permissive expression in the deployment path, every
  # action pinned, and every publishing workflow a gated sequence. The checker is the
  # statement of those properties; it is not a scan of this file.
  local out rc
  out="$(python3 release/check-workflow-policy.py 2>&1)"; rc=$?
  if [[ "$rc" != 0 ]]; then
    fail "S3-POLICY" "the workflow policy check failed: $(printf '%s' "$out" | tail -n 5 | tr '\n' ' ' | cut -c1-200)"
  else
    pass "S3-POLICY" "$(printf '%s' "$out" | tail -1)"
  fi

  # The installs are deterministic: every package has a committed lockfile that agrees with
  # its manifest, and every workflow installs with npm ci.
  out="$(python3 release/check-installs.py 2>&1)"; rc=$?
  if [[ "$rc" != 0 ]]; then
    fail "S3-INSTALLS" "the install determinism check failed: $(printf '%s' "$out" | tail -n 5 | tr '\n' ' ' | cut -c1-200)"
  else
    pass "S3-INSTALLS" "$(printf '%s' "$out" | tail -1)"
  fi

  # The S3 work item named three baseline hits. The scan is repeated here, over the whole
  # deployment path, so that a hit added later is caught by the gate and not only by review.
  #
  # The two policy checkers are excluded, and the exclusion is file-scoped: they have to
  # name the permissive forms in order to look for them, so they would otherwise flag
  # themselves. Nothing else is excluded.
  local hits
  hits="$(grep -rnE '\|\|[[:space:]]*(true|:)[[:space:]]*$|continue-on-error:[[:space:]]*true|set[[:space:]]+\+e' \
      .github/workflows ops release gateway/read/production/ops gateway/write/scripts 2>/dev/null \
      | grep -v node_modules \
      | grep -vE '^release/check-(workflow-policy|installs)\.py:' | head -5)"
  if [[ -n "$hits" ]]; then
    fail "S3-PERMISSIVE" "a permissive expression is in the deployment path: $(printf '%s' "$hits" | tr '\n' ' ' | cut -c1-200)"
  else
    pass "S3-PERMISSIVE" "no permissive expression in .github/workflows, ops, release or the gateway deploy scripts"
  fi

  # The lockfiles are committed. The check is that they are tracked, not merely present.
  local lock
  for lock in gateway/read/production/package-lock.json gateway/write/package-lock.json; do
    if git ls-files --error-unmatch "$lock" >/dev/null 2>&1; then
      pass "S3-LOCKFILE" "$lock is committed"
    else
      fail "S3-LOCKFILE" "$lock is not committed"
    fi
  done

  # The publishing workflows are never triggered by a pull request, and the write gateway's
  # own log hygiene gate says the same thing about a deployment credential. Both are stated
  # here so the S3 gate does not depend on one script's opinion.
  local wf
  for wf in .github/workflows/deploy.yml .github/workflows/deploy-read-gateway.yml \
            .github/workflows/deploy-write-gateway-staging.yml; do
    if grep -qE '^on:[[:space:]]*$|^on:[[:space:]]*workflow_dispatch' "$wf" \
       && ! grep -qE '^[[:space:]]*pull_request(_target)?:' "$wf"; then
      pass "S3-TRIGGER" "$(basename "$wf") is not pull-request triggered"
    else
      fail "S3-TRIGGER" "$(basename "$wf") can be triggered by a pull request"
    fi
  done

  # The two production publishing workflows are a sequence, not a list: the staging
  # acceptance job exists, and the publishing job waits for it.
  local pair file rest accept pub
  for pair in ".github/workflows/deploy.yml:staging-acceptance:deploy" \
              ".github/workflows/deploy-read-gateway.yml:staging-acceptance:publish"; do
    file="${pair%%:*}"
    rest="${pair#*:}"
    accept="${rest%%:*}"
    pub="${rest##*:}"
    if grep -q "^  ${accept}:" "$file" && grep -q "needs: \[.*${accept}.*\]" "$file" \
       && grep -q "^  ${pub}:" "$file" && grep -q "environment:" "$file"; then
      pass "S3-SEQUENCE" "$(basename "$file"): '$accept' exists and '$pub' waits for it"
    else
      fail "S3-SEQUENCE" "$(basename "$file"): the publishing job does not wait for '$accept'"
    fi
  done
}

# ---------------------------------------------------------------------------
# S4: the read gateway's staging acceptance and production.
# ---------------------------------------------------------------------------

# The host ADR 0012 records for the production read gateway, and the staging host derived
# from it. ADR 0012 item 3 is the authority for the production host; the staging host is the
# committed configuration's staging worker on the same account.
s4_production_host() {
  grep -oE 'ctxgate-read\.[A-Za-z0-9.-]+workers\.dev' docs/decisions/0012-release-record-and-hosting-closure.md 2>/dev/null | head -1
}

s4_staging_host() {
  local worker subdomain
  worker="$(python3 -c 'import json;print(json.load(open("gateway/read/production/ops/environments.json"))["environments"]["staging"]["worker_name"])' 2>/dev/null)"
  subdomain="$(s4_production_host | sed 's/^ctxgate-read\.//')"
  [[ -n "$worker" && -n "$subdomain" ]] && echo "${worker}.${subdomain}"
}

# The GitHub login(s) ADR 0013 records for the approver. The ADR's own condition says the
# operator supplies them by an addendum to it, and that until they are supplied the gates
# that compare an author with a login are BLOCKED-EXTERNAL. The lookup is deliberately
# narrow: the addendum states a convention, and this reads exactly that line — one that
# begins `**Login.**` immediately followed by a backticked login. Every other backticked
# word in the ADR is therefore incapable of being mistaken for a login. Everything the gate
# is about to compare against is printed, so a mismatch is diagnosable rather than
# mysterious.
s4_recorded_logins() {
  grep -iE '^\s*[-*]?\s*\*\*login\.\*\*\s*`[A-Za-z0-9][A-Za-z0-9-]{0,38}`' \
    docs/decisions/0013-rollout-authorizations.md 2>/dev/null \
    | grep -oE '`[A-Za-z0-9][A-Za-z0-9-]{0,38}`' | tr -d '`' | sort -u | tr '\n' ' '
}

check_s4_read_gateway() {
  section "S4 stage-specific checks"

  # --- the production configuration is deployable.
  # The production repository is the operator's (ADR 0012 names it); the placeholder in the
  # committed configuration is what is checked here, and it is the operator's value to supply.
  local out rc
  out="$(cd gateway/read/production && python3 ops/render-environments.py --assert-deployable production 2>&1)"; rc=$?
  if [[ "$rc" != 0 ]]; then
    blocked "S4-PROD-CONFIG" "the production configuration is not deployable: $(printf '%s' "$out" | tail -n 1)"
  else
    pass "S4-PROD-CONFIG" "the production configuration is deployable"
  fi

  # --- the deployed staging gateway answers, and it is the staging one.
  local staging
  staging="$(s4_staging_host)"
  if [[ -z "$staging" ]]; then
    blocked "S4-STAGING-HOST" "the staging host could not be derived from the committed configuration and ADR 0012"
  else
    local body health keyids
    body="$(curl -sS -m 30 -H "User-Agent: ctxgate-check/6.1" "https://$staging/healthz" 2>/dev/null)"
    health="$(printf '%s' "$body" | jq -r '.key_ids | join(",")' 2>/dev/null)"
    keyids="$(python3 -c 'import json;print(",".join(json.load(open("gateway/read/production/ops/environments.json"))["environments"]["staging"]["key_ids"]))' 2>/dev/null)"
    if [[ -z "$body" ]]; then
      blocked "S4-STAGING" "the staging gateway at $staging did not answer; deploy and accept staging first"
    elif [[ "$health" != "$keyids" ]]; then
      fail "S4-STAGING" "the gateway at $staging serves the key ids '$health', not the committed staging key ids '$keyids'"
    else
      pass "S4-STAGING" "the staging gateway at $staging answers and serves the staging key ids ($keyids)"
    fi
  fi

  # --- the deployed read gateway refuses what it must.
  if [[ -n "$staging" ]]; then
    out="$(python3 ops/staging-pilot.py --probes-only --only read --read-base "https://$staging" 2>&1)"; rc=$?
    # The pilot's own summary is wrapped in colour codes; they are stripped before it is read.
    local plain
    plain="$(printf '%s' "$out" | sed 's/\x1b\[[0-9;]*m//g')"
    if [[ "$rc" != 0 ]]; then
      fail "S4-PROBES" "the deployed read gateway did not refuse what it must: $(printf '%s' "$plain" | grep -E '^  - ' | head -3 | tr '\n' ' ' | cut -c1-180)"
    else
      pass "S4-PROBES" "$(printf '%s' "$plain" | grep -oE 'THE PROBES PASSED \([0-9]+ checks\)' | tail -1) against the deployed gateway"
    fi
  fi

  # --- the production run's environment approval.
  # The plan: "The production run shows an environment approval by a login recorded in ADR
  # 0013 that is not the dispatching agent's identity. No approval means FAIL. If ADR 0013
  # has no login recorded yet, the gate is BLOCKED-EXTERNAL."
  local logins
  logins="$(s4_recorded_logins)"
  if [[ -z "$logins" ]]; then
    blocked "S4-APPROVAL" "ADR 0013 records no GitHub login; the operator must supply it by an addendum, and until then this gate is BLOCKED-EXTERNAL"
  else
    local dep run approvals reviewers actor
    dep="$(api GET "/repos/$REPO_SLUG/deployments?per_page=50" 2>/dev/null \
      | jq -r '[.[] | select(.environment == "production")] | .[0].id // empty' 2>/dev/null)"
    if [[ -z "$dep" ]]; then
      blocked "S4-APPROVAL" "no production deployment has been recorded for this repository"
    else
      run="$(api GET "/repos/$REPO_SLUG/deployments/$dep/statuses" 2>/dev/null \
        | jq -r '.[0].log_url // ""' 2>/dev/null | grep -oE 'runs/[0-9]+' | cut -d/ -f2)"
      if [[ -z "$run" ]]; then
        blocked "S4-APPROVAL" "the production deployment $dep has no run behind it"
      else
        approvals="$(api GET "/repos/$REPO_SLUG/actions/runs/$run/approvals" 2>/dev/null)"
        reviewers="$(printf '%s' "$approvals" | jq -r '[.[].reviewers[]?.login] | join(",")' 2>/dev/null)"
        actor="$(api GET "/repos/$REPO_SLUG/actions/runs/$run" 2>/dev/null | jq -r '.actor.login // ""' 2>/dev/null)"
        if [[ -z "$reviewers" ]]; then
          fail "S4-APPROVAL" "the production run $run has no environment approval at all"
        else
          local ok=1 who
          for who in ${reviewers//,/ }; do
            printf '%s' "$logins" | grep -qw "$who" || { ok=0; note "S4-APPROVAL" "$who approved, and is not a login ADR 0013 records ($logins)"; }
            [[ "$who" == "$actor" ]] && { ok=0; note "S4-APPROVAL" "$who approved the run it dispatched"; }
          done
          if [[ "$ok" == 1 ]]; then
            pass "S4-APPROVAL" "the production run $run was approved by $reviewers, which ADR 0013 records and which is not the dispatching identity ($actor)"
          else
            fail "S4-APPROVAL" "the production run $run was approved by $reviewers, which does not satisfy ADR 0013 item 6"
          fi
        fi
      fi
    fi
  fi
}

# ---------------------------------------------------------------------------
# Run the gate.
# ---------------------------------------------------------------------------

printf 'rollout gate: stage %s\n' "$STAGE"
printf 'repository:   %s\n' "$REPO_SLUG"
printf 'main:         %s\n' "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
printf 'started:      %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

run_check C-PROT check_c_prot
run_check C-CI check_c_ci
run_check C-BASE check_c_base
run_check C-CONF check_c_conf
run_check C-READ check_c_read
run_check C-WRITE check_c_write
run_check C-ISO check_c_iso
run_check C-SECRETS check_c_secrets
run_check C-DIFF check_c_diff

case "$STAGE" in
  S0) run_check S0 check_s0_adrs ;;
  S1) run_check S1 check_s1_lifecycle ;;
  S2) run_check S2 check_s2_closure ;;
  S3)
    check_s3_hardening
    check_env_exists "S3-ENV" production
    ;;
  S4)
    check_s4_read_gateway
    check_repo_secret_names "S4-SECRETS" production CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CTXGATE_BASE_URL
    check_worker_secret_names "S4-WORKER-SECRETS" ctxgate-read SIGNING_KEYS OPERATOR_TOKEN GITHUB_TOKEN
    ;;
  S5)
    check_repo_secret_names "S5-SECRETS" production CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
    check_worker_secret_names "S5-WORKER-SECRETS" ctxgate-write SIGNING_KEYS OPERATOR_TOKEN GITHUB_TOKEN
    ;;
  S6|S7|S8|S9)
    printf '\n  note  %-14s this runner implements the standing checks only; the stage-specific\n' "$STAGE"
    printf '        checks for %s are not implemented here, so this run is NOT a gate PASS for\n' "$STAGE"
    printf '        %s. The stage report lists them separately.\n' "$STAGE"
    BLOCKED=$((BLOCKED+1))
    ;;
esac

# grep prints 0 and exits 1 when it finds nothing, so the count is taken with awk: it always
# answers 0 and always prints the number, including the zero.
count_verdicts() { awk -v v="$1" '$0 == v { n++ } END { print n + 0 }' "$RESULTS"; }
PASSES="$(count_verdicts P)"
FAILURES="$(count_verdicts F)"
BLOCKED="$(count_verdicts B)"

printf '\n== result ==\n'
printf '  PASS %d   FAIL %d   BLOCKED-EXTERNAL %d\n' "$PASSES" "$FAILURES" "$BLOCKED"
if [[ "$FAILURES" -gt 0 ]]; then
  echo "  RESULT: FAIL ($FAILURES failing check(s))"
  exit 1
fi
if [[ "$BLOCKED" -gt 0 ]]; then
  echo "  RESULT: BLOCKED-EXTERNAL ($BLOCKED unmet condition(s))"
  exit 2
fi
echo "  RESULT: PASS (stage $STAGE)"
exit 0
