#!/usr/bin/env bash
# Regression: every CI test must actually run, and every CI script must be
# syntax-checked.
#
# Registration is three hand-maintained lists inside one heredoc in
# .github/workflows/quality.yml. Nothing reconciled them against what is on
# disk, so a test could be written, reviewed, merged — and never execute. Six
# were in that state (#611), including cleanup-docker-resources and
# sanctuary-backup. All six passed the moment they were wired up, which is the
# point: they were not failing, they were silent.
#
# A test that never runs is worse than no test. It reads as coverage in review
# and provides none.
#
# Deliberate exclusions go in the allowlist below with a reason, so "not run" is
# always a recorded decision rather than an oversight.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
QUALITY="$REPO_ROOT/.github/workflows/quality.yml"
WORKFLOW_DIR="$REPO_ROOT/.github/workflows"

PASS=0
FAIL=0
FAILURES=()

ok()  { PASS=$((PASS + 1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); echo "FAIL: $1" >&2; }

# Tests deliberately not executed by CI. Empty today; add an entry only with a
# reason, e.g. "needs a GPU runner".
EXECUTION_ALLOWLIST=()

# Files deliberately excluded from the bash -n sweep. Empty today.
SWEEP_ALLOWLIST=()

allowed() {
  local needle="$1"; shift
  local entry
  for entry in "$@"; do [ "$entry" = "$needle" ] && return 0; done
  return 1
}

[ -f "$QUALITY" ] || bad "quality.yml not found at $QUALITY"

# Grep the files directly rather than slurping them into variables. Under
# `set -o pipefail`, `printf '%s' "$big" | grep -q ...` reports FAILURE on a
# successful match: grep -q exits at the first hit, printf takes SIGPIPE, and
# pipefail surfaces that as the pipeline status. It only bites past the pipe
# buffer, so it looks like a content problem rather than a plumbing one — this
# guard reported 50 false orphans and one real finding before it was spotted.

# ----- 1. every test is executed somewhere ----------------------------------
missing_exec=()
count_tests=0
for path in "$REPO_ROOT"/tests/ci/*.test.sh; do
  [ -f "$path" ] || continue
  name="$(basename "$path")"
  count_tests=$((count_tests + 1))
  # Both invocation styles are in use: `bash tests/ci/x.test.sh` and the
  # executable form `./tests/ci/x.test.sh`. Missing the second one is how this
  # check previously mis-flagged relay-job-diagnosability as an orphan.
  if grep -rqE "(bash|\./)[[:space:]]*tests/ci/${name}" "$WORKFLOW_DIR"; then
    continue
  fi
  allowed "$name" ${EXECUTION_ALLOWLIST+"${EXECUTION_ALLOWLIST[@]}"} && continue
  missing_exec+=("$name")
done

if [ "$count_tests" -lt 10 ]; then
  bad "only found ${count_tests} tests under tests/ci — the scan has probably drifted"
elif [ "${#missing_exec[@]}" -eq 0 ]; then
  ok "all ${count_tests} tests under tests/ci are executed by a workflow"
else
  bad "tests that no workflow runs:${missing_exec[*]/#/ } — wire them into quality.yml or allowlist them with a reason"
fi

# ----- 2. every test and script is in the bash -n sweep ---------------------
# scripts/ci is walked recursively, not globbed. A plain scripts/ci/*.sh misses
# subdirectories — scripts/ci/vendor/forgejo-artifact-v4/build.sh is registered
# in the sweep today but was invisible to the glob, so the guard could not have
# noticed if it were dropped. Paths are made repo-relative so the registration
# strings match regardless of nesting depth.
missing_sweep=()
while IFS= read -r path; do
  [ -f "$path" ] || continue
  rel="${path#"$REPO_ROOT"/}"
  name="$(basename "$path")"
  grep -qF "bash -n ${rel}" "$QUALITY" && continue
  allowed "$name" ${SWEEP_ALLOWLIST+"${SWEEP_ALLOWLIST[@]}"} && continue
  missing_sweep+=("$rel")
done < <({ find "$REPO_ROOT/tests/ci" -maxdepth 1 -name '*.test.sh' -type f
           find "$REPO_ROOT/scripts/ci" -name '*.sh' -type f; } | sort)

if [ "${#missing_sweep[@]}" -eq 0 ]; then
  ok 'every tests/ci and scripts/ci file is in the bash -n sweep'
else
  bad "not syntax-checked:${missing_sweep[*]/#/ }"
fi

# ----- 3. no dangling registrations -----------------------------------------
# The mirror image: a list naming a file that no longer exists fails the lane
# for a reason unrelated to the change that triggered it.
dangling=()
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  [ -f "$REPO_ROOT/$rel" ] || dangling+=("$rel")
done < <(grep -oE '(bash -n |bash |\./)(tests/ci|scripts/ci)/[A-Za-z0-9._-]+\.(sh|mjs)' "$QUALITY" \
          | sed -E 's/^(bash -n |bash |\.\/)//' | sort -u)

if [ "${#dangling[@]}" -eq 0 ]; then
  ok 'every registered path still exists'
else
  bad "quality.yml registers files that do not exist:${dangling[*]/#/ }"
fi

# ----- 4. this guard is itself registered ------------------------------------
# Otherwise it reproduces exactly the bug it exists to prevent.
self='ci-registration-completeness.test.sh'
if grep -rqE "(bash|\./)[[:space:]]*tests/ci/${self}" "$WORKFLOW_DIR"; then
  ok 'the completeness guard is itself executed by CI'
else
  bad "${self} is not registered — it would not run, which is the bug it checks for"
fi

# ----- 5. allowlist entries still refer to real files ------------------------
# An exemption for a file that no longer exists grants nothing and hides that
# its reason has expired. Left unchecked, the allowlists accumulate exactly the
# unrecorded intent this guard exists to eliminate.
stale_alw=()
for entry in ${EXECUTION_ALLOWLIST+"${EXECUTION_ALLOWLIST[@]}"} \
             ${SWEEP_ALLOWLIST+"${SWEEP_ALLOWLIST[@]}"}; do
  [ -f "$REPO_ROOT/tests/ci/$entry" ] || [ -f "$REPO_ROOT/scripts/ci/$entry" ] \
    || stale_alw+=("$entry")
done

if [ "${#stale_alw[@]}" -eq 0 ]; then
  ok 'every allowlist entry refers to a file that exists'
else
  bad "allowlisted files that no longer exist:${stale_alw[*]/#/ } — drop the entries"
fi

echo
echo "===================="
echo "Total:  $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "Failures:" >&2
  for f in "${FAILURES[@]}"; do echo "  - $f" >&2; done
  exit 1
fi
