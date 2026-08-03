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

assert_occurrence_count() {
  local file="$1"
  local label="$2"
  local needle="$3"
  local expected="$4"
  local actual

  if [ ! -f "$file" ]; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: file not found: $file")
    return 1
  fi

  actual="$(awk -v needle="$needle" 'index($0, needle) { count += 1 } END { print count + 0 }' "$file")"
  if [ "$actual" -eq "$expected" ]; then
    PASS=$((PASS + 1))
    echo "PASS: $label"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: expected $expected occurrences of $needle in $file, found $actual")
    echo "FAIL: $label" >&2
  fi
}

node24_runner_report() {
  awk '
      function finish_job() {
        if (job != "" && !selected) {
          print job
        }
        job = ""
      }

      /^jobs:$/ {
        in_jobs = 1
        next
      }

      in_jobs && /^[^ ]/ {
        if ($0 ~ /^#/) {
          next
        }
        finish_job()
        in_jobs = 0
      }

      in_jobs && /^  [[:alnum:]_-]+:$/ {
        finish_job()
        job = $0
        sub(/^  /, "", job)
        sub(/:$/, "", job)
        selected = 0
        count += 1
        next
      }

      in_jobs && /^    runs-on: ubuntu-22\.04$/ {
        selected = 1
      }

      END {
        finish_job()
        print "__COUNT__=" count
      }
    ' "$1"
}

assert_jobs_use_node24_runners() {
  local file="$1"
  local label="$2"
  local expected_jobs="$3"
  local report
  local actual_jobs
  local missing

  if [ ! -f "$file" ]; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: file not found: $file")
    return 1
  fi

  report="$(node24_runner_report "$file")"
  actual_jobs="$(printf '%s\n' "$report" | sed -n 's/^__COUNT__=//p')"
  missing="$(printf '%s\n' "$report" | sed '/^__COUNT__=/d')"

  if [ "$actual_jobs" != "$expected_jobs" ]; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: expected $expected_jobs jobs, parsed ${actual_jobs:-0}")
    echo "FAIL: $label" >&2
  elif [ -z "$missing" ]; then
    PASS=$((PASS + 1))
    echo "PASS: $label"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: jobs missing ubuntu-22.04: $(printf '%s' "$missing" | tr '\n' ' ')")
    echo "FAIL: $label" >&2
  fi
}

assert_runner_parser_rejects_post_comment_drift() {
  local fixture
  local report
  local actual_jobs
  local missing

  fixture="$(mktemp)"
  printf '%s\n' \
    'jobs:' \
    '  valid-job:' \
    '    runs-on: ubuntu-22.04' \
    '# Column-zero comments must not truncate job scanning.' \
    '  invalid-job:' \
    '    runs-on: ubuntu-latest' > "$fixture"

  report="$(node24_runner_report "$fixture")"
  rm -f "$fixture"

  actual_jobs="$(printf '%s\n' "$report" | sed -n 's/^__COUNT__=//p')"
  missing="$(printf '%s\n' "$report" | sed '/^__COUNT__=/d')"
  if [ "$actual_jobs" = "2" ] && [ "$missing" = "invalid-job" ]; then
    PASS=$((PASS + 1))
    echo "PASS: runner parser rejects post-comment drift"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("runner parser did not reject post-comment drift")
    echo "FAIL: runner parser rejects post-comment drift" >&2
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

assert_contains_in_order "$RC" \
  "release-candidate sink env" \
  "SANCTUARY_CI_LOG_SINK_URL" \
  "SANCTUARY_CI_LOG_SINK_TOKEN"

assert_contains_in_order "$RC" \
  "release-candidate tag-scoped workflow concurrency" \
  "concurrency:" \
  'group: sanctuary-release-candidate-${{ github.ref }}' \
  "cancel-in-progress: false"

assert_contains_in_order "$RC" \
  "release-candidate Docker jobs require the DIND runner" \
  "fresh-install-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "container-health-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "auth-flow-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]"

assert_occurrence_count "$RC" \
  "every release-candidate ad hoc stack generates the diagnostics secret" \
  'WORKER_DIAGNOSTICS_SECRET=$(openssl rand -hex 32)' \
  2

assert_occurrence_count "$RC" \
  "every release-candidate ad hoc stack exports the diagnostics secret" \
  'export JWT_SECRET ENCRYPTION_KEY ENCRYPTION_SALT GATEWAY_SECRET WORKER_DIAGNOSTICS_SECRET' \
  2

assert_contains_in_order "$RC" \
  "release-candidate isolated stack jobs allow a full DIND build window" \
  "container-health-test:" \
  "timeout-minutes: 30" \
  "auth-flow-test:" \
  "timeout-minutes: 30"

assert_not_contains "$RC" \
  "release-candidate checkout must not use raw input ref" \
  '${{ github.event.inputs.ref || inputs.ref || '\''main'\'' }}'

assert_contains_in_order "$RC" \
  "release-candidate trusted ref resolution" \
  "validation-info:" \
  "Resolve trusted candidate ref" \
  "Release candidate ref must be main, release/*, or a v* tag" \
  "candidate_ref=\$candidate_ref" \
  "unit-tests:" \
  'ref: ${{ needs.validation-info.outputs.candidate_ref }}' \
  "fresh-install-test:" \
  'ref: ${{ needs.validation-info.outputs.candidate_ref }}' \
  "container-health-test:" \
  'ref: ${{ needs.validation-info.outputs.candidate_ref }}' \
  "auth-flow-test:" \
  'ref: ${{ needs.validation-info.outputs.candidate_ref }}'

assert_contains_in_order "$RC" \
  "release-candidate diagnostic summaries publishable" \
  "Write fresh install diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Release Candidate Fresh Install"' \
  "Write container health diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Release Candidate Container Health"' \
  "Write auth flow diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Release Candidate Auth Flow"'

assert_contains_in_order "$RC" \
  "release-candidate exact cleanup verification" \
  "fresh-install-test:" \
  'cleanup-docker-resources.sh --project "$project" --verify-empty' \
  "container-health-test:" \
  'cleanup-docker-resources.sh --project "$project" --verify-empty' \
  "auth-flow-test:" \
  'cleanup-docker-resources.sh --project "$project" --verify-empty'

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

assert_contains_in_order "$IT" \
  "install-test sink env" \
  "SANCTUARY_CI_LOG_SINK_URL" \
  "SANCTUARY_CI_LOG_SINK_TOKEN"

assert_contains_in_order "$IT" \
  "install-test release-tag workflow concurrency" \
  "concurrency:" \
  "github.event_name == 'pull_request'" \
  "startsWith(github.ref, 'refs/tags/v')" \
  "format('sanctuary-install-release-{0}', github.ref)" \
  "'sanctuary-runner-e2e-workflow'" \
  'cancel-in-progress: ${{ github.event_name == '\''pull_request'\'' }}'

assert_contains_in_order "$IT" \
  "install-test Docker jobs require the DIND runner" \
  "fresh-install-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "install-script-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "install-stack-smoke:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "container-health-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "auth-flow-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "upgrade-baseline-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "upgrade-extended-fixture-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "upgrade-extended-test:" \
  "runs-on: [ubuntu-22.04, x300-canary]" \
  "docker-resource-cleanup:" \
  "runs-on: [ubuntu-22.04, x300-canary]"

assert_contains_in_order "$IT" \
  "install stack supplies the diagnostics secret" \
  "WORKER_DIAGNOSTICS_SECRET=\$(openssl rand -hex 32)" \
  'WORKER_DIAGNOSTICS_SECRET="$WORKER_DIAGNOSTICS_SECRET"' \
  "docker compose up -d --build"

assert_occurrence_count "$IT" \
  "every install-test ad hoc stack generates the diagnostics secret" \
  'WORKER_DIAGNOSTICS_SECRET=$(openssl rand -hex 32)' \
  3

assert_occurrence_count "$IT" \
  "every install-test ad hoc stack supplies the diagnostics secret" \
  'WORKER_DIAGNOSTICS_SECRET="$WORKER_DIAGNOSTICS_SECRET"' \
  3

assert_contains_in_order "$IT" \
  "install-test unit diagnostics" \
  "unit-tests:" \
  "JOB_LOG_DIR:" \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/install-unit-tests.log"' \
  "Write install unit diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Install Unit Tests"' \
  "diag-install-unit-tests"

assert_contains_in_order "$IT" \
  "install-test static workflow validation" \
  "unit-tests:" \
  "./tests/install/unit/install-scope.test.sh" \
  "./tests/ci/check-workflow-composition.test.sh"

assert_contains_in_order "$IT" \
  "install-test upgrade selection inputs and outputs" \
  "upgrade_fixture:" \
  "upgrade_baseline_refs:" \
  "upgrade_extended_fixtures:" \
  "WORKFLOW_INPUT_UPGRADE_FIXTURE:" \
  "WORKFLOW_INPUT_UPGRADE_SOURCE_REF:"

assert_contains_in_order "$IT" \
  "install-test fresh install sink summary" \
  "fresh-install-test:" \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/container-logs.log"' \
  "Write install diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Install Fresh Install"' \
  "diag-install-fresh-install"

assert_contains_in_order "$IT" \
  "install-test stack smoke diagnostics" \
  "install-stack-smoke:" \
  'JOB_LOG_DIR: ${{ github.workspace }}/.tmp/job-logs/install-stack-smoke' \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/start-stack.log"' \
  'scripts/ci/time-command.sh "install stack startup"' \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/container-health.log"' \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/auth-flow.log"' \
  "Write install stack diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Install Stack Smoke"' \
  "diag-install-stack-smoke"

assert_contains_in_order "$IT" \
  "install-test container health diagnostics" \
  "container-health-test:" \
  'JOB_LOG_DIR: ${{ github.workspace }}/.tmp/job-logs/container-health' \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/start-containers.log"' \
  'scripts/ci/time-command.sh "container health start"' \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/container-health.log"' \
  'scripts/ci/time-command.sh "container health e2e"' \
  "Write container health diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Install Container Health"' \
  "diag-container-health"

assert_contains_in_order "$IT" \
  "install-test auth flow diagnostics" \
  "auth-flow-test:" \
  'JOB_LOG_DIR: ${{ github.workspace }}/.tmp/job-logs/auth-flow' \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/start-containers.log"' \
  'scripts/ci/time-command.sh "auth flow start"' \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/auth-flow.log"' \
  'scripts/ci/time-command.sh "auth flow e2e"' \
  "Write auth flow diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Install Auth Flow"' \
  "diag-auth-flow"

assert_contains_in_order "$IT" \
  "install-test upgrade diagnostic summaries" \
  "upgrade-baseline-test:" \
  "UPGRADE_BASELINE_REFS:" \
  "upgrade_validate_baseline_ref_selection" \
  "upgrade_sanitize_label" \
  "Post-upgrade DIND diagnostics" \
  "Write upgrade baseline timing summary" \
  'scripts/ci/report-timing-notices.sh --log-file "$combined"' \
  "Write upgrade baseline diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Upgrade Baseline"' \
  "upgrade-extended-fixture-test:" \
  "Pre-flight diagnostics" \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/upgrade-extended-fixtures.log"' \
  "scripts/ci/run-extended-upgrade-fixtures.sh" \
  '--fixtures "$SANCTUARY_UPGRADE_EXTENDED_FIXTURES"' \
  '--source-ref "${SANCTUARY_UPGRADE_SOURCE_REF_OVERRIDE:-latest-stable}"' \
  "Post-upgrade DIND diagnostics" \
  "Write extended upgrade timing summary" \
  'scripts/ci/report-timing-notices.sh --log-file "$JOB_LOG_DIR/upgrade-extended-fixtures.log"' \
  "Write extended upgrade diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$JOB_LOG_DIR" "Upgrade Extended Fixtures"' \
  "diag-upgrade-extended-fixtures" \
  "upgrade-extended-test:" \
  "SELECTED_EXTENDED_FIXTURES:" \
  "Selected extended upgrade fixtures did not pass"

assert_contains_in_order "$IT" \
  "install-test selected upgrade summary gate" \
  "test-summary:" \
  "RUN_UPGRADE_BASELINE:" \
  "RUN_UPGRADE_EXTENDED:" \
  "SELECTED_UPGRADE_FAILED=false" \
  "Selected baseline upgrade refs did not pass" \
  "Selected extended upgrade fixtures did not pass" \
  'if [ "$SELECTED_UPGRADE_FAILED" = "true" ]; then'

assert_contains_in_order "$IT" \
  "install-test cleanup DIND telemetry" \
  "docker-resource-cleanup:" \
  "Verify current-run Docker cleanup" \
  "--verify-empty" \
  "Post-cleanup DIND diagnostics" \
  'sanctuary-ci-fresh-${{ github.run_id }}' \
  'sanctuary-ci-stack-${{ github.run_id }}' \
  'sanctuary-ci-health-${{ github.run_id }}' \
  'sanctuary-ci-auth-${{ github.run_id }}' \
  'sanctuary-ci-upgrade-${{ github.run_id }}' \
  'diag-docker-resource-cleanup-${{ github.run_id }}'

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
  "scripts/ci/run-with-log.sh" \
  ".tmp/ci-diagnostics/architecture/docs-typecheck.log" \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "docs typecheck"' \
  'scripts/ci/time-command.sh "docs typecheck"' \
  "npm --prefix website run typecheck"

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture diagnostic summary upload" \
  "Write architecture diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh ".tmp/ci-diagnostics/architecture" "Architecture"' \
  "Upload architecture diagnostics" \
  "ci-diagnostics-architecture"

# --- full frontend typecheck retry stability --------------------------------
TEST_WORKFLOW="$REPO_ROOT/.github/workflows/test.yml"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend app typecheck retry composition" \
  "full-frontend-typechecks:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/app-typecheck.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "frontend app typecheck"' \
  'scripts/ci/time-command.sh "frontend app typecheck"' \
  "npm run typecheck:app"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend test typecheck retry composition" \
  "full-frontend-typechecks:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/test-typecheck.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "frontend test typecheck"' \
  'scripts/ci/time-command.sh "frontend test typecheck"' \
  "npm run typecheck:tests"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend typecheck diagnostic upload" \
  "Write frontend typecheck diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Frontend Typecheck (${{ matrix.target }})"' \
  "Upload frontend typecheck diagnostics" \
  'ci-diagnostics-frontend-typecheck-${{ matrix.target }}'

assert_contains_in_order "$TEST_WORKFLOW" \
  "full backend typecheck diagnostics" \
  "full-backend-typecheck:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/server-test-typecheck.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "server test typecheck"' \
  'scripts/ci/time-command.sh "server test typecheck"' \
  "npm run typecheck:tests" \
  "Write backend typecheck diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Backend Typecheck"' \
  "Upload backend typecheck diagnostics" \
  "ci-diagnostics-backend-typecheck"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full backend unit coverage shards diagnostics" \
  "full-backend-unit-coverage-shards:" \
  'matrix:' \
  'shard: [1, 2]' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/unit-coverage.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/time-command.sh "backend unit coverage shard ${{ matrix.shard }}"' \
  'scripts/ci/backend-coverage-shard.sh ${{ matrix.shard }} 2' \
  "Upload backend coverage shard blob" \
  'path: server/.vitest-reports/blob-${{ matrix.shard }}-2.json' \
  'if-no-files-found: error' \
  'include-hidden-files: true' \
  "Write backend unit coverage shard failure breadcrumb" \
  'scripts/ci/write-empty-diagnostic-breadcrumb.sh' \
  '"backend-unit-coverage-shard-${{ matrix.shard }}-failure.log"' \
  "Write backend unit coverage shard diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Backend Unit Coverage shard ${{ matrix.shard }}"' \
  "Upload backend unit coverage shard diagnostics" \
  "ci-diagnostics-backend-unit-coverage-shard-"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full backend unit coverage merge aggregate" \
  "full-backend-unit-coverage:" \
  "needs.full-backend-unit-coverage-shards.result == 'success'" \
  "Fail fast if any shard failed" \
  "needs.full-backend-unit-coverage-shards.result != 'success'" \
  "Download shard 1 blob" \
  "Download shard 2 blob" \
  'scripts/ci/backend-coverage-merge.sh' \
  "Upload merged backend coverage" \
  "ci-diagnostics-backend-unit-coverage"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full backend integration diagnostics" \
  "full-backend-integration-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/resolve-postgres.log"' \
  "scripts/ci/resolve-postgres-service.sh" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/integration-tests.log"' \
  "scripts/ci/backend-integration-groups.sh" \
  "scripts/ci/prepare-integration-db.sh" \
  "scripts/ci/with-runner-lock.sh" \
  "scripts/ci/retry-vitest-infrastructure-failure.sh" \
  "backend integration" \
  "scripts/ci/time-command.sh" \
  'npm run test:run:ci -- "${specs[@]}"' \
  "Write backend integration diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Backend Integration"' \
  "Upload backend integration diagnostics" \
  "ci-diagnostics-backend-integration"

assert_occurrence_count "$TEST_WORKFLOW" \
  "all Postgres-backed lanes use the verified service resolver" \
  "scripts/ci/resolve-postgres-service.sh" \
  3

for postgres_password in \
  'sanctuary-ci-${{ github.run_id }}-${{ github.run_attempt }}-quick-smoke' \
  'sanctuary-ci-${{ github.run_id }}-${{ github.run_attempt }}-full-integration' \
  'sanctuary-ci-${{ github.run_id }}-${{ github.run_attempt }}-browser-e2e'; do
  assert_occurrence_count "$TEST_WORKFLOW" \
    "Postgres service and resolver share one job-unique credential" \
    "$postgres_password" \
    2
done

assert_not_contains "$TEST_WORKFLOW" \
  "Postgres-backed lanes must not prefer the shared service alias" \
  "if getent hosts postgres"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full gateway diagnostics" \
  "full-gateway-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/gateway-coverage.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/time-command.sh "gateway coverage"' \
  "npm run test:coverage" \
  "Write gateway diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Gateway"' \
  "Upload gateway diagnostics" \
  "ci-diagnostics-gateway"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full LLM egress proxy diagnostics" \
  "full-llm-egress-proxy-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/llm-egress-proxy-coverage.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-vitest-infrastructure-failure.sh "LLM egress proxy coverage"' \
  'scripts/ci/time-command.sh "LLM egress proxy coverage"' \
  "npm --prefix llm-egress-proxy run test:coverage -- --pool threads --maxWorkers=1 --no-file-parallelism" \
  "Write LLM egress proxy diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "LLM Egress Proxy"' \
  "Upload LLM egress proxy diagnostics" \
  "ci-diagnostics-llm-egress-proxy"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full critical mutation shards diagnostics" \
  "full-critical-mutation-shards:" \
  'matrix:' \
  'shard: [1, 2, 3]' \
  'MUTATION_SHARD: ${{ matrix.shard }}' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/critical-mutation-gate.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/time-command.sh "critical mutation shard ${{ matrix.shard }}"' \
  "npm run test:mutation:critical:shard" \
  "Write critical mutation shard diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Critical Mutation shard ${{ matrix.shard }}"' \
  "Upload critical mutation shard diagnostics" \
  "ci-diagnostics-critical-mutation-shard-"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full critical mutation aggregate" \
  "full-critical-mutation:" \
  "needs.full-critical-mutation-shards.result == 'success'" \
  "Fail fast if any shard failed" \
  "needs.full-critical-mutation-shards.result != 'success'" \
  "Download shard 1 report" \
  "Download shard 2 report" \
  "Download shard 3 report" \
  "npm run mutation:merge-shards" \
  "node scripts/mutation/check-critical-mutation-gate.mjs"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full browser E2E diagnostics" \
  "full-browser-e2e-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/browser-flow-e2e.log"' \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "browser-flow E2E ${browser_group}"' \
  'scripts/ci/time-command.sh "browser-flow E2E ${browser_group}"' \
  'npm run test:e2e -- --project=chromium "${browser_specs[@]}"' \
  "Write browser E2E diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Browser E2E"' \
  "Upload browser E2E diagnostics" \
  "ci-diagnostics-browser-e2e"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full render E2E diagnostics" \
  "full-render-e2e-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/render-regression-e2e.log"' \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "render regression E2E"' \
  'scripts/ci/time-command.sh "render regression E2E"' \
  "npm run test:e2e -- --project=chromium e2e/render-regression.spec.ts" \
  "Write render E2E diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Render E2E"' \
  "Upload render E2E diagnostics" \
  "ci-diagnostics-render-e2e"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full build-check diagnostics" \
  "full-build-check:" \
  "scripts/ci/run-with-log.sh" \
  '$DIAGNOSTIC_DIR/backend-build.log' \
  "scripts/ci/with-runner-lock.sh" \
  "build check backend build" \
  "npm --ignore-scripts run build" \
  "Write build-check diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Build Check"' \
  "Upload build-check diagnostics" \
  "ci-diagnostics-build-check"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick test hygiene diagnostics" \
  "quick-test-hygiene:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/quick-hygiene.log"' \
  "npm run test:hygiene" \
  "Write quick hygiene diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Test Hygiene"' \
  "Upload quick hygiene diagnostics" \
  "ci-diagnostics-quick-test-hygiene"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick frontend diagnostics" \
  "quick-frontend-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/quick-frontend.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "quick frontend isolated checks"' \
  "npx vitest related --run --passWithNoTests" \
  "Write quick frontend diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Frontend"' \
  "Upload quick frontend diagnostics" \
  "ci-diagnostics-quick-frontend"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick backend typecheck diagnostics" \
  "quick-backend-typecheck:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/server-test-typecheck.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "quick backend typecheck"' \
  "npm run typecheck:tests" \
  "Write quick backend typecheck diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Backend Typecheck"' \
  "Upload quick backend typecheck diagnostics" \
  "ci-diagnostics-quick-backend-typecheck"

# The retry here MUST be signature-filtered. retry-command.sh retries any
# non-zero exit up to 3 times; it was harmless while this lane selected zero
# tests, but on a REQUIRED check that now runs real tests it would let a genuine
# assertion failure pass on a later attempt.
assert_contains_in_order "$TEST_WORKFLOW" \
  "quick backend test diagnostics" \
  "quick-backend-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/related-backend-tests.log"' \
  'scripts/ci/retry-vitest-infrastructure-failure.sh "quick backend related tests"' \
  "npx vitest related --run --passWithNoTests" \
  "Write quick backend test diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Backend Tests"' \
  "Upload quick backend test diagnostics" \
  "ci-diagnostics-quick-backend-tests"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick backend integration smoke diagnostics" \
  "quick-backend-integration-smoke:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/integration-smoke.log"' \
  'scripts/ci/retry-command.sh "quick backend integration smoke"' \
  "npm run test:run:ci -- tests/integration/websocket/websocket.integration.test.ts tests/integration/flows/auth.integration.test.ts" \
  "Write quick backend integration smoke diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Backend Integration Smoke"' \
  "Upload quick backend integration smoke diagnostics" \
  "ci-diagnostics-quick-backend-integration-smoke"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick critical mutation shards diagnostics" \
  "quick-critical-mutation-shards:" \
  'matrix:' \
  'shard: [1, 2, 3]' \
  'MUTATION_SHARD: ${{ matrix.shard }}' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/critical-mutation-gate.log"' \
  "npm run test:mutation:critical:shard" \
  "Write quick critical mutation diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Critical Mutation shard ${{ matrix.shard }}"' \
  "Upload quick critical mutation diagnostics" \
  "ci-diagnostics-quick-critical-mutation-shard-"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick critical mutation aggregate" \
  "quick-critical-mutation:" \
  "needs.quick-critical-mutation-shards.result == 'success'" \
  "Fail fast if any shard failed" \
  "needs.quick-critical-mutation-shards.result != 'success'" \
  "Download shard 1 report" \
  "Download shard 2 report" \
  "Download shard 3 report" \
  "npm run mutation:merge-shards" \
  "node scripts/mutation/check-critical-mutation-gate.mjs"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick gateway diagnostics" \
  "quick-gateway-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/related-gateway-tests.log"' \
  "npx vitest related --run --passWithNoTests" \
  "Write quick gateway diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Gateway"' \
  "Upload quick gateway diagnostics" \
  "ci-diagnostics-quick-gateway"

# Changed filenames must reach vitest as array data, never interpolated into
# the command string. They additionally go through related-test-args.sh, which
# re-roots the repo-relative paths for the lane's working-directory — without
# it vitest resolves server/server/... and silently selects nothing. See
# tests/ci/related-test-args.test.sh.
assert_contains_in_order "$TEST_WORKFLOW" \
  "quick backend changed files passed as data" \
  "Run related backend tests" \
  'BACKEND_FILES: ${{ needs.detect-changes.outputs.backend_files }}' \
  'RELATED_FILES="${BACKEND_FILES:-}"' \
  'scripts/ci/related-test-args.sh" server' \
  'mapfile -t related_files < "$args_file"' \
  'npx vitest related --run --passWithNoTests' \
  '"${related_files[@]}"'

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick gateway changed files passed as data" \
  "Run related gateway tests" \
  'GATEWAY_FILES: ${{ needs.detect-changes.outputs.gateway_files }}' \
  'RELATED_FILES="${GATEWAY_FILES:-}"' \
  'scripts/ci/related-test-args.sh" gateway' \
  'mapfile -t related_files < "$args_file"' \
  'npx vitest related --run --passWithNoTests "${related_files[@]}"'

assert_not_contains "$TEST_WORKFLOW" \
  "quick backend changed files must not interpolate into command" \
  'npx vitest related --run --passWithNoTests ${{ needs.detect-changes.outputs.backend_files }}'

# A blanket retry on this lane would mask real regressions; see above.
assert_not_contains "$TEST_WORKFLOW" \
  "quick backend related tests must not use the blanket retry wrapper" \
  'scripts/ci/retry-command.sh "quick backend related tests"'

assert_not_contains "$TEST_WORKFLOW" \
  "quick gateway changed files must not interpolate into command" \
  'npx vitest related --run --passWithNoTests ${{ needs.detect-changes.outputs.gateway_files }}'

assert_contains_in_order "$TEST_WORKFLOW" \
  "PR required checks require full summary" \
  "pr-required-checks:" \
  "full-test-summary" \
  'FULL_TEST_SUMMARY: ${{ needs.full-test-summary.result }}' \
  'require_success "Full Test Summary" "$FULL_TEST_SUMMARY"'

assert_not_contains "$TEST_WORKFLOW" \
  "PR required checks must not no-op on merge group" \
  "Merge group no-op"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full lane ready gates directly on quick lane" \
  "full-lane-ready:" \
  "quick-test-hygiene" \
  "quick-render-regression" \
  "Check full lane prerequisites" \
  "Quick PR lane is not required for \$EVENT_NAME."

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick LLM egress proxy diagnostics" \
  "quick-llm-egress-proxy-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/llm-egress-proxy-tests.log"' \
  "npm --prefix llm-egress-proxy run test" \
  "Write quick LLM egress proxy diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick LLM Egress Proxy"' \
  "Upload quick LLM egress proxy diagnostics" \
  "ci-diagnostics-quick-llm-egress-proxy"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick browser diagnostics" \
  "quick-browser-smoke:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/quick-browser-smoke.log"' \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "quick browser smoke"' \
  "Write quick browser diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Browser"' \
  "Upload quick browser diagnostics" \
  "ci-diagnostics-quick-browser"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick render diagnostics" \
  "quick-render-regression:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/quick-render-regression.log"' \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "quick render regression"' \
  "Write quick render diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quick Render"' \
  "Upload quick render diagnostics" \
  "ci-diagnostics-quick-render"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick LLM egress proxy package test composition" \
  "quick-llm-egress-proxy-tests:" \
  "npm --prefix llm-egress-proxy run build" \
  "npm --prefix llm-egress-proxy run test"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full LLM egress proxy Vitest coverage retry composition" \
  "full-llm-egress-proxy-tests:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/llm-egress-proxy-coverage.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-vitest-infrastructure-failure.sh "LLM egress proxy coverage"' \
  'scripts/ci/time-command.sh "LLM egress proxy coverage"' \
  "npm --prefix llm-egress-proxy run test:coverage -- --pool threads --maxWorkers=1 --no-file-parallelism"

assert_not_contains "$TEST_WORKFLOW" \
  "LLM egress proxy CI must not allow zero discovered tests" \
  "npx vitest run tests/llm-egress-proxy --passWithNoTests"

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
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/frontend-coverage-merge.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-vitest-infrastructure-failure.sh "frontend coverage merge"' \
  'scripts/ci/time-command.sh "frontend coverage merge"' \
  "npm run test:coverage:merge -- .vitest-reports"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend coverage shard diagnostics" \
  "full-frontend-coverage-shard-1:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/frontend-coverage-shard-1.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/time-command.sh "frontend coverage shard 1/2"' \
  "npm run test:coverage:shard -- 1 2" \
  "Upload frontend coverage shard 1 diagnostics"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend coverage merge diagnostic upload" \
  "Write frontend coverage merge diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Frontend Coverage Merge"' \
  "Upload frontend coverage merge diagnostics" \
  "ci-diagnostics-frontend-coverage-merge"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend coverage runs on full scan" \
  "full-frontend-coverage-shard-1:" \
  "needs.detect-changes.outputs.full_scan == 'true'" \
  "needs.detect-changes.outputs.test_suite_changed == 'true'" \
  "needs.detect-changes.outputs.frontend_changed == 'true'" \
  "full-frontend-coverage-shard-2:" \
  "needs.detect-changes.outputs.full_scan == 'true'" \
  "needs.detect-changes.outputs.test_suite_changed == 'true'" \
  "needs.detect-changes.outputs.frontend_changed == 'true'" \
  "full-frontend-coverage-merge:" \
  "needs.detect-changes.outputs.full_scan == 'true'" \
  "needs.detect-changes.outputs.test_suite_changed == 'true'" \
  "needs.detect-changes.outputs.frontend_changed == 'true'"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full E2E runs on full scan" \
  "full-browser-e2e-tests:" \
  "needs.detect-changes.outputs.browser_smoke_changed == 'true'" \
  "needs.detect-changes.outputs.full_scan == 'true'" \
  "needs.detect-changes.outputs.test_suite_changed == 'true'" \
  "full-render-e2e-tests:" \
  "needs.detect-changes.outputs.browser_smoke_changed != 'true'" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'" \
  "needs.detect-changes.outputs.render_changed == 'true'" \
  "needs.detect-changes.outputs.full_scan == 'true'" \
  "needs.detect-changes.outputs.test_suite_changed == 'true'"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full summary requires full-scan E2E lanes" \
  'if is_true "$FULL_SCAN"; then' \
  "browser_e2e_required=true" \
  "render_e2e_required=true" \
  'if is_true "$TEST_SUITE_CHANGED"; then' \
  "browser_e2e_required=true" \
  "render_e2e_required=true"

# --- verify-vectors diagnostic coverage --------------------------------------
VV="$REPO_ROOT/.github/workflows/verify-vectors.yml"

assert_contains_in_order "$VV" \
  "verify-vectors wait-for-docker diagnostics" \
  "Wait for Docker" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/wait-for-docker.log"' \
  "scripts/ci/wait-for-docker.sh"

assert_contains_in_order "$VV" \
  "verify-vectors diagnostic summary upload" \
  "SANCTUARY_CI_LOG_SINK_URL" \
  "SANCTUARY_CI_LOG_SINK_TOKEN" \
  "Write vector diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Verify Bitcoin Vectors"' \
  "Upload vector diagnostics" \
  "ci-diagnostics-verify-vectors"

assert_contains_in_order "$VV" \
  "regenerate-vectors diagnostic coverage" \
  "regenerate-vectors:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/regenerate-vectors' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/wait-for-docker.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/generate-address-vectors.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  "npm run generate:repeatable" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/check-address-vector-changes.log"' \
  "Write regenerate vector diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Regenerate Address Vectors"' \
  "Upload regenerate vector diagnostics" \
  "ci-diagnostics-regenerate-vectors"

assert_contains_in_order "$VV" \
  "regenerate-psbt-vectors diagnostic coverage" \
  "regenerate-psbt-vectors:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/regenerate-psbt-vectors' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/wait-for-docker.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/start-bitcoin-core.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/wait-for-bitcoin-core.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/install-server-dependencies.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/install-psbt-dependencies.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/generate-psbt-vectors.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/generate-signed-psbt-vectors.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/verify-generated-psbt-vectors.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/check-psbt-vector-changes.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/check-signed-psbt-vector-changes.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/run-psbt-vector-tests.log"' \
  "Write regenerate PSBT vector diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Regenerate PSBT Vectors"' \
  "Upload regenerate PSBT vector diagnostics" \
  "ci-diagnostics-regenerate-psbt-vectors"

# --- docker-build diagnostic coverage ----------------------------------------
DOCKER_BUILD_WORKFLOW="$REPO_ROOT/.github/workflows/docker-build.yml"

for docker_input in \
  "'public/**'" \
  "'types/**'" \
  "'global.d.ts'" \
  "'metadata.json'" \
  "'gateway/package.json'"; do
  assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
    "docker-build triggers for $docker_input" \
    "$docker_input" \
    2
done

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build image-scope diagnostics" \
  "SANCTUARY_CI_LOG_SINK_URL" \
  "SANCTUARY_CI_LOG_SINK_TOKEN" \
  "detect-image-scope:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/docker-build-detect-image-scope' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/classify-image-scope.log" bash scripts/ci/classify-docker-build-images.sh' \
  "Write image scope diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Docker Build Image Scope"' \
  "Upload image scope diagnostics" \
  "ci-diagnostics-docker-build-detect-image-scope"

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build frontend endpoint resolution" \
  "build-frontend:" \
  "Resolve Docker host" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/wait-for-docker.log"' \
  "scripts/ci/wait-for-docker.sh" \
  "Set up Docker Buildx"

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build backend endpoint resolution" \
  "build-backend:" \
  "Resolve Docker host" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/wait-for-docker.log"' \
  "scripts/ci/wait-for-docker.sh" \
  "Set up Docker Buildx"

# --- quality workflow diagnostic coverage -----------------------------------
QUALITY_WORKFLOW="$REPO_ROOT/.github/workflows/quality.yml"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality workflow sink env" \
  "SANCTUARY_CI_LOG_SINK_URL" \
  "SANCTUARY_CI_LOG_SINK_TOKEN"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality determine-scope diagnostics" \
  "determine-scope:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-determine-scope' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/classify-quality-scope.log"' \
  'scripts/ci/retry-command.sh "classify quality scope"' \
  "scripts/ci/classify-quality-scope.sh" \
  "Write quality scope failure breadcrumb" \
  "write-empty-diagnostic-breadcrumb.sh" \
  "Write quality scope diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Determine Scope"' \
  "ci-diagnostics-quality-determine-scope"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality lint diagnostics" \
  "lint:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-lint' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/lint.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  "scripts/ci/run-quality-lint.sh" \
  "Write lint diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Lint"' \
  "ci-diagnostics-quality-lint"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality lockfile diagnostics" \
  "lockfile-peer-resolution:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-lockfile-peer-resolution' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/lockfile-peer-resolution.log"' \
  "check-lockfile-peer-resolution.sh" \
  "Write lockfile peer diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Lockfile Peer Resolution"' \
  "ci-diagnostics-quality-lockfile-peer-resolution"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality dependency audit diagnostics" \
  "dependency-audit:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-dependency-audit' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/npm-audit.log"' \
  "node scripts/ci/npm-audit-gate.mjs" \
  "Write dependency audit diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Dependency Audit"' \
  "ci-diagnostics-quality-dependency-audit"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality gitleaks diagnostics" \
  "gitleaks:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-gitleaks' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/install-gitleaks.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/gitleaks.log"' \
  "scripts/gitleaks-tracked-tree.sh" \
  "Write gitleaks diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Gitleaks"' \
  "ci-diagnostics-quality-gitleaks"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality semgrep diagnostics" \
  "semgrep-sast:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-semgrep' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/install-semgrep.log"' \
  "scripts/ci/install-semgrep.sh" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/semgrep-baseline.log"' \
  "check-semgrep-baseline.mjs" \
  "Write Semgrep diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Semgrep"' \
  "ci-diagnostics-quality-semgrep"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality workflow lint diagnostics" \
  "workflow-lint:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-workflow-lint' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/install-actionlint-shellcheck.log"' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/actionlint.log"' \
  "/tmp/actionlint -color" \
  "Write workflow lint diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Workflow Lint"' \
  "ci-diagnostics-quality-workflow-lint"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality action runtime diagnostics" \
  "workflow-action-runtime-guard:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-workflow-action-runtime-guard' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/action-runtime-guard.log"' \
  "npm run check:github-action-runtimes" \
  "Write workflow action runtime guard diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Workflow Action Runtime Guard"' \
  "ci-diagnostics-quality-workflow-action-runtime-guard"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality ci-classifier diagnostics" \
  "ci-classifier-tests:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-ci-classifier-tests' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/ci-classifier-tests.log"' \
  "bash tests/ci/measure-wallclock.test.sh" \
  "bash tests/ci/check-workflow-composition.test.sh" \
  "Write CI classifier diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality CI Classifier Tests"' \
  "ci-diagnostics-quality-ci-classifier-tests"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality lizard diagnostics" \
  "lizard:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-lizard' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/lizard.log"' \
  "scripts/quality/lizard-only.sh" \
  "Write lizard diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Lizard"' \
  "ci-diagnostics-quality-lizard"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality jscpd diagnostics" \
  "jscpd:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-jscpd' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/jscpd.log"' \
  'scripts/ci/retry-command.sh "quality jscpd"' \
  "Write jscpd diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality JSCPD"' \
  "ci-diagnostics-quality-jscpd"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality large-file diagnostics" \
  "large-file-classification:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-large-file-classification' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/large-file-classification.log"' \
  "check-large-files.mjs" \
  "Write large-file classification diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Large File Classification"' \
  "ci-diagnostics-quality-large-file-classification"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality required-checks diagnostics" \
  "quality-required-checks:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-required-checks' \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/quality-required-checks.log"' \
  'RUN_REPO_QUALITY=$RUN_REPO_QUALITY' \
  'DETERMINE_SCOPE=$DETERMINE_SCOPE' \
  "Determine Quality Scope" \
  "Secret scan (gitleaks)" \
  "Write quality required checks diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Quality Required Checks"' \
  "ci-diagnostics-quality-required-checks"

assert_jobs_use_node24_runners \
  "$QUALITY_WORKFLOW" \
  "quality jobs select Node 24-capable runners" \
  13

assert_jobs_use_node24_runners \
  "$REPO_ROOT/.github/workflows/test.yml" \
  "test jobs select Node 24-capable runners" \
  32

assert_runner_parser_rejects_post_comment_drift

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
