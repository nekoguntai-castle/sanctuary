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

assert_active_yaml_line_count() {
  local file="$1"
  local label="$2"
  local needle="$3"
  local expected="$4"
  local actual

  actual="$(
    awk -v needle="$needle" '
      {
        trimmed = $0
        sub(/^[[:space:]]*/, "", trimmed)
        sub(/[[:space:]]+$/, "", trimmed)
        if (trimmed == needle) {
          count += 1
        }
      }
      END { print count + 0 }
    ' "$file"
  )"

  if [ "$actual" -eq "$expected" ]; then
    PASS=$((PASS + 1))
    echo "PASS: $label"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: expected $expected active lines for $needle, found $actual")
    echo "FAIL: $label" >&2
  fi
}

extract_named_job_step() {
  local file="$1"
  local job_name="$2"
  local step_name="$3"

  awk -v job="$job_name" -v step="$step_name" '
      {
        trimmed = $0
        sub(/^[[:space:]]*/, "", trimmed)
        first_non_space = match($0, /[^ ]/)
        indent = first_non_space > 0 ? first_non_space - 1 : length($0)
      }
      !in_job && $0 == "  " job ":" {
        in_job = 1
        next
      }
      in_job && $0 ~ /^  [[:alnum:]_-]+:$/ {
        exit
      }
      in_job && !in_step && trimmed == "- name: " step {
        in_step = 1
        step_indent = indent
        print
        next
      }
      in_step && indent == step_indent && trimmed ~ /^- / {
        exit
      }
      in_step {
        print
      }
      END {
        if (!in_job || !in_step) {
          exit 2
        }
      }
    ' "$file"
}

extract_named_job() {
  local file="$1"
  local job_name="$2"

  awk -v job="$job_name" '
      !in_job && $0 == "  " job ":" {
        in_job = 1
      }
      in_job && $0 ~ /^  [[:alnum:]_-]+:$/ && $0 != "  " job ":" {
        exit
      }
      in_job { print }
    ' "$file"
}

assert_named_job_contains() {
  local file="$1"
  local job_name="$2"
  local label="$3"
  local needle="$4"
  local job

  job="$(extract_named_job "$file" "$job_name")"
  if [ -n "$job" ] && printf '%s\n' "$job" | grep -Fq "$needle"; then
    PASS=$((PASS + 1))
    echo "PASS: $label"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: $job_name does not contain: $needle")
    echo "FAIL: $label" >&2
  fi
}

assert_named_job_not_contains() {
  local file="$1"
  local job_name="$2"
  local label="$3"
  local needle="$4"
  local job

  job="$(extract_named_job "$file" "$job_name")"
  if [ -z "$job" ]; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: job not found: $job_name")
    echo "FAIL: $label" >&2
  elif printf '%s\n' "$job" | grep -Fq "$needle"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: $job_name contains forbidden text: $needle")
    echo "FAIL: $label" >&2
  else
    PASS=$((PASS + 1))
    echo "PASS: $label"
  fi
}

assert_named_job_step_contains() {
  local file="$1"
  local job_name="$2"
  local step_name="$3"
  local label="$4"
  local needle="$5"
  local step_body

  if ! step_body="$(extract_named_job_step "$file" "$job_name" "$step_name")"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: could not extract $job_name/$step_name from $file")
    echo "FAIL: $label" >&2
  elif grep -Fq -- "$needle" <<< "$step_body"; then
    PASS=$((PASS + 1))
    echo "PASS: $label"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: expected $job_name/$step_name to contain: $needle")
    echo "FAIL: $label" >&2
  fi
}

assert_named_job_step_not_contains() {
  local file="$1"
  local job_name="$2"
  local step_name="$3"
  local label="$4"
  local needle="$5"
  local step_body

  if ! step_body="$(extract_named_job_step "$file" "$job_name" "$step_name")"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: could not extract $job_name/$step_name from $file")
    echo "FAIL: $label" >&2
  elif grep -Fq -- "$needle" <<< "$step_body"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: forbidden text found in $job_name/$step_name: $needle")
    echo "FAIL: $label" >&2
  else
    PASS=$((PASS + 1))
    echo "PASS: $label"
  fi
}

extract_step_with_mapping() {
  awk '
    {
      trimmed = $0
      sub(/^[[:space:]]*/, "", trimmed)
      first_non_space = match($0, /[^ ]/)
      indent = first_non_space > 0 ? first_non_space - 1 : length($0)
    }
    !in_with && trimmed == "with:" {
      in_with = 1
      with_indent = indent
      next
    }
    in_with && indent <= with_indent {
      exit
    }
    in_with {
      print
    }
    END {
      if (!in_with) {
        exit 2
      }
    }
  '
}

contains_active_yaml_line() {
  local needle="$1"
  awk -v needle="$needle" '
    {
      trimmed = $0
      sub(/^[[:space:]]*/, "", trimmed)
      sub(/[[:space:]]+$/, "", trimmed)
      if (trimmed == needle) {
        found = 1
      }
    }
    END { exit found ? 0 : 1 }
  '
}

named_job_step_has_config() {
  local file="$1"
  local job_name="$2"
  local step_name="$3"
  local action_line="$4"
  shift 4
  local with_lines=("$@")
  local step
  local with_mapping

  [ -f "$file" ] || return 1
  step="$(extract_named_job_step "$file" "$job_name" "$step_name")" || return 1
  printf '%s\n' "$step" | contains_active_yaml_line "$action_line" || return 1
  with_mapping="$(printf '%s\n' "$step" | extract_step_with_mapping)" || return 1

  local line
  for line in "${with_lines[@]}"; do
    printf '%s\n' "$with_mapping" | contains_active_yaml_line "$line" || return 1
  done
}

assert_named_job_step_config() {
  local file="$1"
  local label="$2"
  shift 2

  if named_job_step_has_config "$file" "$@"; then
    PASS=$((PASS + 1))
    echo "PASS: $label"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: expected active action and with configuration not found")
    echo "FAIL: $label" >&2
  fi
}

assert_named_job_step_config_rejected() {
  local file="$1"
  local label="$2"
  shift 2

  if named_job_step_has_config "$file" "$@"; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: invalid fixture unexpectedly satisfied active configuration")
    echo "FAIL: $label" >&2
  else
    PASS=$((PASS + 1))
    echo "PASS: $label"
  fi
}

assert_cache_calls_use_wrapper() {
  local matches

  matches="$(
    git -C "$REPO_ROOT" grep -n 'uses: actions/cache@' -- \
      .github ':(exclude).github/actions/cache/action.yml' || true
  )"
  if [ -z "$matches" ]; then
    PASS=$((PASS + 1))
    echo "PASS: action cache calls use repository wrapper"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("raw actions/cache calls found outside .github/actions/cache/action.yml: $matches")
    echo "FAIL: action cache calls use repository wrapper" >&2
  fi
}

assert_no_unsupported_workflow_permissions() {
  local matches

  matches="$(
    git -C "$REPO_ROOT" grep -nE '^[[:space:]]*permissions:' -- \
      .github/workflows || true
  )"
  if [ -z "$matches" ]; then
    PASS=$((PASS + 1))
    echo "PASS: shared workflows omit unsupported Forgejo permissions"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("unsupported permissions fields found in shared workflows: $matches")
    echo "FAIL: shared workflows omit unsupported Forgejo permissions" >&2
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
PHASE_RUNNER="$REPO_ROOT/scripts/ci/run-e2e-lane-phases.sh"

assert_occurrence_count "$RC" \
  "release-candidate disables restart for CI-created Compose stacks" \
  "SANCTUARY_RESTART_POLICY: 'no'" \
  1

assert_occurrence_count "$RC" \
  "every release-candidate isolated checkout rewrites historical restart policies" \
  "sed -i -E" \
  3

assert_contains_in_order "$RC" \
  "release-candidate fresh-install-test composition" \
  "scripts/ci/run-with-log.sh" \
  "scripts/ci/with-runner-lock.sh e2e" \
  'scripts/ci/time-command.sh "fresh install e2e"' \
  "fresh-install.test.sh"

# container-health and auth-flow no longer compose these steps inline. Both
# lanes now take the e2e lock ONCE and hand the whole stack lifetime to
# run-e2e-lane-phases.sh, because taking the lock per step left a live stack
# unprotected between locked sections (#719). The run-with-log/time-command
# composition still exists, but inside the phase runner, so it is asserted
# there instead.
assert_contains_in_order "$RC" \
  "release-candidate container-health single-lock composition" \
  "scripts/ci/with-runner-lock.sh e2e" \
  "scripts/ci/run-e2e-lane-phases.sh" \
  "container-health" \
  "container-health.test.sh"

assert_contains_in_order "$RC" \
  "release-candidate auth-flow single-lock composition" \
  "scripts/ci/with-runner-lock.sh e2e" \
  "scripts/ci/run-e2e-lane-phases.sh" \
  "auth-flow" \
  "auth-flow.test.sh"

assert_contains_in_order "$PHASE_RUNNER" \
  "phase runner logs each stack phase in order" \
  "start-containers.log" \
  "wait-migration.log" \
  '"${LANE} e2e"'

assert_contains_in_order "$RC" \
  "release-candidate tag-scoped workflow concurrency" \
  "concurrency:" \
  'group: sanctuary-release-candidate-${{ github.ref }}' \
  "cancel-in-progress: false"

assert_contains_in_order "$RC" \
  "release-candidate Docker jobs require the docker-socket capability label" \
  "fresh-install-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "container-health-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "auth-flow-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]"

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
  "release-candidate emits revision-bound hardware compatibility evidence" \
  "hardware-compatibility-evidence:" \
  "npm --workspace shared run build" \
  "npm --workspace server run prisma:generate" \
  "npx --no-install tsx scripts/ci/hardware-compatibility-report.ts" \
  '--revision "$revision"' \
  'name: hardware-compatibility-evidence-${{ github.run_id }}'

assert_contains_in_order "$RC" \
  "release-candidate requires hardware compatibility evidence" \
  "needs: [validation-info, hardware-compatibility-evidence" \
  'needs.hardware-compatibility-evidence.result'

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
  '--project "$project" --verify-empty' \
  "container-health-test:" \
  '--project "$project" --verify-empty' \
  "auth-flow-test:" \
  '--project "$project" --verify-empty'

for rc_job in fresh-install-test container-health-test auth-flow-test; do
  assert_named_job_step_contains "$RC" "$rc_job" "Cleanup" \
    "release-candidate $rc_job uses exact label cleanup" \
    '--project "$project" --verify-empty'
  assert_named_job_step_not_contains "$RC" "$rc_job" "Cleanup" \
    "release-candidate $rc_job has one cleanup owner" \
    'docker compose down'
done

# release-candidate.yml deliberately does not run an upgrade matrix or
# upgrade-full-recovery job — install-test.yml's serialized chain owns
# upgrade coverage on tag pushes. See the "Upgrade coverage note"
# comment block in release-candidate.yml.

# --- install-test.yml -------------------------------------------------------
IT="$REPO_ROOT/.github/workflows/install-test.yml"

assert_occurrence_count "$IT" \
  "install-test disables restart for CI-created Compose stacks" \
  "SANCTUARY_RESTART_POLICY: 'no'" \
  1

# The install unit lane no longer enumerates suites in the workflow -- it calls
# scripts/ci/run-install-unit-tests.sh, which globs tests/install/unit/*.test.sh.
# That is a stronger guarantee than the old per-name assertion: coverage cannot
# drift when a suite is added, and it closes the gap where install-test.yml
# listed fifteen suites while release-candidate.yml listed ten, silently omitting
# the three Grafana/compose ones. Assert the wiring and the glob instead of the
# names.
assert_occurrence_count "$IT" \
  "install unit lane runs the shared suite runner" \
  'scripts/ci/run-install-unit-tests.sh' \
  1

assert_occurrence_count "$REPO_ROOT/.github/workflows/release-candidate.yml" \
  "release-candidate unit lane runs the same shared suite runner" \
  'scripts/ci/run-install-unit-tests.sh' \
  1

assert_contains_in_order "$REPO_ROOT/scripts/ci/run-install-unit-tests.sh" \
  "the suite runner globs every install unit suite" \
  'tests/install/unit/*.test.sh'

assert_contains_in_order "$REPO_ROOT/scripts/ci/run-install-unit-tests.sh" \
  "the suite runner aborts on the first failing suite" \
  'set -euo pipefail'

# Production retains `unless-stopped` by default, while CI can atomically
# override every long-running Sanctuary service to `no`. This prevents an
# interrupted terminal-run stack from being resurrected with the shared DIND
# daemon after a runner restart.
COMPOSE_BASE="$REPO_ROOT/docker-compose.yml"
COMPOSE_MONITORING="$REPO_ROOT/docker/compose/monitoring.yml"
COMPOSE_TOR="$REPO_ROOT/docker/compose/tor.yml"

for compose_file in "$COMPOSE_BASE" "$COMPOSE_MONITORING" "$COMPOSE_TOR"; do
  assert_not_contains "$compose_file" \
    "$(basename "$compose_file") has no fixed unless-stopped restart policy" \
    "restart: unless-stopped"
done

assert_occurrence_count "$COMPOSE_BASE" \
  "base Compose makes every persistent restart policy CI-overridable" \
  'restart: "${SANCTUARY_RESTART_POLICY:-unless-stopped}"' \
  9
assert_occurrence_count "$COMPOSE_MONITORING" \
  "monitoring Compose makes every restart policy CI-overridable" \
  'restart: "${SANCTUARY_RESTART_POLICY:-unless-stopped}"' \
  6
assert_occurrence_count "$COMPOSE_TOR" \
  "Tor Compose makes its restart policy CI-overridable" \
  'restart: "${SANCTUARY_RESTART_POLICY:-unless-stopped}"' \
  2

assert_contains_in_order "$REPO_ROOT/tests/install/e2e/upgrade-install.test.sh" \
  "upgrade source disables historical restart policies before install" \
  'if [ "$UPGRADE_SOURCE_CREATED" = "true" ]; then' \
  'force_test_compose_restart_policy_no "$PROJECT_ROOT"' \
  'run_install_script "$PROJECT_ROOT"'

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

for install_job in fresh-install-test install-stack-smoke container-health-test auth-flow-test; do
  assert_named_job_step_contains "$IT" "$install_job" "Cleanup" \
    "install-test $install_job uses exact label cleanup" \
    '--project "$project" --verify-empty'
  assert_named_job_step_not_contains "$IT" "$install_job" "Cleanup" \
    "install-test $install_job has one cleanup owner" \
    'docker compose down'
done

assert_named_job_step_contains "$IT" "upgrade-baseline-test" "Run baseline upgrades sequentially" \
  "install-test baseline wrapper verifies label cleanup" \
  '--project "$COMPOSE_PROJECT_NAME" --verify-empty'
assert_named_job_step_contains "$IT" "upgrade-baseline-test" "Run baseline upgrades sequentially" \
  "install-test baseline wrapper preserves fixture status through cleanup" \
  'upgrade_finish_with_cleanup "$status" cleanup "$COMPOSE_PROJECT_NAME"'
assert_named_job_step_not_contains "$IT" "upgrade-baseline-test" "Run baseline upgrades sequentially" \
  "install-test baseline wrapper leaves graceful teardown to the test" \
  'docker compose down'

# The baseline and extended-fixture suites do not exchange artifacts or runtime
# state. They must become runnable from the same completed prerequisite set so
# the two docker-socket hosts can execute them concurrently. A host-local e2e
# lock remains the per-runner capacity bound; a shared job-level concurrency
# group would silently restore global serialization on providers that implement
# GitHub job concurrency.
assert_named_job_contains "$IT" "upgrade-baseline-test" \
  "install-test baseline waits for the common upgrade prerequisites" \
  'needs: [determine-scope, fresh-install-test, install-script-test, install-stack-smoke, auth-flow-test]'
assert_named_job_contains "$IT" "upgrade-extended-fixture-test" \
  "install-test extended fixtures wait for the common upgrade prerequisites" \
  'needs: [determine-scope, fresh-install-test, install-script-test, install-stack-smoke, auth-flow-test]'
assert_named_job_not_contains "$IT" "upgrade-extended-fixture-test" \
  "install-test extended fixtures do not wait for baseline" \
  'needs.upgrade-baseline-test'
for parallel_upgrade_job in upgrade-baseline-test upgrade-extended-fixture-test; do
  assert_named_job_not_contains "$IT" "$parallel_upgrade_job" \
    "install-test $parallel_upgrade_job is not globally serialized" \
    'group: sanctuary-runner-e2e'
done
assert_named_job_contains "$IT" "upgrade-extended-test" \
  "install-test extended aggregate still waits for both upgrade suites" \
  'needs: [determine-scope, upgrade-baseline-test, upgrade-extended-fixture-test]'

assert_contains_in_order "$IT" \
  "install-test release-tag workflow concurrency" \
  "concurrency:" \
  "github.event_name == 'pull_request'" \
  "startsWith(github.ref, 'refs/tags/v')" \
  "format('sanctuary-install-release-{0}', github.ref)" \
  "'sanctuary-runner-e2e-workflow'" \
  'cancel-in-progress: ${{ github.event_name == '\''pull_request'\'' }}'

assert_contains_in_order "$IT" \
  "install-test Docker jobs require the docker-socket capability label" \
  "fresh-install-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "install-script-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "install-stack-smoke:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "container-health-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "auth-flow-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "upgrade-baseline-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "upgrade-extended-fixture-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "upgrade-extended-test:" \
  "runs-on: [ubuntu-22.04, docker-socket]" \
  "docker-resource-cleanup:" \
  "runs-on: [ubuntu-22.04, docker-socket]"

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

# Same reason as above: the suites are no longer enumerated here. What still
# matters about ordering is that the unit-tests job invokes the shared runner.
assert_contains_in_order "$IT" \
  "install-test static workflow validation" \
  "unit-tests:" \
  "scripts/ci/run-install-unit-tests.sh"

# The two ci-composition suites install-test has always run alongside the install
# ones are named in the runner, not the workflow -- assert they did not get lost
# in the move.
assert_contains_in_order "$REPO_ROOT/scripts/ci/run-install-unit-tests.sh" \
  "the suite runner still runs the workflow-composition guard" \
  'tests/ci/check-workflow-composition.test.sh'

assert_contains_in_order "$REPO_ROOT/scripts/ci/run-install-unit-tests.sh" \
  "the suite runner still runs the relay diagnosability guard" \
  'tests/ci/relay-job-diagnosability.test.sh'

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
  "Check Docker" \
  'scripts/ci/run-with-log.sh "$JOB_LOG_DIR/check-docker.log"' \
  "scripts/ci/wait-for-docker.sh" \
  "Sweep runner leftovers" \
  "--runner-leftovers" \
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
  "architecture docs-site trigger coverage" \
  "docs/**"

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture docs-site install composition" \
  "Install dependencies (application workspaces and docs site)" \
  'scripts/ci/retry-command.sh "docs-site npm ci"' \
  "npm --prefix docs/site ci" \
  '.npm-cache/docs-site'

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture runtime boundary gate composition" \
  "Enforce runtime architecture boundaries" \
  ".tmp/ci-diagnostics/architecture/runtime-boundaries.log" \
  "npm run check:architecture-boundaries"

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture Prisma boundary gate composition" \
  "Enforce repository-owned Prisma access" \
  ".tmp/ci-diagnostics/architecture/prisma-imports.log" \
  "npm --workspace server run check:prisma-imports"

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture server cycle baseline composition" \
  "Enforce server dependency cycle baseline" \
  ".tmp/ci-diagnostics/architecture/server-cycle-baseline.log" \
  "npm run check:server-cycle-baseline"

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture docs typecheck retry composition" \
  "Typecheck Docusaurus site" \
  "SANCTUARY_RETRY_ATTEMPTS: '5'" \
  "scripts/ci/run-with-log.sh" \
  ".tmp/ci-diagnostics/architecture/docs-typecheck.log" \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "docs typecheck"' \
  'scripts/ci/time-command.sh "docs typecheck"' \
  "npm --prefix docs/site run typecheck"

assert_not_contains "$ARCHITECTURE_WORKFLOW" \
  "architecture workflow retired website path" \
  "website/"

assert_contains_in_order "$ARCHITECTURE_WORKFLOW" \
  "architecture failure bundle stays in the diagnostic artifact" \
  "Collect architecture diagnostics on failure" \
  'diagnostic_dir="$GITHUB_WORKSPACE/.tmp/ci-diagnostics/architecture"' \
  'git diff -- docs/architecture/generated > "$diagnostic_dir/full-diff.txt"' \
  'cp "$source" "$diagnostic_dir/${graph}.regenerated.md"' \
  '"$diagnostic_dir/env.txt"' \
  "Write architecture diagnostic summary" \
  "Upload architecture diagnostics"

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
  "full frontend catch-all typecheck retry composition" \
  "full-frontend-typechecks:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/all-typecheck.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-command.sh "frontend catch-all typecheck"' \
  'scripts/ci/time-command.sh "frontend catch-all typecheck"' \
  "npm run typecheck:all"

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
  "Build shared and gateway production path" \
  "npm --workspace shared run build" \
  "npm --workspace gateway run build" \
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
  "npm run test:e2e -- --project=chromium tests/e2e/render-regression.spec.ts" \
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
  "bash scripts/ci/setup-verifier-test-dependencies.sh" \
  "npx vitest related --config config/tooling/vitest.config.ts --run --passWithNoTests" \
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

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick gateway rejects corrupt exact cache hit" \
  "Restore gateway node_modules cache" \
  "Install dependencies" \
  'cache-quick-gateway-node-modules.outputs.cache-hit' \
  '[ -x node_modules/.bin/vitest ]' \
  'npm ci --strict-allow-scripts'

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
  "npm run test:e2e -- --project=chromium tests/e2e/admin-drafts-smoke.spec.ts"

assert_contains_in_order "$TEST_WORKFLOW" \
  "quick render Playwright infrastructure retry" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "quick render regression"' \
  'scripts/ci/time-command.sh "quick render regression"' \
  "npm run test:e2e -- --project=chromium tests/e2e/render-regression.spec.ts"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full browser Playwright infrastructure retry" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "browser-flow E2E ${browser_group}"' \
  'scripts/ci/time-command.sh "browser-flow E2E ${browser_group}"' \
  'npm run test:e2e -- --project=chromium "${browser_specs[@]}"'

assert_contains_in_order "$TEST_WORKFLOW" \
  "full render Playwright infrastructure retry" \
  'scripts/ci/retry-playwright-infrastructure-failure.sh "render regression E2E"' \
  'scripts/ci/time-command.sh "render regression E2E"' \
  "npm run test:e2e -- --project=chromium tests/e2e/render-regression.spec.ts"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend coverage single-job chain" \
  "full-frontend-coverage-merge:" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/install-verifier-dependencies.log"' \
  "bash scripts/ci/setup-verifier-test-dependencies.sh" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/frontend-coverage-shard-1.log"' \
  'scripts/ci/time-command.sh "frontend coverage shard 1/2"' \
  "npm run test:coverage:shard -- 1 2" \
  "test -s .vitest-reports/blob-1-2.json" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/frontend-coverage-shard-2.log"' \
  'scripts/ci/time-command.sh "frontend coverage shard 2/2"' \
  "npm run test:coverage:shard -- 2 2" \
  "test -s .vitest-reports/blob-2-2.json" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/frontend-coverage-merge.log"' \
  "scripts/ci/with-runner-lock.sh node-toolchain" \
  'scripts/ci/retry-vitest-infrastructure-failure.sh "frontend coverage merge"' \
  'scripts/ci/time-command.sh "frontend coverage merge"' \
  "npm run test:coverage:merge -- .vitest-reports"

assert_occurrence_count "$TEST_WORKFLOW" \
  "every frontend verifier-test lane installs nested dependencies" \
  "bash scripts/ci/setup-verifier-test-dependencies.sh" \
  "2"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend coverage merge diagnostic upload" \
  "Write frontend coverage merge diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Frontend Coverage Merge"' \
  "Upload frontend coverage merge diagnostics" \
  "ci-diagnostics-frontend-coverage-merge"

assert_contains_in_order "$TEST_WORKFLOW" \
  "full frontend coverage runs on full scan" \
  "full-frontend-coverage-merge:" \
  "needs.detect-changes.outputs.full_scan == 'true'" \
  "needs.detect-changes.outputs.test_suite_changed == 'true'" \
  "needs.detect-changes.outputs.frontend_changed == 'true'"

assert_contains_in_order "$TEST_WORKFLOW" \
  "exhaustive PRs skip duplicate quick jobs" \
  "quick-frontend-tests:" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'" \
  "quick-backend-typecheck:" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'" \
  "quick-critical-mutation-shards:" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'" \
  "quick-gateway-tests:" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'" \
  "quick-llm-egress-proxy-tests:" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'" \
  "quick-browser-smoke:" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'" \
  "quick-render-regression:" \
  "needs.detect-changes.outputs.full_scan != 'true'" \
  "needs.detect-changes.outputs.test_suite_changed != 'true'"

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
  "Write vector diagnostic summary" \
  'scripts/ci/write-diagnostic-summary.sh "$DIAGNOSTIC_DIR" "Verify Bitcoin Vectors"' \
  "Upload vector diagnostics" \
  "ci-diagnostics-verify-vectors"

assert_occurrence_count "$VV" \
  "verify-vectors pins the live Bitcoin Core proof image by digest" \
  "bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78" \
  1

assert_named_job_step_contains "$VV" \
  "verify-vectors" \
  "Start isolated pinned Bitcoin Core for live PSBT proof" \
  "live PSBT proof attests the running image ID" \
  'actual_image_id="$(docker inspect'

assert_named_job_step_contains "$VV" \
  "verify-vectors" \
  "Start isolated pinned Bitcoin Core for live PSBT proof" \
  "live PSBT proof resolves the expected pinned image ID" \
  'expected_image_id="$(docker image inspect'

assert_named_job_step_contains "$VV" \
  "verify-vectors" \
  "Start isolated pinned Bitcoin Core for live PSBT proof" \
  "live PSBT proof attests the pulled repository digest" \
  'docker image inspect "$VERIFY_PSBT_CORE_IMAGE"'

assert_named_job_step_contains "$VV" \
  "regenerate-psbt-vectors" \
  "Attest Bitcoin Core image" \
  "manual regeneration attests the running image ID" \
  'actual_image_id="$(docker inspect'

assert_named_job_step_contains "$VV" \
  "regenerate-psbt-vectors" \
  "Attest Bitcoin Core image" \
  "manual regeneration attests the pulled repository digest" \
  'RepoDigests'

assert_named_job_step_contains "$VV" \
  "verify-vectors" \
  "Regenerate and verify live Bitcoin Core PSBT proof" \
  "live PSBT proof regenerates signed vectors" \
  "npm run generate:signed"

assert_named_job_step_contains "$VV" \
  "verify-vectors" \
  "Regenerate and verify live Bitcoin Core PSBT proof" \
  "live PSBT proof rejects deterministic fixture drift" \
  'git -C "$GITHUB_WORKSPACE" diff --exit-code'

assert_named_job_step_contains "$VV" \
  "verify-vectors" \
  "Replay live Bitcoin Core PSBT vectors" \
  "live PSBT proof replays signed vectors" \
  "tests/unit/services/bitcoin/psbt.signed-vectors.test.ts"

assert_named_job_step_contains "$VV" \
  "verify-vectors" \
  "Stop isolated Bitcoin Core" \
  "live PSBT proof cleanup runs unconditionally" \
  "if: always()"

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
  "'src/**'" \
  "'shared/**'" \
  "'gateway/package.json'"; do
  assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
    "docker-build triggers for $docker_input" \
    "$docker_input" \
    2
done

assert_not_contains "$DOCKER_BUILD_WORKFLOW" \
  "docker-build omits retired root public directory trigger" \
  "'public/**'"

for retired_root_input in "'index.html'" "'metadata.json'"; do
  assert_not_contains "$DOCKER_BUILD_WORKFLOW" \
    "docker-build omits retired root input $retired_root_input" \
    "$retired_root_input"
done

assert_not_contains "$TEST_WORKFLOW" \
  "test workflow omits retired root HTML entry trigger" \
  "'index.html'"

assert_not_contains "$TEST_WORKFLOW" \
  "test workflow omits retired root browser E2E trigger" \
  "'e2e/**'"

assert_not_contains "$DOCKER_BUILD_WORKFLOW" \
  "docker-build omits retired root frontend Dockerfile trigger" \
  "'Dockerfile'"

assert_not_contains "$REPO_ROOT/.github/workflows/install-test.yml" \
  "install-test omits retired root frontend Dockerfile trigger" \
  "'Dockerfile'"

assert_occurrence_count "$TEST_WORKFLOW" \
  "test workflow uses canonical frontend Dockerfile trigger" \
  "'docker/frontend/Dockerfile'" \
  1

for retired_frontend_input in \
  "'App.tsx'" \
  "'index.tsx'" \
  "'global.d.ts'" \
  "'components/**'" \
  "'contexts/**'" \
  "'hooks/**'" \
  "'providers/**'" \
  "'services/**'" \
  "'themes/**'" \
  "'types/**'" \
  "'utils/**'"; do
  assert_not_contains "$DOCKER_BUILD_WORKFLOW" \
    "docker-build omits retired frontend input $retired_frontend_input" \
    "$retired_frontend_input"
done

assert_contains_in_order "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "verify-vectors broad funds-safety triggers" \
  "pull_request:" \
  "merge_group:" \
  "types: [checks_requested]" \
  "push:" \
  "branches: [main]"

assert_not_contains "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "verify-vectors has no path-filter blind spots" \
  "paths:"

assert_contains_in_order "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "verify-vectors executes hardware truthfulness contracts" \
  "Run pinned Jade vendor protocol harness" \
  "npm run test:jade-protocol-harness" \
  "Run hardware capability truthfulness tests" \
  "tests/unit/services/bitcoin/hardwareWalletCompatibility.test.ts" \
  "tests/unit/services/hardwareWalletCapabilities.test.ts" \
  "Replay hardware-signed fixture contracts" \
  "tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts" \
  "Run pinned Trezor emulator proof" \
  "npm run test:trezor-emulator-proof" \
  "Run pinned Ledger emulator proof" \
  "npm run test:ledger-emulator-proof" \
  "Run pinned Jade QEMU proof" \
  "npm run test:jade-emulator-proof"

assert_named_job_step_contains "$VV" \
  "verify-jade-emulator" \
  "Run pinned Jade QEMU proof" \
  "Jade QEMU proof uses its dedicated measured lock" \
  "timeout-minutes: 55" \
  'SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS="$JADE_EMULATOR_LOCK_TIMEOUT_SECONDS"' \
  "scripts/ci/with-runner-lock.sh jade-emulator"

assert_named_job_step_contains "$VV" \
  "verify-jade-emulator" \
  "Upload current Jade QEMU proof" \
  "Jade QEMU proof uploads only the successful current attempt" \
  "if: success() && env.JADE_EMULATOR_PROOF_DIR != ''" \
  '${{ env.JADE_EMULATOR_PROOF_DIR }}' \
  "if-no-files-found: error"

assert_named_job_step_contains "$VV" \
  "verify-jade-emulator" \
  "Upload current Jade QEMU diagnostics" \
  "Jade QEMU diagnostics are separate and attempt-scoped" \
  "if: always() && env.JADE_EMULATOR_DIAGNOSTICS_DIR != ''" \
  '${{ env.JADE_EMULATOR_DIAGNOSTICS_DIR }}' \
  "if-no-files-found: error"

assert_named_job_step_contains "$VV" \
  "verify-trezor-emulator" \
  "Run pinned Trezor emulator proof" \
  "Trezor emulator proof uses its dedicated measured lock" \
  "timeout-minutes: 40" \
  'SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS="$TREZOR_EMULATOR_LOCK_TIMEOUT_SECONDS"' \
  "scripts/ci/with-runner-lock.sh trezor-emulator"

assert_named_job_contains "$VV" \
  "verify-trezor-emulator" \
  "Trezor proof avoids the known wedged Kumo runner" \
  "runs-on: [docker-socket, playwright-x300-canary]" \
  "needs: [verify-vectors]"

assert_named_job_step_contains "$VV" \
  "verify-trezor-emulator" \
  "Run pinned Trezor emulator proof" \
  "Trezor emulator proof is captured in diagnostics" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/trezor-emulator-proof.log"'

assert_named_job_step_contains "$VV" \
  "verify-trezor-emulator" \
  "Upload current Trezor emulator proof" \
  "Trezor emulator proof uploads only the successful current attempt" \
  "if: success() && env.TREZOR_EMULATOR_PROOF_DIR != ''" \
  '${{ env.TREZOR_EMULATOR_PROOF_DIR }}' \
  "if-no-files-found: error"

assert_named_job_step_contains "$VV" \
  "verify-ledger-emulator" \
  "Run pinned Ledger emulator proof" \
  "Ledger emulator proof uses its dedicated measured lock" \
  "timeout-minutes: 10" \
  'SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS="$LEDGER_EMULATOR_LOCK_TIMEOUT_SECONDS"' \
  "scripts/ci/with-runner-lock.sh ledger-emulator"

assert_named_job_step_contains "$VV" \
  "verify-ledger-emulator" \
  "Upload current Ledger emulator proof" \
  "Ledger emulator proof uploads only the successful current attempt" \
  "if: success() && env.LEDGER_EMULATOR_PROOF_DIR != ''" \
  '${{ env.LEDGER_EMULATOR_PROOF_DIR }}' \
  "if-no-files-found: error"

assert_named_job_step_contains "$VV" \
  "verify-ledger-emulator" \
  "Upload current Ledger emulator diagnostics" \
  "Ledger emulator diagnostics are separate and attempt-scoped" \
  "if: always() && env.LEDGER_EMULATOR_DIAGNOSTICS_DIR != ''" \
  '${{ env.LEDGER_EMULATOR_DIAGNOSTICS_DIR }}' \
  "if-no-files-found: error"

assert_named_job_step_contains "$VV" \
  "verify-trezor-emulator" \
  "Upload current Trezor emulator diagnostics" \
  "Trezor emulator diagnostics are separate and attempt-scoped" \
  "if: always() && env.TREZOR_EMULATOR_DIAGNOSTICS_DIR != ''" \
  '${{ env.TREZOR_EMULATOR_DIAGNOSTICS_DIR }}' \
  "if-no-files-found: error"

assert_contains_in_order "$VV" \
  "vector summary requires software, Trezor, Ledger, and Jade proofs" \
  "summary:" \
  "needs: [verify-vectors, verify-trezor-emulator, verify-ledger-emulator, verify-jade-emulator]" \
  '${{ needs.verify-vectors.result }}' \
  '${{ needs.verify-trezor-emulator.result }}' \
  '${{ needs.verify-ledger-emulator.result }}' \
  '${{ needs.verify-jade-emulator.result }}'

assert_contains_in_order "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "Trezor emulator lock has a dedicated measured timeout" \
  "TREZOR_EMULATOR_LOCK_TIMEOUT_SECONDS: '600'"

assert_contains_in_order "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "Ledger emulator lock has a dedicated measured timeout" \
  "LEDGER_EMULATOR_LOCK_TIMEOUT_SECONDS: '300'"

assert_contains_in_order "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "Trezor emulator public binding remains disabled" \
  "SANCTUARY_TREZOR_ALLOW_PUBLIC_BIND: '0'"

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build image-scope diagnostics" \
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
  "docker-build frontend runnable evidence" \
  "build-frontend:" \
  "Build, smoke, and attest frontend" \
  'scripts/ci/build-runtime-image.sh frontend docker/frontend/Dockerfile . sanctuary-ci/frontend:${{ github.sha }}' \
  "Upload frontend image evidence" \
  "runtime-image-evidence-frontend"

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build backend endpoint resolution" \
  "build-backend:" \
  "Resolve Docker host" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/wait-for-docker.log"' \
  "scripts/ci/wait-for-docker.sh" \
  "Set up Docker Buildx"

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build backend runnable evidence" \
  "build-backend:" \
  "Build, smoke, and attest backend" \
  'scripts/ci/build-runtime-image.sh backend server/Dockerfile . sanctuary-ci/backend:${{ github.sha }}' \
  "Upload backend image evidence" \
  "runtime-image-evidence-backend"

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build all five shipped images emit evidence" \
  "build-gateway:" \
  "runtime-image-evidence-gateway" \
  "build-llm-egress-proxy:" \
  "runtime-image-evidence-llm-egress-proxy" \
  "build-grafana-migration:" \
  "runtime-image-evidence-grafana-migration"

assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
  "docker-build summary hard-fails invalid scope and results" \
  'DETECT_RESULT: ${{ needs.detect-image-scope.result }}' \
  'GRAFANA_MIGRATION_REQUESTED: ${{ needs.detect-image-scope.outputs.grafana_migration_image }}' \
  'scripts/ci/validate-docker-build-results.sh' \
  '"$FRONTEND_REQUESTED" "$FRONTEND_RESULT"' \
  '"$BACKEND_REQUESTED" "$BACKEND_RESULT"' \
  '"$GRAFANA_MIGRATION_REQUESTED" "$GRAFANA_MIGRATION_RESULT"'

assert_named_job_step_contains "$DOCKER_BUILD_WORKFLOW" \
  "summary" \
  "Checkout repository" \
  "docker-build summary checks out its executable validator" \
  "uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd"

assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
  "docker-build runtime evidence invocation count" \
  "run: scripts/ci/build-runtime-image.sh " \
  5

for docker_timeout_contract in \
  "detect-image-scope:|timeout-minutes: 10" \
  "build-frontend:|timeout-minutes: 45" \
  "build-backend:|timeout-minutes: 45" \
  "build-gateway:|timeout-minutes: 30" \
  "build-llm-egress-proxy:|timeout-minutes: 30" \
  "build-grafana-migration:|timeout-minutes: 30" \
  "summary:|timeout-minutes: 10"; do
  IFS='|' read -r docker_job docker_timeout <<< "$docker_timeout_contract"
  assert_contains_in_order "$DOCKER_BUILD_WORKFLOW" \
    "docker-build ${docker_job%:} job has a bounded runtime" \
    "$docker_job" \
    "$docker_timeout"
done

assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
  "every docker-build job has a timeout" \
  "timeout-minutes:" \
  7
assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
  "docker-build classifier and summary use short timeouts" \
  "timeout-minutes: 10" \
  2
assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
  "docker-build small images use medium timeouts" \
  "timeout-minutes: 30" \
  3
assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
  "docker-build application images use long timeouts" \
  "timeout-minutes: 45" \
  2

for grafana_image_path in \
  "'scripts/ops/migrate-grafana-password.sh'" \
  "'scripts/ops/run-grafana-password-migration.sh'" \
  "'scripts/ops/grafana-quiescence-records.sh'" \
  "'scripts/offline/bundle-common.sh'" \
  "'scripts/offline/create-bundle.sh'"; do
  assert_occurrence_count "$DOCKER_BUILD_WORKFLOW" \
    "docker-build triggers for $grafana_image_path" \
    "$grafana_image_path" \
    2
done

for grafana_owned_path in \
  "'start.sh'" \
  "'scripts/ops/migrate-grafana-password.sh'" \
  "'scripts/ops/run-grafana-password-migration.sh'" \
  "'scripts/ops/grafana-quiescence-records.sh'" \
  "'scripts/offline/**'"; do
  assert_occurrence_count "$REPO_ROOT/.github/workflows/install-test.yml" \
    "install-test triggers for $grafana_owned_path" \
    "$grafana_owned_path" \
    2
done

assert_not_contains "$DOCKER_BUILD_WORKFLOW" \
  "docker-build validation does not load images" \
  "load: true"

assert_not_contains "$DOCKER_BUILD_WORKFLOW" \
  "docker-build validation does not push images" \
  "push: true"

assert_named_job_step_config_rejected \
  "$REPO_ROOT/tests/ci/fixtures/docker-build-swapped-steps.yml" \
  "docker-build step assertions reject cross-job matches" \
  "build-frontend" \
  "Build frontend" \
  "uses: docker/build-push-action@bcafcacb16a39f128d818304e6c9c0c18556b85f" \
  "push: false" \
  "outputs: type=cacheonly"

assert_named_job_step_config_rejected \
  "$REPO_ROOT/tests/ci/fixtures/docker-build-swapped-steps.yml" \
  "docker-build step assertions reject non-with and sibling matches" \
  "build-backend" \
  "Build frontend" \
  "uses: docker/build-push-action@bcafcacb16a39f128d818304e6c9c0c18556b85f" \
  "push: false" \
  "outputs: type=cacheonly" \
  "cache-from: type=gha,scope=frontend" \
  "cache-to: type=gha,mode=max,scope=frontend,ignore-error=true"

# --- quality workflow diagnostic coverage -----------------------------------
QUALITY_WORKFLOW="$REPO_ROOT/.github/workflows/quality.yml"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality runs on direct main pushes" \
  "on:" \
  "push:" \
  "branches:" \
  "- main" \
  "pull_request:"

assert_contains_in_order "$REPO_ROOT/config/tooling/eslint.config.js" \
  "LLM egress proxy production source receives the TypeScript lint policy" \
  "const productionSource" \
  "llm-egress-proxy/src/**/*.ts"

assert_contains_in_order "$REPO_ROOT/package.json" \
  "root lint includes the LLM egress proxy" \
  '"lint":' \
  "npm run lint:gateway" \
  "npm run lint:llm-egress-proxy" \
  "npm run check:blocking-io"

assert_contains_in_order "$REPO_ROOT/package.json" \
  "full local coverage includes gateway and LLM egress proxy" \
  '"test:coverage:full":' \
  "npm run test:coverage:gateway" \
  "npm run test:coverage:llm-egress-proxy"

for node_workflow in architecture quality release-candidate test; do
  assert_contains_in_order \
    "$REPO_ROOT/.github/workflows/${node_workflow}.yml" \
    "${node_workflow} pins an allowScripts-capable npm" \
    "NODE_VERSION: '24.19.0'" \
    "NPM_VERSION: '11.19.0'"
done

assert_contains_in_order \
  "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "verify-vectors pins its funds-safety Node and npm runtime exactly" \
  "NODE_VERSION: '24.19.0'" \
  "NPM_VERSION: '11.19.0'" \
  "uses: ./.github/actions/setup-node-toolchain" \
  "install-npm: 'false'"
assert_occurrence_count \
  "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "verify-vectors jobs use the immutable checksum-built wallet verifier image" \
  "nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-go@sha256:8b50f6c8ccb016b042c7125a637b068a49c856a76e543365044b36a593edd81e" 5
assert_occurrence_count \
  "$REPO_ROOT/.github/workflows/verify-vectors.yml" \
  "verify-vectors jobs disable network npm repair" \
  "install-npm: 'false'" 5

GO_RUNNER_DOCKERFILE="$REPO_ROOT/scripts/ci/images/go-runner.Dockerfile"
assert_occurrence_count "$GO_RUNNER_DOCKERFILE" \
  "wallet verifier runner pins Node exactly" \
  "ARG NODE_VERSION=24.19.0" 1
assert_occurrence_count "$GO_RUNNER_DOCKERFILE" \
  "wallet verifier runner pins the official Node archive checksum" \
  "ARG NODE_SHA256=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647" 1
assert_occurrence_count "$GO_RUNNER_DOCKERFILE" \
  "wallet verifier runner verifies the Node archive checksum" \
  'echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c -' 1
assert_occurrence_count "$GO_RUNNER_DOCKERFILE" \
  "wallet verifier runner installs exact npm" \
  'npm install --global --audit=false --fund=false /tmp/npm.tgz' 1
assert_occurrence_count "$GO_RUNNER_DOCKERFILE" \
  "wallet verifier runner pins the npm tarball checksum" \
  "ARG NPM_SHA512=48377f8478372aa1c4e47b763475b135836da82436a5700f2e5e8eb5084fc840f93c7b117eb3ad3b5f7d3194c81b6710a10d59448f6ddbcb21ac3fb672bdc003" 1
assert_occurrence_count "$GO_RUNNER_DOCKERFILE" \
  "wallet verifier runner verifies the npm tarball checksum" \
  'echo "${NPM_SHA512}  /tmp/npm.tgz" | sha512sum -c -' 1

declare -A strict_install_counts=(
  [architecture.yml]=2
  [quality.yml]=1
  [test.yml]=15
  [verify-vectors.yml]=8
)
for workflow in "${!strict_install_counts[@]}"; do
  assert_occurrence_count \
    "$REPO_ROOT/.github/workflows/$workflow" \
    "$workflow makes every npm ci fail closed on unknown lifecycle scripts" \
    "--strict-allow-scripts" \
    "${strict_install_counts[$workflow]}"
done

npm_ci_sources=(
  "$REPO_ROOT/.github/workflows/architecture.yml"
  "$REPO_ROOT/.github/workflows/quality.yml"
  "$REPO_ROOT/.github/workflows/test.yml"
  "$REPO_ROOT/.github/workflows/verify-vectors.yml"
  "$REPO_ROOT/docker/frontend/Dockerfile"
  "$REPO_ROOT/gateway/Dockerfile"
  "$REPO_ROOT/server/Dockerfile"
  "$REPO_ROOT/llm-egress-proxy/Dockerfile"
  "$REPO_ROOT/scripts/ci/setup-server-dependencies.sh"
  "$REPO_ROOT/scripts/ci/run-quality-lint.sh"
  "$REPO_ROOT/scripts/verify-addresses/verify-repeatable.sh"
)
unprotected_npm_ci=()
while IFS=: read -r file line content; do
  trimmed="${content#"${content%%[![:space:]]*}"}"
  [[ "$trimmed" == \#* ]] && continue
  command_content="$(sed -E 's/"[^"]*npm ci[^"]*"//g' <<<"$content")"
  if ! grep -Eq "npm( --prefix (\"[^\"]+\"|'[^']+'|[^ ]+))? ci" <<<"$command_content"; then
    continue
  fi
  [[ "$content" == *"--strict-allow-scripts"* || "$content" == *"--ignore-scripts"* ]] && continue
  unprotected_npm_ci+=("$file:$line:$content")
# grep, not rg: ripgrep is not installed in the CI job container, and its
# absence made this check silently vacuous (no matches -> "PASS") while emitting
# "rg: command not found" and failing the job. grep -nE emits the same
# file:line:content shape for a multi-file argument list.
done < <(grep -nE 'npm( --prefix [^ ]+)? ci' "${npm_ci_sources[@]}")

if [ "${#unprotected_npm_ci[@]}" -eq 0 ]; then
  PASS=$((PASS + 1))
  echo "PASS: every executable npm ci is strict or lifecycle-disabled"
else
  FAIL=$((FAIL + 1))
  FAILURES+=("unprotected npm ci callsites: ${unprotected_npm_ci[*]}")
  echo "FAIL: every executable npm ci is strict or lifecycle-disabled" >&2
fi

assert_contains_in_order \
  "$REPO_ROOT/.github/actions/setup-node-toolchain/action.yml" \
  "Node toolchain bootstraps and verifies locked Node/npm" \
  'scripts/ci/bootstrap-node.sh' \
  'scripts/ci/ensure-node.sh'

assert_contains_in_order \
  "$REPO_ROOT/scripts/ci/bootstrap-node.sh" \
  "Node bootstrap checksum-verifies npm before installation" \
  'sha512sum --check --status' \
  'install --global --audit=false --fund=false "$archive"'

assert_occurrence_count \
  "$REPO_ROOT/scripts/ci/bootstrap-node.sh" \
  "Node bootstrap reads the reviewed npm artifact URL" \
  'artifacts.npm.url' \
  1

for dockerfile in docker/frontend/Dockerfile gateway/Dockerfile; do
  assert_contains_in_order \
    "$REPO_ROOT/$dockerfile" \
    "$dockerfile pins an allowScripts-capable npm" \
    "FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS node-toolchain" \
    "ARG NPM_VERSION=11.19.0" \
    'npm install --global --audit=false --fund=false "npm@$NPM_VERSION"' \
    "FROM node-toolchain AS deps" \
    "FROM node-toolchain AS builder"
done

assert_contains_in_order \
  "$REPO_ROOT/server/Dockerfile" \
  "server/Dockerfile pins an allowScripts-capable npm on a digest-locked Node base" \
  "FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS node-toolchain" \
  "ARG NPM_VERSION=11.19.0" \
  'npm install --global --audit=false --fund=false "npm@$NPM_VERSION"' \
  "FROM node-toolchain AS deps" \
  "FROM node-toolchain AS builder"

for install_path in \
  docker/frontend/Dockerfile \
  server/Dockerfile \
  gateway/Dockerfile \
  llm-egress-proxy/Dockerfile \
  scripts/ci/setup-server-dependencies.sh \
  scripts/ci/run-quality-lint.sh; do
  assert_occurrence_count \
    "$REPO_ROOT/$install_path" \
    "$install_path makes npm ci fail closed on unknown lifecycle scripts" \
    "--strict-allow-scripts" \
    1
done

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality frontend Compose contract" \
  "Run CI classifier tests" \
  "node tests/ci/check-npm-install-scripts.test.mjs" \
  "node tests/ci/check-root-layout.test.mjs" \
  "node tests/ci/docker-compose-test-contract.test.mjs" \
  "node tests/ci/provider-context-node.test.mjs"

assert_contains_in_order "$QUALITY_WORKFLOW" \
  "quality determine-scope diagnostics" \
  "determine-scope:" \
  'DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/quality-determine-scope' \
  "Verify Node.js toolchain" \
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/root-layout-classification.log"' \
  "scripts/quality/check-root-layout.mjs" \
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
  'scripts/ci/run-with-log.sh "$DIAGNOSTIC_DIR/npm-deprecations.log"' \
  'source "$source_workspace/scripts/ci/redactor.sh"' \
  "npm ci --strict-allow-scripts --ignore-scripts --audit=false --fund=false" \
  'redact_file "$install_log" "$DIAGNOSTIC_DIR/npm-deprecation-install.log"' \
  "node scripts/ci/check-npm-install-scripts.mjs --verify-installed" \
  "node scripts/ci/check-npm-deprecations.mjs" \
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
  14

assert_jobs_use_node24_runners \
  "$REPO_ROOT/.github/workflows/test.yml" \
  "test jobs select Node 24-capable runners" \
  30

assert_runner_parser_rejects_post_comment_drift
assert_cache_calls_use_wrapper
assert_no_unsupported_workflow_permissions

for workflow_path in \
  "$REPO_ROOT"/.github/workflows/*.yml \
  "$REPO_ROOT"/.github/workflows/*.yaml; do
  [ -e "$workflow_path" ] || continue
  workflow="${workflow_path##*/}"
  assert_occurrence_count \
    "$workflow_path" \
    "$workflow configures Git's initial branch once" \
    "GIT_CONFIG_KEY_0: init.defaultBranch" \
    1
  assert_not_contains \
    "$workflow_path" \
    "$workflow no longer wires the retired LAN log sink" \
    "SANCTUARY_CI_LOG_SINK_"
  assert_not_contains \
    "$workflow_path" \
    "$workflow no longer calls the retired LAN log publisher" \
    "publish-failed-logs.sh"
done

# --- summary ----------------------------------------------------------------
echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
# ------------------------------------------------------- interpreter-fed blocks
# A multi-command script piped into a bare `bash` on stdin cannot fail: bash
# reading from stdin without -e does not abort on a failing command, so the
# step's exit status is only the LAST command's.
#
# install-test.yml did exactly that with fifteen test scripts, so fourteen of
# them were structurally unable to fail CI. PR #832 shipped a broken
# classify-install-scope.sh green because install-scope.test.sh ran at position
# 11, failed, and was discarded -- and that bug then cost v0.8.64 four extra
# release candidates.
#
# This guard is deliberately in the same commit as the fix. It is itself one of
# the fifteen suites that could not fail, so shipping it earlier would have
# landed it blind.
#
# A heredoc is acceptable when the interpreter carries -e, or the body sets it,
# or the line explicitly ends in `|| true` (the four container-log dumps are
# deliberately tolerant).
check_interpreter_heredocs() {
  local label="no workflow pipes an unguarded multi-command script into bash"
  local offenders=""
  local wf line lineno interp term body guarded

  for wf in "$REPO_ROOT"/.github/workflows/*.yml; do
    [ -f "$wf" ] || continue
    lineno=0
    while IFS= read -r line; do
      lineno=$((lineno + 1))
      case "$line" in
        *"bash <<'"*|*"sh <<'"*|*'bash <<"'*) ;;
        *) continue ;;
      esac
      case "$line" in *"|| true") continue ;; esac
      term="$(printf '%s
' "$line" | sed -E "s/.*<<'?([A-Za-z_][A-Za-z0-9_]*)'?.*/\1/")"
      [ -n "$term" ] || continue
      body="$(awk -v start="$lineno" -v term="$term" \
        'NR > start { if ($0 ~ "^[[:space:]]*"term"[[:space:]]*$") exit; print }' "$wf")"
      guarded=no
      printf '%s
' "$body" | grep -Eq '^[[:space:]]*set -[a-z]*e' && guarded=yes
      [ "$guarded" = yes ] || offenders="${offenders} $(basename "$wf"):${lineno}"
    done < "$wf"
  done

  if [ -n "$offenders" ]; then
    FAIL=$((FAIL + 1))
    FAILURES+=("$label: unguarded heredoc(s):${offenders}")
    echo "FAIL: $label" >&2
  else
    PASS=$((PASS + 1))
    echo "PASS: $label"
  fi
}

check_interpreter_heredocs

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do
    echo "  - $f" >&2
  done
  exit 1
fi
