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
# Suites can be registered by name here instead of in a workflow.
SUITE_RUNNER="$REPO_ROOT/scripts/ci/run-install-unit-tests.sh"
RELEASE_SUITE_MANIFEST="$REPO_ROOT/package.json"
WORKFLOW_COMPOSITION_TEST="$REPO_ROOT/tests/ci/check-workflow-composition.test.sh"

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

# tests/release files deliberately not executed by CI. Empty today. Release
# tests are checked separately because they include both shell and Node suites.
RELEASE_EXECUTION_ALLOWLIST=()

# tests/install files deliberately not executed by CI. Both entries below are
# dead code kept only until someone decides what to do with them: each calls a
# helper that no longer exists, so wiring them in would fail immediately rather
# than add coverage. They are recorded here instead of deleted because
# upgrade-browser-smoke encodes coverage nothing else has (see the note).
#
#   upgrade-worker-smoke.test.sh   calls assert_upgrade_worker_ready and
#                                  assert_upgrade_support_package_json, neither
#                                  defined since the assertions were reworked.
#   upgrade-browser-smoke.test.sh  calls upgrade_authenticated_json_request,
#                                  also gone. NOTE: its CSRF-protected
#                                  password-change smoke is not covered by
#                                  assert_browser_auth_smoke or anything else,
#                                  so deleting it drops that case entirely.
#
# Both have been untouched since #125 (2026-04-24).
INSTALL_EXECUTION_ALLOWLIST=(
  'upgrade-worker-smoke.test.sh'
  'upgrade-browser-smoke.test.sh'
)

allowed() {
  local needle="$1"; shift
  local entry
  for entry in "$@"; do [ "$entry" = "$needle" ] && return 0; done
  return 1
}

# Build canonical reference and execution inventories across all workflows.
# Full-line comments are excluded so documentation cannot masquerade as
# registration. The broader reference inventory catches stale bare and
# workspace-prefixed script paths; the execution inventory deliberately keeps
# command shape so a bash -n check cannot count as running a release test.
workflow_source() {
  find "$WORKFLOW_DIR" -type f \( -name '*.yml' -o -name '*.yaml' \) -print0 \
    | sort -z \
    | xargs -0 sed -E '/^[[:space:]]*#/d'
}
mapfile -t WORKFLOW_REFERENCES < <(
  workflow_source \
    | grep -oE '(tests/ci|scripts/ci|tests/release)/[A-Za-z0-9._/-]+\.(sh|mjs)' \
    | sort -u
)
mapfile -t WORKFLOW_EXECUTIONS < <(
  workflow_source \
    | grep -oE '(bash |\./|node --test |node )(tests/ci|scripts/ci|tests/release)/[A-Za-z0-9._/-]+\.(sh|mjs)' \
    | sed -E 's/^(bash |\.\/|node --test |node )//' \
    | sort -u
)

workflow_executes() {
  allowed "$1" ${WORKFLOW_EXECUTIONS+"${WORKFLOW_EXECUTIONS[@]}"}
}

release_aggregate_executes() {
  local rel="$1"
  grep -rqE 'npm run test:release-distribution([[:space:]]|$)' "$WORKFLOW_DIR" \
    && [ -f "$RELEASE_SUITE_MANIFEST" ] \
    && grep -qF "$rel" "$RELEASE_SUITE_MANIFEST"
}

[ -f "$QUALITY" ] || bad "quality.yml not found at $QUALITY"

# Grep the files directly rather than slurping them into variables. Under
# `set -o pipefail`, `printf '%s' "$big" | grep -q ...` reports FAILURE on a
# successful match: grep -q exits at the first hit, printf takes SIGPIPE, and
# pipefail surfaces that as the pipeline status. It only bites past the pipe
# buffer, so it looks like a content problem rather than a plumbing one — this
# guard reported 50 false orphans and one real finding before it was spotted.

unsafe_pipeline_functions=()
for function_name in \
  assert_contains_in_order \
  assert_named_job_contains \
  assert_named_job_not_contains \
  check_interpreter_heredocs; do
  function_body="$(awk -v start="$function_name() {" \
    '$0 == start { inside = 1 } inside { print } inside && $0 == "}" { exit }' \
    "$WORKFLOW_COMPOSITION_TEST")"
  if [ -z "$function_body" ]; then
    unsafe_pipeline_functions+=("$function_name (missing)")
    continue
  fi
  normalized_body="${function_body//$'\n'/ }"
  normalized_body="${normalized_body//\\/ }"
  if [[ "$normalized_body" =~ \|[[:space:]]*grep([[:space:]]|$) ]]; then
    unsafe_pipeline_functions+=("$function_name")
  fi
done

if [ "${#unsafe_pipeline_functions[@]}" -eq 0 ]; then
  ok 'workflow composition assertions avoid grep -q producer SIGPIPE inversions'
else
  bad "workflow composition assertion functions use piped grep:${unsafe_pipeline_functions[*]/#/ }"
fi

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
  if [ "$name" != "$(basename "$WORKFLOW_COMPOSITION_TEST")" ] \
      && grep -qF "$name" "$WORKFLOW_COMPOSITION_TEST" \
      && grep -rqE '(bash|\./)[[:space:]]*tests/ci/check-workflow-composition\.test\.sh' "$WORKFLOW_DIR"; then
    continue
  fi
  # A suite may be run indirectly: install-test.yml and release-candidate.yml now
  # both call scripts/ci/run-install-unit-tests.sh rather than enumerating suites,
  # which is what stopped the two lists drifting apart (install-test listed 15,
  # release-candidate listed 10). Naming it there counts as registration.
  if [ -f "$SUITE_RUNNER" ] && grep -qF "tests/ci/${name}" "$SUITE_RUNNER"; then
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

# Ownership protocol modules and focused tests are an architecture/CI contract.
# Keep their bounded registration explicit instead of silently relying on a
# generic source glob.
if grep -qF 'for ownership_script in scripts/ownership/*.mjs' "$QUALITY" && \
   grep -qF 'npm run check:resource-ownership-contract' "$QUALITY" && \
   grep -qF 'npm run test:ownership' "$QUALITY"; then
  ok 'ownership protocol syntax, contract, and focused tests are registered'
else
  bad 'ownership protocol checks are not fully registered in quality.yml'
fi

# ----- 3. no dangling workflow references -----------------------------------
# The mirror image: a workflow naming a file that no longer exists fails the
# lane for a reason unrelated to the change that triggered it.
dangling=()
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  [ -f "$REPO_ROOT/$rel" ] || dangling+=("$rel")
done < <(printf '%s\n' ${WORKFLOW_REFERENCES+"${WORKFLOW_REFERENCES[@]}"})

if [ "${#dangling[@]}" -eq 0 ]; then
  ok 'every registered path still exists'
else
  bad "workflows reference files that do not exist:${dangling[*]/#/ }"
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
             ${SWEEP_ALLOWLIST+"${SWEEP_ALLOWLIST[@]}"} \
             ${INSTALL_EXECUTION_ALLOWLIST+"${INSTALL_EXECUTION_ALLOWLIST[@]}"} \
             ${RELEASE_EXECUTION_ALLOWLIST+"${RELEASE_EXECUTION_ALLOWLIST[@]}"}; do
  [ -f "$REPO_ROOT/tests/ci/$entry" ] \
    || [ -f "$REPO_ROOT/scripts/ci/$entry" ] \
    || [ -f "$REPO_ROOT/tests/install/unit/$entry" ] \
    || [ -f "$REPO_ROOT/tests/install/e2e/$entry" ] \
    || [ -f "$REPO_ROOT/tests/release/$entry" ] \
    || stale_alw+=("$entry")
done

if [ "${#stale_alw[@]}" -eq 0 ]; then
  ok 'every allowlist entry refers to a file that exists'
else
  bad "allowlisted files that no longer exist:${stale_alw[*]/#/ } — drop the entries"
fi

# ----- 6. tests/install is registered too ------------------------------------
# Sections 1-5 only look at tests/ci and scripts/ci. tests/install has its own
# registration problem and a worse one: the unit list is hand-maintained in
# THREE places (install-test.yml, release-candidate.yml, run-all-tests.sh), and
# a file present in some but not others is invisible.
#
# offline-bundle-script.test.sh (10 assertions) and upgrade-backup-script.test.sh
# (4) sat in exactly that state — listed only in run-all-tests.sh, which no
# workflow invokes, so 14 assertions never ran in CI. Both passed the moment
# they were wired up, which is the tell: they were not failing, they were
# silent.
install_missing_exec=()
count_install=0
while IFS= read -r path; do
  [ -f "$path" ] || continue
  name="$(basename "$path")"
  rel="${path#"$REPO_ROOT"/}"
  count_install=$((count_install + 1))
  if grep -rqE "(bash|\./)[[:space:]]*${rel}" "$WORKFLOW_DIR"; then
    continue
  fi
  if grep -rqF 'scripts/ci/run-compose-e2e-subject.sh' "$WORKFLOW_DIR" \
      && grep -qF "./${rel}" "$REPO_ROOT/scripts/ci/run-compose-e2e-subject.sh"; then
    continue
  fi
  # tests/install/unit/* are executed by the shared suite runner via a glob, so
  # they are registered by construction -- adding a suite needs no workflow edit.
  # That is the point: the enumeration is what drifted.
  case "$rel" in
    tests/install/unit/*.test.sh)
      if [ -f "$SUITE_RUNNER" ] && grep -qF 'tests/install/unit/*.test.sh' "$SUITE_RUNNER"; then
        continue
      fi
      ;;
  esac
  allowed "$name" ${INSTALL_EXECUTION_ALLOWLIST+"${INSTALL_EXECUTION_ALLOWLIST[@]}"} && continue
  install_missing_exec+=("$rel")
done < <({ find "$REPO_ROOT/tests/install/unit" -maxdepth 1 -name '*.test.sh' -type f
           find "$REPO_ROOT/tests/install/e2e" -maxdepth 1 -name '*.test.sh' -type f; } | sort)

if [ "$count_install" -lt 10 ]; then
  bad "only found ${count_install} tests under tests/install — the scan has probably drifted"
elif [ "${#install_missing_exec[@]}" -eq 0 ]; then
  ok "all ${count_install} tests under tests/install are executed by a workflow"
else
  bad "tests/install tests that no workflow runs:${install_missing_exec[*]/#/ } — wire them in or allowlist them with a reason"
fi

# ----- 7. tests/release is registered too ----------------------------------
# Release-only checks exercise paths that ordinary CI does not. A suite left
# off the workflow would stay silent until the release path needed it most.
# Both shell and Node test files are in scope; executing them is their syntax
# validation, so this intentionally does not add them to the bash -n sweep.
release_missing_exec=()
count_release=0
while IFS= read -r path; do
  [ -f "$path" ] || continue
  name="$(basename "$path")"
  rel="${path#"$REPO_ROOT"/}"
  count_release=$((count_release + 1))
  if workflow_executes "$rel" || release_aggregate_executes "$rel"; then
    continue
  fi
  allowed "$name" ${RELEASE_EXECUTION_ALLOWLIST+"${RELEASE_EXECUTION_ALLOWLIST[@]}"} && continue
  release_missing_exec+=("$rel")
done < <(find "$REPO_ROOT/tests/release" -maxdepth 1 -type f \
          \( -name '*.test.sh' -o -name '*.test.mjs' \) | sort)

if [ "$count_release" -lt 5 ]; then
  bad "only found ${count_release} tests under tests/release — the scan has probably drifted"
elif [ "${#release_missing_exec[@]}" -eq 0 ]; then
  ok "all ${count_release} tests under tests/release are executed by a workflow"
else
  bad "tests/release tests that no workflow runs:${release_missing_exec[*]/#/ } — wire them in or allowlist them with a reason"
fi

# ----- 8. the documented local runner matches CI -----------------------------
# tests/install/README.md tells developers to run run-all-tests.sh. When CI runs
# a unit test that the local runner does not, the documented command silently
# provides less coverage than CI, and a developer can be green locally on a test
# CI is about to fail them for. Five tests were in that state.
#
# e2e is deliberately out of scope here: the local runner drives those through
# its own --e2e-only path rather than a per-file list.
RUN_ALL="$REPO_ROOT/tests/install/run-all-tests.sh"
local_missing=()
if [ ! -f "$RUN_ALL" ]; then
  bad "no local runner at $RUN_ALL"
else
  for path in "$REPO_ROOT"/tests/install/unit/*.test.sh; do
    [ -f "$path" ] || continue
    name="$(basename "$path")"
    grep -qF "unit/${name}" "$RUN_ALL" && continue
    allowed "$name" ${INSTALL_EXECUTION_ALLOWLIST+"${INSTALL_EXECUTION_ALLOWLIST[@]}"} && continue
    local_missing+=("$name")
  done

  if [ "${#local_missing[@]}" -eq 0 ]; then
    ok 'run-all-tests.sh runs every install unit test CI runs'
  else
    bad "run-all-tests.sh omits:${local_missing[*]/#/ } — the documented local command under-covers relative to CI"
  fi
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
