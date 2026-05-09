#!/usr/bin/env bash
# Workflow command-composition regression.
#
# Asserts that every lock-protected step in the install/release-candidate
# workflows invokes the diagnostic wrapper stack in the canonical order:
#
#   scripts/ci/run-with-log.sh ... \
#     scripts/ci/with-runner-lock.sh ... \
#     scripts/ci/time-command.sh ... \
#     <command body>
#
# This guards the eighth-round design correction: with-runner-lock.sh
# emits its "Waiting for runner lock" line BEFORE invoking the child
# command, so wrapping the lock with the logger (logger outermost) is
# the only way that wait line lands in the diagnostic artifact log. A
# future edit that reshuffles the wrapper order would silently lose
# lock wait/timeout diagnostics; this test catches that drift.
#
# The check is grep-based and tolerant of whitespace and YAML line
# continuations: it normalizes the file to a single line of tokens
# before searching, so trivial reformatting does not break the contract.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS=0
FAIL=0
FAILURES=()

assert_contains_in_order() {
  local file="$1"
  local label="$2"
  shift 2
  local needles=("$@")

  if [ ! -f "$file" ]; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: file not found: $file")
    return 1
  fi

  # Normalize: strip YAML comments, collapse all whitespace (including newlines)
  # into single spaces. This makes substring matching tolerant of line wraps
  # and indentation while still forbidding token reordering.
  local normalized
  normalized="$(sed 's/#.*$//' "$file" | tr '\n' ' ' | tr -s ' ')"

  # Build a regex that requires the wrappers in order on the same logical
  # invocation chain. We allow any non-newline characters (already absent
  # after normalization) between the tokens.
  local pattern=""
  local first=1
  for needle in "${needles[@]}"; do
    local escaped
    escaped="$(printf '%s' "$needle" | sed -e 's/[.[\*^$()+?{|]/\\&/g')"
    if [ "$first" -eq 1 ]; then
      pattern="$escaped"
      first=0
    else
      pattern="$pattern.*$escaped"
    fi
  done

  if printf '%s' "$normalized" | grep -Eq "$pattern"; then
    PASS=$((PASS + 1))
    echo "PASS: $label"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: composition order not found in $file (looking for: ${needles[*]})")
    echo "FAIL: $label" >&2
  fi
}

assert_not_contains() {
  local file="$1"
  local label="$2"
  local forbidden="$3"

  if [ ! -f "$file" ]; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: file not found: $file")
    return 1
  fi

  if grep -Fq "$forbidden" "$file"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: forbidden text found in $file: $forbidden")
    echo "FAIL: $label" >&2
  else
    PASS=$((PASS + 1))
    echo "PASS: $label"
  fi
}

# Each assertion below identifies one lock-protected wrapper invocation
# and asserts the canonical order. The "command body" anchor (last needle)
# distinguishes which step we are asserting on so two distinct lock-protected
# steps cannot both pass against the same wrapper text.

# --- release-candidate.yml --------------------------------------------------
RC="$REPO_ROOT/.github/workflows/release-candidate.yml"

assert_contains_in_order "$RC" \
  "release-candidate fresh-install-test composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "fresh install e2e"' \
  "fresh-install.test.sh"

assert_contains_in_order "$RC" \
  "release-candidate container-health start composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "container-health start"' \
  "docker compose build"

assert_contains_in_order "$RC" \
  "release-candidate container-health e2e composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "container-health e2e"' \
  "container-health.test.sh"

assert_contains_in_order "$RC" \
  "release-candidate auth-flow start composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "auth-flow start"' \
  "docker compose build"

assert_contains_in_order "$RC" \
  "release-candidate auth-flow e2e composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "auth-flow e2e"' \
  "auth-flow.test.sh"

# release-candidate.yml deliberately does not run an upgrade matrix or
# upgrade-full-recovery job — install-test.yml's serialized chain owns
# upgrade coverage on tag pushes. See the "Upgrade coverage note"
# comment block in release-candidate.yml.

# --- install-test.yml -------------------------------------------------------
IT="$REPO_ROOT/.github/workflows/install-test.yml"

assert_contains_in_order "$IT" \
  "install-test fresh-install-test composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "fresh install e2e"' \
  "fresh-install.test.sh"

assert_contains_in_order "$IT" \
  "install-test install-script composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "install script e2e"' \
  "install-script.test.sh"

assert_contains_in_order "$IT" \
  "install-test upgrade-baseline composition" \
  "run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  "scripts/ci/time-command.sh" \
  "upgrade-install.test.sh --mode core"

# --- buildx-action removal regression ---------------------------------------
# Plan requires removing docker/setup-buildx-action from the five
# Docker-backed release-candidate install/upgrade jobs. Comments referring
# to the removal are allowed; an actual `uses:` line is not.
buildx_uses_lines="$(grep -nE '^\s*uses:\s*docker/setup-buildx-action' "$RC" || true)"
if [ -n "$buildx_uses_lines" ]; then
  FAIL=$((FAIL + 1))
  FAILURES+=("release-candidate.yml still references docker/setup-buildx-action: $buildx_uses_lines")
  echo "FAIL: docker/setup-buildx-action must be removed from release-candidate.yml" >&2
else
  PASS=$((PASS + 1))
  echo "PASS: docker/setup-buildx-action removed from release-candidate.yml"
fi

# --- verify-vectors Vitest worker stability ---------------------------------
# Forgejo runner containers have previously failed server Vitest slices with
# fork-worker termination errors. Keep vector workflow server tests on the
# repo's stable CI Vitest entrypoint.
VV="$REPO_ROOT/.github/workflows/verify-vectors.yml"
verify_vector_default_vitest="$(grep -n 'npm run test:run --' "$VV" || true)"
if [ -n "$verify_vector_default_vitest" ]; then
  FAIL=$((FAIL + 1))
  FAILURES+=("verify-vectors.yml must use npm run test:run:ci for server Vitest slices: $verify_vector_default_vitest")
  echo "FAIL: verify-vectors.yml uses the default Vitest fork pool" >&2
else
  PASS=$((PASS + 1))
  echo "PASS: verify-vectors.yml uses stable server Vitest CI entrypoint"
fi

# --- architecture native-toolchain retry stability --------------------------
ARCHITECTURE_WORKFLOW="$REPO_ROOT/.github/workflows/architecture.yml"

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture docs typecheck retry composition" \
  "Typecheck Docusaurus site" \
  "SANCTUARY_RETRY_ATTEMPTS: '5'" \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "docs typecheck"' \
  'scripts/ci/time-command.sh "docs typecheck"' \
  "npm --prefix website run typecheck"

# --- full frontend typecheck retry stability --------------------------------
TEST_WORKFLOW="$REPO_ROOT/.github/workflows/test.yml"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend app typecheck retry composition" \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "frontend app typecheck"' \
  'scripts/ci/time-command.sh "frontend app typecheck"' \
  "npm run typecheck:app"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend test typecheck retry composition" \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "frontend test typecheck"' \
  'scripts/ci/time-command.sh "frontend test typecheck"' \
  "npm run typecheck:tests"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick AI proxy package test composition" \
  "quick-ai-proxy-tests:" \
  "npm --prefix ai-proxy run build" \
  "npm --prefix ai-proxy run test"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full AI proxy Vitest coverage retry composition" \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-vitest-infrastructure-failure.sh "AI proxy coverage"' \
  'scripts/ci/time-command.sh "AI proxy coverage"' \
  "npm --prefix ai-proxy run test:coverage -- --pool threads --maxWorkers=1 --no-file-parallelism"

assert_not_contains "$TEST_WORKFLOW" \
  "AI proxy CI must not allow zero discovered tests" \
  "npx vitest run tests/ai-proxy --passWithNoTests"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full browser backend build retry budget" \
  "full-browser-e2e-tests:" \
  "SANCTUARY_RETRY_ATTEMPTS: '5'" \
  'scripts/ci/retry-command.sh "browser backend build"' \
  "npm --ignore-scripts run build"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full build-check backend build retry budget" \
  "full-build-check:" \
  "SANCTUARY_RETRY_ATTEMPTS: '5'" \
  'scripts/ci/retry-command.sh" "build check backend build"' \
  "npm --ignore-scripts run build"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick browser Playwright infrastructure retry" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "quick browser smoke"' \
  'scripts/ci/time-command.sh "quick browser smoke"' \
  "npm run test:e2e -- --project=chromium e2e/admin-drafts-smoke.spec.ts"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick render Playwright infrastructure retry" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "quick render regression"' \
  'scripts/ci/time-command.sh "quick render regression"' \
  "npm run test:e2e -- --project=chromium e2e/render-regression.spec.ts"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full browser Playwright infrastructure retry" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "browser-flow E2E ${browser_group}"' \
  'scripts/ci/time-command.sh "browser-flow E2E ${browser_group}"' \
  'npm run test:e2e -- --project=chromium "${browser_specs[@]}"'

assert_contains_in_order "$TEST_WORKFLOW" \
  "full render Playwright infrastructure retry" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "render regression E2E"' \
  'scripts/ci/time-command.sh "render regression E2E"' \
  "npm run test:e2e -- --project=chromium e2e/render-regression.spec.ts"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend coverage merge Vitest retry" \
  "full-frontend-coverage-merge:" \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-vitest-infrastructure-failure.sh "frontend coverage merge"' \
  'scripts/ci/time-command.sh "frontend coverage merge"' \
  "npm run test:coverage:merge -- .vitest-reports"

# --- summary ----------------------------------------------------------------
echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do
    echo "  - $f" >&2
  done
  exit 1
fi
