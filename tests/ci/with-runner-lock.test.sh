#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_SCRIPT="$ROOT_DIR/scripts/ci/with-runner-lock.sh"
WORKFLOW_DIR="$ROOT_DIR/.github/workflows"
TEST_TEMP_DIR=''

# Exit status the lock script reserves for "waited the full timeout and never
# acquired the lock". Must match LOCK_CONFLICT_EXIT_CODE in the script.
LOCK_CONFLICT_EXIT_CODE=75

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  grep -Fq "$expected" "$output_file" || fail "expected output to contain: ${expected}"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$LOCK_SCRIPT"

  assert_fails_with 'expected a lock name and command' bash "$LOCK_SCRIPT"
  assert_fails_with 'lock name may contain only' bash "$LOCK_SCRIPT" '../bad' true
  assert_fails_with 'must be a positive integer' env SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS=0 bash "$LOCK_SCRIPT" test true

  local lock_dir="$TEST_TEMP_DIR/locks"
  local marker="$TEST_TEMP_DIR/marker"
  SANCTUARY_RUNNER_LOCK_DIR="$lock_dir" bash "$LOCK_SCRIPT" test-lock bash -c "printf ok > '$marker'"

  [ -f "$marker" ] || fail 'expected command to run under lock'
  [ "$(cat "$marker")" = 'ok' ] || fail 'expected locked command output marker'
  [ -f "$lock_dir/test-lock.lock" ] || fail 'expected lock file to be created'
  [ "$(stat -c '%a' "$lock_dir")" = '1777' ] || fail 'expected lock directory to be sticky and cross-user writable'
  [ "$(stat -c '%a' "$lock_dir/test-lock.lock")" = '666' ] || fail 'expected lock file to be cross-user writable'

  if SANCTUARY_RUNNER_LOCK_DIR="$lock_dir" bash "$LOCK_SCRIPT" test-lock bash -c 'exit 42'; then
    fail 'expected locked command failure to propagate'
  else
    status="$?"
    [ "$status" -eq 42 ] || fail "expected exit status 42, got ${status}"
  fi

  assert_contended_lock_reports_timeout "$lock_dir"
  assert_lock_timeout_fits_inside_every_job
  assert_lock_reports_wait_duration

  echo 'runner lock regression checks passed'
}

# Serialisation has to be measurable before anyone can argue about removing it.
#
# The script printed "Waiting for runner lock: <name>" *before* attempting flock,
# so the line read identically whether the lock was free or held for an hour. No
# log anywhere could say whether serialising the e2e lanes costs anything, which
# is precisely the question gating sanctuary#664.
assert_lock_reports_wait_duration() {
  local dir="$TEST_TEMP_DIR/wait-locks"
  mkdir -p "$dir"

  # Uncontended: acquired immediately, and no contention annotation.
  local free_out
  free_out="$(SANCTUARY_RUNNER_LOCK_DIR="$dir" bash "$LOCK_SCRIPT" freelock true 2>&1)"
  printf '%s' "$free_out" | grep -q 'runner-lock: acquired freelock after 0s' \
    || fail "expected an immediate acquisition to report 0s, got: ${free_out}"
  printf '%s' "$free_out" | grep -q 'Runner lock contention' \
    && fail 'an uncontended lock must not report contention'
  printf '%s' "$free_out" | grep -q 'runner-lock: released freelock held .*status=0' \
    || fail "expected a release line with status, got: ${free_out}"

  # Contended: a second caller must report the wait, not just that it waited.
  ( SANCTUARY_RUNNER_LOCK_DIR="$dir" bash "$LOCK_SCRIPT" busylock sleep 3 >/dev/null 2>&1 ) &
  local holder=$!
  sleep 1

  local busy_out
  busy_out="$(SANCTUARY_RUNNER_LOCK_DIR="$dir" bash "$LOCK_SCRIPT" busylock true 2>&1)"
  wait "$holder" 2>/dev/null || true

  local waited
  waited="$(printf '%s' "$busy_out" | sed -n 's/.*runner-lock: acquired busylock after \([0-9]*\)s.*/\1/p')"
  [ -n "$waited" ] || fail "expected an acquisition line under contention, got: ${busy_out}"
  [ "$waited" -ge 1 ] || fail "expected a non-zero wait under contention, got ${waited}s"
  printf '%s' "$busy_out" | grep -q 'Runner lock contention' \
    || fail "expected a contention annotation, got: ${busy_out}"
}

# A lock that never becomes available must say so, and with a status the caller
# can tell apart from a failing child. Silent contention is why sanctuary#699's
# verify-vectors failure stayed undiagnosable -- see the rationale in
# scripts/ci/with-runner-lock.sh.
assert_contended_lock_reports_timeout() {
  local lock_dir="$1"
  local lock_file="$lock_dir/held.lock"
  local output_file="$TEST_TEMP_DIR/contended-output"

  mkdir -p "$lock_dir"
  touch "$lock_file"

  # Hold the lock in this shell rather than a background process on a timer.
  # A sleeping holder can be outlasted by a slow runner, which would let the
  # contender acquire and turn a real regression into a confusing failure;
  # holding it here bounds the contention by the assertion itself. flock(2)
  # conflicts between distinct open file descriptions, so the child blocks even
  # though it opens the same path -- and 9>&- closes the inherited descriptor so
  # only its own counts.
  exec 9>"$lock_file"
  flock -n 9 || fail 'test harness could not take the lock it is about to contend'

  local status=0
  SANCTUARY_RUNNER_LOCK_DIR="$lock_dir" \
    SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS=1 \
    bash "$LOCK_SCRIPT" held true >"$output_file" 2>&1 9>&- || status="$?"

  exec 9>&-

  [ "$status" -ne 0 ] || fail 'expected a contended lock wait to fail'
  [ "$status" -eq "$LOCK_CONFLICT_EXIT_CODE" ] ||
    fail "expected lock-conflict exit ${LOCK_CONFLICT_EXIT_CODE}, got ${status}"
  grep -Fq 'timed out after 1s waiting for runner lock: held' "$output_file" ||
    fail "expected an explicit lock timeout message, got: $(cat "$output_file")"
}

# The lock wait must expire inside the job that contains it. If it can outlive
# the job, a contended lock can only ever end as a job-level timeout -- which
# cancels the `if: always()` diagnostics upload and destroys the evidence naming
# the cause. The historical default was 3600s against job timeouts as low as 15
# minutes. Checked for every lock-using job against its *effective* timeout, so
# an explicit per-job override cannot reintroduce the bug either.
assert_lock_timeout_fits_inside_every_job() {
  local default_timeout
  default_timeout="$(
    SANCTUARY_RUNNER_LOCK_DIR="$TEST_TEMP_DIR/introspect" \
      bash "$LOCK_SCRIPT" --print-default-timeout
  )" || fail 'expected --print-default-timeout to succeed'

  [[ "$default_timeout" =~ ^[1-9][0-9]*$ ]] ||
    fail "expected a positive integer default timeout, got: ${default_timeout}"

  local seen=0 checked=0 saw_verify_vectors=0
  local label bound effective declared
  while IFS='|' read -r label bound effective declared; do
    [ -n "$bound" ] || continue
    seen=$((seen + 1))

    # Only jobs that declare their own budget are held to the rule. The shared
    # default is deliberately long for the `e2e` lock (see with-runner-lock.sh),
    # so the remaining jobs are known debt, not a contract this test can assert.
    [ "$declared" = 'yes' ] || continue
    checked=$((checked + 1))
    [ "${label#verify-vectors.yml:verify-vectors}" = "$label" ] || saw_verify_vectors=1

    if [ "$effective" -ge "$bound" ]; then
      fail "${label}: lock wait can reach ${effective}s but the enclosing step/job is capped at ${bound}s; the cap fires first, so the contention is never reported, and a job-level cap also discards the diagnostics artifact"
    fi
  done < <(lock_using_job_timeouts "$default_timeout")

  # Guards against a parser regression that silently matches nothing. The
  # enumeration is 32 jobs today; the floor only needs to notice a collapse.
  local expected_floor=25
  [ "$seen" -ge "$expected_floor" ] ||
    fail "only ${seen} lock-using jobs were enumerated, expected at least ${expected_floor}; the workflow parser has probably drifted"
  [ "$checked" -gt 0 ] || fail 'no workflow declares a lock budget; the rule is unenforced'
  [ "$saw_verify_vectors" -eq 1 ] ||
    fail 'verify-vectors declares a lock budget but was not enumerated; the workflow parser has probably drifted'
}

# Emits "<workflow>:<job>|<bound-seconds>|<effective-seconds>" for every job that
# invokes the lock.
#
#   bound     the shortest thing that can kill the wait: the job's own
#             timeout-minutes, or the smallest timeout-minutes among the *steps*
#             that actually take the lock, whichever is smaller. A step budget
#             below the lock wait reintroduces the bug one level down -- the step
#             dies before with-runner-lock.sh can report the contention.
#   effective the longest wait that can actually occur in the job: the largest of
#             the applicable default and every override in scope. Overrides are
#             per-step, so a job with one overridden call and one un-overridden
#             call can still wait the default -- taking the max keeps that honest.
lock_using_job_timeouts() {
  local file
  for file in "$WORKFLOW_DIR"/*.yml; do
    [ -f "$file" ] || continue
    awk -v wf="$(basename "$file")" -v default_timeout="$1" '
      function note_override(value,   v) {
        v = value + 0
        if (v <= 0) return
        if (in_jobs) { if (job_override == "" || v > job_override + 0) job_override = v }
        else { if (file_override == "" || v > file_override + 0) file_override = v }
      }
      function flush_step() {
        # A lock-taking step with no budget of its own is bounded only by the job.
        if (step_uses_lock && step_timeout != "") {
          if (min_lock_step == "" || step_timeout + 0 < min_lock_step + 0) min_lock_step = step_timeout
        }
        step_uses_lock = 0; step_timeout = ""
      }
      function emit(   base, effective, bound, declared) {
        flush_step()
        if (job == "" || !job_uses_lock || job_timeout == "") return
        base = (file_override != "") ? file_override : default_timeout
        effective = base
        if (job_override != "" && job_override + 0 > effective + 0) effective = job_override
        bound = job_timeout * 60
        if (min_lock_step != "" && min_lock_step * 60 < bound) bound = min_lock_step * 60
        # "Declared" means the workflow states a budget covering *every* lock
        # call in the job: a workflow-level env override, or timeouts on the
        # lock-taking steps. A step-scoped override does not qualify, because the
        # remaining lock calls still inherit the long shared default, leaving the
        # job no more bounded than an undeclared one.
        declared = (file_override != "" || min_lock_step != "") ? "yes" : "no"
        print wf ":" job "|" bound "|" effective "|" declared
      }
      # Comments are prose. The lock path appears in plenty of them.
      /^[[:space:]]*#/ { next }
      # Only inside the jobs: block. `on:` has two-space children too (push:,
      # pull_request:, schedule:), which would otherwise be read as jobs.
      /^jobs:[[:space:]]*$/ { emit(); in_jobs = 1; job = ""; next }
      /^[A-Za-z]/ { emit(); in_jobs = 0; job = ""; next }
      /SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS[:=][[:space:]]*.?[0-9]+/ {
        if (match($0, /SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS[:=][[:space:]]*.?[0-9]+/)) {
          v = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", v); note_override(v)
        }
      }
      !in_jobs { next }
      /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
        emit()
        job = $1; sub(/:$/, "", job)
        job_timeout = ""; job_uses_lock = 0; job_override = ""; min_lock_step = ""
        step_uses_lock = 0; step_timeout = ""
        next
      }
      # Exactly four spaces: job-level. Steps indent theirs by eight, and reading
      # a step budget as the job budget would compare against the wrong number.
      /^    timeout-minutes:[[:space:]]*[0-9]+[[:space:]]*$/ {
        if (job_timeout == "") { t = $2; gsub(/[^0-9]/, "", t); job_timeout = t }
        next
      }
      /^      - / { flush_step() }
      /^        timeout-minutes:[[:space:]]*[0-9]+[[:space:]]*$/ {
        t = $2; gsub(/[^0-9]/, "", t); step_timeout = t; next
      }
      /with-runner-lock\.sh/ { job_uses_lock = 1; step_uses_lock = 1 }
      END { emit() }
    ' "$file"
  done
}

main "$@"
