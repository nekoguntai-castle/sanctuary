#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLEANUP_SCRIPT="$ROOT_DIR/scripts/ci/cleanup-docker-resources.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"

  case "$haystack" in
    *"$needle"*) ;;
    *) fail "$label: expected to find '$needle' in: $haystack" ;;
  esac
}

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"

  case "$haystack" in
    *"$needle"*) fail "$label: did not expect '$needle' in: $haystack" ;;
  esac
}

write_fake_docker() {
  local bin_dir="$1"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "${FAKE_DOCKER_CALL_LOG:?}"

if [[ "$*" == *'io.sanctuary.deployment-id'* ]] && [ "${1:-}" = ps ]; then
  if [ -n "${FAKE_DOCKER_DISCOVERY_READY:-}" ] \
      && mkdir "${FAKE_DOCKER_DISCOVERY_READY}.claim" 2>/dev/null; then
    : > "$FAKE_DOCKER_DISCOVERY_READY"
    until [ -e "${FAKE_DOCKER_DISCOVERY_CONTINUE:?}" ]; do sleep 0.01; done
  fi
  case "${FAKE_MANIFEST_LABEL_MODE:-}" in
    partial)
      printf 'd=\tp=sanctuary-ci-exact\to=operator\tc=compose_container\tl=\ty=\tt=\tr=\tm=\tu=\ta=map[io.sanctuary.project:sanctuary-ci-exact]\n'
      exit 0
      ;;
    full)
      printf 'd=deploy-guard\tp=sanctuary-ci-exact\to=operator\tc=compose_container\tl=active\ty=exact_delete\tt=2026-08-31T00:00:00.000Z\tr=unreleased\tm=%s\tu=run-fixture\ta=map[io.sanctuary.project:sanctuary-ci-exact]\n' "$(printf 'e%.0s' {1..40})"
      exit 0
      ;;
  esac
fi

if [ "${1:-}" = "ps" ] && [ "${2:-}" = "-a" ] && [ "${3:-}" = "--filter" ] && [ "${5:-}" = "-q" ]; then
  case "${4:-}" in
    label=com.docker.compose.project=sanctuary-ci-exact)
      printf '%s\n' exact-container
      ;;
    label=com.docker.compose.project=sanctuary-ci-stale)
      printf '%s\n' stale-container
      ;;
    label=com.docker.compose.project=sanctuary-ci-current)
      printf '%s\n' current-container
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "network" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--filter" ] && [ "${5:-}" = "-q" ]; then
  case "${4:-}" in
    label=com.docker.compose.project=sanctuary-ci-exact)
      printf '%s\n' exact-network
      ;;
    label=com.docker.compose.project=sanctuary-ci-stale)
      printf '%s\n' stale-network
      ;;
    label=com.docker.compose.project=sanctuary-ci-current)
      printf '%s\n' current-network
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "volume" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--filter" ] && [ "${5:-}" = "-q" ]; then
  case "${4:-}" in
    label=com.docker.compose.project=sanctuary-ci-exact)
      printf '%s\n' exact-volume
      ;;
    label=com.docker.compose.project=sanctuary-ci-stale)
      printf '%s\n' stale-volume
      ;;
    label=com.docker.compose.project=sanctuary-ci-current)
      printf '%s\n' current-volume
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "ps" ] && [ "${2:-}" = "-a" ] && [ "${3:-}" = "--format" ]; then
  case "${4:-}" in
    '{{.Label "com.docker.compose.project"}}')
      printf '%s\n' \
        sanctuary-ci-stale \
        sanctuary-ci-current \
        unrelated-project
      ;;
    '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}')
      old_at="$(date -d '30 days ago' '+%Y-%m-%d %H:%M:%S %z %Z')"
      new_at="$(date -d '1 minute ago' '+%Y-%m-%d %H:%M:%S %z %Z')"
      printf 'task-exited\tFORGEJO-ACTIONS-TASK-old\tExited (0) 2 hours ago\t%s\n' "$old_at"
      printf 'task-running\tFORGEJO-ACTIONS-TASK-current\tUp 3 minutes\t%s\n' "$new_at"
      printf 'task-dead\tGITEA-ACTIONS-TASK-dead\tDead\t%s\n' "$old_at"
      printf 'task-young\tFORGEJO-ACTIONS-TASK-inflight\tExited (0) 1 minute ago\t%s\n' "$new_at"
      printf 'task-restarting\tFORGEJO-ACTIONS-TASK-bouncing\tRestarting (1) 5 seconds ago\t%s\n' "$old_at"
      printf 'task-undated\tFORGEJO-ACTIONS-TASK-undated\tExited (0) 2 hours ago\tnot-a-date\n'
      printf 'ordinary\tordinary-container\tExited (0) 2 hours ago\t%s\n' "$old_at"
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "network" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--format" ]; then
  case "${4:-}" in
    '{{.Label "com.docker.compose.project"}}')
      printf '%s\n' sanctuary-ci-stale sanctuary-ci-current
      ;;
    '{{.ID}}\t{{.Name}}')
      printf 'workflow-empty\tWORKFLOW-old\n'
      printf 'workflow-busy\tWORKFLOW-current\n'
      printf 'ordinary-net\tordinary\n'
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "volume" ] && [ "${2:-}" = "ls" ] && [ "${3:-}" = "--format" ]; then
  case "${4:-}" in
    '{{.Label "com.docker.compose.project"}}')
      printf '%s\n' sanctuary-ci-stale
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = "network" ] && [ "${2:-}" = "inspect" ] && [ "${3:-}" = "--format" ]; then
  case "${5:-}" in
    workflow-empty)
      printf '0\n'
      ;;
    workflow-busy)
      printf '2\n'
      ;;
    *)
      printf 'unknown\n'
      ;;
  esac
  exit 0
fi

if [ "${FAKE_DOCKER_FAIL_REMOVE:-}" = "true" ] && [ "${1:-}" = "rm" ]; then
  exit 7
fi

exit 0
EOF
  chmod +x "$bin_dir/docker"
}

run_with_fake_docker() {
  local tmp="$1" output="$2"
  shift 2

  : > "$tmp/docker-calls.log"
  FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" SANCTUARY_PRE_MANIFEST_NONPRODUCTION=true \
    SANCTUARY_RUNTIME_DIR="$tmp/runtime" SANCTUARY_OPERATION_RUN_ID="cleanup-test-$$" PATH="$tmp/bin:$PATH" \
    bash "$CLEANUP_SCRIPT" "$@" >"$output" 2>&1
}

test_exact_project_cleanup() {
  local tmp="$1" output="$tmp/output.txt" calls

  run_with_fake_docker "$tmp" "$output" --project sanctuary-ci-exact
  calls="$(cat "$tmp/docker-calls.log")"

  assert_contains "$calls" "rm -f exact-container" "exact project should remove containers"
  assert_contains "$calls" "network rm exact-network" "exact project should remove networks"
  assert_contains "$calls" "volume rm -f exact-volume" "exact project should remove volumes"
}

test_protected_project_rejected() {
  local tmp="$1" output="$tmp/output.txt"

  if run_with_fake_docker "$tmp" "$output" --project sanctuary; then
    fail "protected project cleanup should fail"
  fi

  assert_contains "$(cat "$output")" "refusing to remove protected project: sanctuary" \
    "protected exact project should be rejected"
}

test_prefix_cleanup_excludes_current_project() {
  local tmp="$1" output="$tmp/output.txt" calls

  run_with_fake_docker "$tmp" "$output" --prefix sanctuary-ci- --exclude-project sanctuary-ci-current
  calls="$(cat "$tmp/docker-calls.log")"

  assert_contains "$calls" "rm -f stale-container" "prefix cleanup should remove stale containers"
  assert_contains "$calls" "network rm stale-network" "prefix cleanup should remove stale networks"
  assert_contains "$calls" "volume rm -f stale-volume" "prefix cleanup should remove stale volumes"
  assert_not_contains "$calls" "current-container" "prefix cleanup should skip excluded project"
  assert_not_contains "$calls" "label=com.docker.compose.project=sanctuary-ci-current" \
    "prefix cleanup should not query excluded project resources"
}

test_runner_leftovers_cleanup() {
  local tmp="$1" output="$tmp/output.txt" calls

  run_with_fake_docker "$tmp" "$output" --runner-leftovers
  calls="$(cat "$tmp/docker-calls.log")"

  assert_contains "$calls" "rm -f task-exited task-dead" \
    "runner cleanup should remove non-running action containers"
  assert_not_contains "$calls" "task-running" "runner cleanup should keep running action containers"
  assert_not_contains "$calls" "task-young" \
    "runner cleanup must not remove a recently created container: it may belong to an in-flight job"
  assert_not_contains "$calls" "task-restarting" \
    "runner cleanup must not remove a Restarting container: that is an active state, not a leftover"
  assert_not_contains "$calls" "task-undated" \
    "runner cleanup must fail safe when container age cannot be determined"
  assert_contains "$calls" "network rm workflow-empty" \
    "runner cleanup should remove empty workflow networks"
  assert_not_contains "$calls" "network rm workflow-busy" \
    "runner cleanup should keep workflow networks that still have containers"
}

test_dry_run_prints_without_removing() {
  local tmp="$1" output="$tmp/output.txt" calls

  run_with_fake_docker "$tmp" "$output" --dry-run --project sanctuary-ci-exact
  calls="$(cat "$tmp/docker-calls.log")"

  assert_contains "$(cat "$output")" "DRY-RUN: docker rm -f exact-container" \
    "dry run should print container removal"
  assert_contains "$(cat "$output")" "DRY-RUN: docker network rm exact-network" \
    "dry run should print network removal"
  assert_contains "$(cat "$output")" "DRY-RUN: docker volume rm -f exact-volume" \
    "dry run should print volume removal"
  assert_not_contains "$calls" "rm -f exact-container" "dry run should not remove containers"
  assert_not_contains "$calls" "network rm exact-network" "dry run should not remove networks"
  assert_not_contains "$calls" "volume rm -f exact-volume" "dry run should not remove volumes"
}

test_verify_empty_passes_without_matching_resources() {
  local tmp="$1" output="$tmp/output.txt" calls

  run_with_fake_docker "$tmp" "$output" --verify-empty --project sanctuary-ci-empty
  calls="$(cat "$tmp/docker-calls.log")"

  assert_contains "$calls" "label=com.docker.compose.project=sanctuary-ci-empty" \
    "verify-empty should query the selected exact project"
  assert_not_contains "$(cat "$output")" "cleanup verification found remaining Compose resources" \
    "verify-empty should pass when no selected resources remain"
}

test_verify_empty_fails_when_exact_resources_remain() {
  local tmp="$1" output="$tmp/output.txt"

  if run_with_fake_docker "$tmp" "$output" --verify-empty --project sanctuary-ci-exact; then
    fail "verify-empty should fail when exact project resources remain"
  fi

  assert_contains "$(cat "$output")" "resources remain for Compose project sanctuary-ci-exact" \
    "verify-empty should identify the leaking exact project"
  assert_contains "$(cat "$output")" "cleanup verification found remaining Compose resources" \
    "verify-empty should fail the cleanup command"
}

test_verify_empty_fails_when_prefix_resources_remain() {
  local tmp="$1" output="$tmp/output.txt"

  if run_with_fake_docker "$tmp" "$output" \
      --verify-empty \
      --prefix sanctuary-ci- \
      --exclude-project sanctuary-ci-current; then
    fail "verify-empty should fail when selected prefix resources remain"
  fi

  assert_contains "$(cat "$output")" "resources remain for Compose project sanctuary-ci-stale" \
    "verify-empty should report the leaking prefixed project"
  assert_not_contains "$(cat "$output")" "resources remain for Compose project sanctuary-ci-current" \
    "verify-empty should honor excluded projects"
}

test_unregistered_non_fixture_requires_explicit_scope() {
  local tmp="$1" output="$tmp/output.txt"

  : > "$tmp/docker-calls.log"
  if FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" PATH="$tmp/bin:$PATH" \
      SANCTUARY_RUNTIME_DIR="$tmp/runtime" SANCTUARY_OPERATION_RUN_ID="cleanup-test-$$" \
      bash "$CLEANUP_SCRIPT" --project production-sandbox >"$output" 2>&1; then
    fail "unregistered non-fixture cleanup should fail closed"
  fi
  assert_contains "$(cat "$output")" "explicit non-production fixture" \
    "legacy fallback must be explicitly non-production"
  assert_not_contains "$(cat "$tmp/docker-calls.log")" "rm -f" \
    "refused fallback must not mutate containers"
  assert_not_contains "$(cat "$tmp/docker-calls.log")" "network rm" \
    "refused fallback must not mutate networks"
  assert_not_contains "$(cat "$tmp/docker-calls.log")" "volume rm" \
    "refused fallback must not mutate volumes"
}

test_ci_name_is_not_implicit_premanifest_authorization() {
  local tmp="$1" output="$tmp/output.txt"

  : > "$tmp/docker-calls.log"
  if CI=true FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" PATH="$tmp/bin:$PATH" \
      SANCTUARY_RUNTIME_DIR="$tmp/runtime" SANCTUARY_OPERATION_RUN_ID="cleanup-test-$$" \
      bash "$CLEANUP_SCRIPT" --project sanctuary-ci-exact >"$output" 2>&1; then
    fail "CI naming alone must not authorize premanifest cleanup"
  fi
  assert_contains "$(cat "$output")" "explicit non-production fixture" \
    "premanifest cleanup requires the dedicated explicit flag"
  assert_not_contains "$(cat "$tmp/docker-calls.log")" "rm -f exact-container" \
    "implicit CI authorization must not mutate"
}

test_partial_manifest_tuple_refuses_before_mutation() {
  local tmp="$1" output="$tmp/output.txt"

  : > "$tmp/docker-calls.log"
  if FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" FAKE_MANIFEST_LABEL_MODE=partial \
      SANCTUARY_PRE_MANIFEST_NONPRODUCTION=true SANCTUARY_RUNTIME_DIR="$tmp/runtime" \
      SANCTUARY_OPERATION_RUN_ID="cleanup-test-$$" PATH="$tmp/bin:$PATH" \
      bash "$CLEANUP_SCRIPT" --project sanctuary-ci-exact >"$output" 2>&1; then
    fail "partial manifest ownership tuple must refuse cleanup"
  fi
  assert_contains "$(cat "$output")" "partial or inconsistent ownership tuple" \
    "partial manifest tuple should fail closed"
  assert_not_contains "$(cat "$tmp/docker-calls.log")" "rm -f exact-container" \
    "partial manifest tuple must refuse before mutation"
}

test_project_lock_closes_discovery_to_mutation_race() {
  local tmp="$1" output="$tmp/output.txt" ready="$tmp/discovery-ready" continue="$tmp/discovery-continue"
  local cleanup_pid status

  : > "$tmp/docker-calls.log"
  FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" FAKE_DOCKER_DISCOVERY_READY="$ready" \
    FAKE_DOCKER_DISCOVERY_CONTINUE="$continue" SANCTUARY_PRE_MANIFEST_NONPRODUCTION=true \
    SANCTUARY_RUNTIME_DIR="$tmp/runtime" SANCTUARY_OPERATION_RUN_ID="cleanup-race-$$" \
    PATH="$tmp/bin:$PATH" bash "$CLEANUP_SCRIPT" --project sanctuary-ci-exact >"$output" 2>&1 &
  cleanup_pid=$!
  for _ in {1..200}; do [ -e "$ready" ] && break; sleep 0.01; done
  [ -e "$ready" ] || fail "cleanup did not pause after manifest discovery began"

  set +e
  SANCTUARY_RUNTIME_DIR="$tmp/runtime" SANCTUARY_OPERATION_RUN_ID="deploy-race-$$" \
    SANCTUARY_LOCK_CONTROLLER_PID="$$" node "$ROOT_DIR/scripts/ownership/project-lock-cli.mjs" \
      acquire sanctuary-ci-exact >/dev/null 2>"$tmp/race-error.txt"
  status=$?
  set -e
  [ "$status" -ne 0 ] || fail "deployment start acquired the project lock during legacy cleanup"
  assert_contains "$(cat "$tmp/race-error.txt")" "already held" \
    "concurrent start should lose the project mutation lock race"

  : > "$continue"
  wait "$cleanup_pid"
  assert_contains "$(cat "$tmp/docker-calls.log")" "rm -f exact-container" \
    "cleanup should resume after the contending start is refused"
}

test_legacy_mutation_failures_are_reported_after_remaining_cleanup() {
  local tmp="$1" output="$tmp/output.txt" calls

  : > "$tmp/docker-calls.log"
  if FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" FAKE_DOCKER_FAIL_REMOVE=true \
      SANCTUARY_PRE_MANIFEST_NONPRODUCTION=true SANCTUARY_RUNTIME_DIR="$tmp/runtime" \
      SANCTUARY_OPERATION_RUN_ID="cleanup-test-$$" PATH="$tmp/bin:$PATH" \
      bash "$CLEANUP_SCRIPT" --project sanctuary-ci-exact >"$output" 2>&1; then
    fail "legacy Docker mutation failure should be surfaced"
  fi
  calls="$(cat "$tmp/docker-calls.log")"
  assert_contains "$calls" "network rm exact-network" "cleanup should continue after a container command failure"
  assert_contains "$calls" "volume rm -f exact-volume" "cleanup should attempt remaining exact resources"
  assert_contains "$(cat "$output")" "one or more Docker cleanup commands failed" \
    "legacy failure should produce a nonzero aggregate outcome"
}

write_fake_node() {
  local bin_dir="$1"

  cat > "$bin_dir/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'node %s\n' "$*" >> "${FAKE_DOCKER_CALL_LOG:?}"
case "$*" in
  *"project-lock-cli.mjs acquire "*) printf 'project-token\n' ;;
  *"project-lock-cli.mjs release "*) [ "${FAKE_PROJECT_LOCK_RELEASE_FAIL:-}" != true ] || exit 9 ;;
  *"deployment-session.mjs lock-only") printf 'guard-token\towned\n' ;;
esac
EOF
  chmod +x "$bin_dir/node"
}

test_manifest_modes_delegate_without_docker_mutation() {
  local tmp="$1" output="$tmp/output.txt" calls

  run_with_fake_docker "$tmp" "$output" --manifest-inventory "$tmp/request.json"
  calls="$(cat "$tmp/docker-calls.log")"
  assert_contains "$calls" "cleanup-cli.mjs inventory $tmp/request.json" \
    "manifest inventory should delegate to the Node core"
  assert_not_contains "$calls" "rm -f" "manifest inventory must not remove containers"
  assert_not_contains "$calls" "network rm" "manifest inventory must not remove networks"
  assert_not_contains "$calls" "volume rm" "manifest inventory must not remove volumes"
}

test_manifest_enabled_legacy_cleanup_is_locked_and_current_guarded() {
  local tmp="$1" output="$tmp/output.txt" calls
  local runtime="$tmp/runtime"

  mkdir -p "$runtime/ownership/deployments/deploy-guard/revisions"
  : > "$tmp/docker-calls.log"
  FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" PATH="$tmp/bin:$PATH" \
    SANCTUARY_RUNTIME_DIR="$runtime" SANCTUARY_DEPLOYMENT_ID="deploy-guard" \
    SANCTUARY_OPERATION_RUN_ID="guard-run" \
    bash "$CLEANUP_SCRIPT" --project sanctuary-ci-exact >"$output" 2>&1
  calls="$(cat "$tmp/docker-calls.log")"
  case "$calls" in
    *"deployment-session.mjs lock-only"*"deployment-session.mjs guard-legacy-cleanup sanctuary-ci-exact"*"rm -f exact-container"*"deployment-session.mjs release"*) ;;
    *) fail "manifest legacy cleanup did not lock, guard, mutate, then release in order: $calls" ;;
  esac
}

test_manifest_labels_discover_canonical_identity() {
  local tmp="$1" output="$tmp/output.txt" calls
  local runtime="$tmp/runtime"

  mkdir -p "$runtime/ownership/deployments/deploy-guard/revisions"
  : > "$tmp/docker-calls.log"
  FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" FAKE_MANIFEST_LABEL_MODE=full PATH="$tmp/bin:$PATH" \
    SANCTUARY_RUNTIME_DIR="$runtime" SANCTUARY_OPERATION_RUN_ID="guard-discovery" \
    bash "$CLEANUP_SCRIPT" --project sanctuary-ci-exact >"$output" 2>&1
  calls="$(cat "$tmp/docker-calls.log")"
  case "$calls" in
    *"project-lock-cli.mjs acquire sanctuary-ci-exact"*"deployment-session.mjs lock-only"*"deployment-session.mjs guard-legacy-cleanup sanctuary-ci-exact"*"rm -f exact-container"*) ;;
    *) fail "manifest labels did not bind the canonical lock before mutation: $calls" ;;
  esac
}

test_project_lock_release_failure_is_nonzero() {
  local tmp="$1" output="$tmp/output.txt"

  : > "$tmp/docker-calls.log"
  if FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" FAKE_PROJECT_LOCK_RELEASE_FAIL=true \
      SANCTUARY_PRE_MANIFEST_NONPRODUCTION=true SANCTUARY_RUNTIME_DIR="$tmp/runtime" \
      SANCTUARY_OPERATION_RUN_ID="release-failure" PATH="$tmp/bin:$PATH" \
      bash "$CLEANUP_SCRIPT" --project sanctuary-ci-exact >"$output" 2>&1; then
    fail "project lock release failure must make cleanup nonzero"
  fi
  assert_contains "$(cat "$output")" "project mutation lock" \
    "lock release failure should be surfaced"
}

main() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "'"$tmp"'"' EXIT
  export SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true
  export SANCTUARY_TEST_PROJECT_LOCK_ROOT="$tmp/project-locks"
  write_fake_docker "$tmp/bin"

  test_exact_project_cleanup "$tmp"
  test_protected_project_rejected "$tmp"
  test_prefix_cleanup_excludes_current_project "$tmp"
  test_runner_leftovers_cleanup "$tmp"
  test_dry_run_prints_without_removing "$tmp"
  test_verify_empty_passes_without_matching_resources "$tmp"
  test_verify_empty_fails_when_exact_resources_remain "$tmp"
  test_verify_empty_fails_when_prefix_resources_remain "$tmp"
  test_unregistered_non_fixture_requires_explicit_scope "$tmp"
  test_ci_name_is_not_implicit_premanifest_authorization "$tmp"
  test_partial_manifest_tuple_refuses_before_mutation "$tmp"
  test_project_lock_closes_discovery_to_mutation_race "$tmp"
  test_legacy_mutation_failures_are_reported_after_remaining_cleanup "$tmp"
  write_fake_node "$tmp/bin"
  test_manifest_modes_delegate_without_docker_mutation "$tmp"
  test_manifest_enabled_legacy_cleanup_is_locked_and_current_guarded "$tmp"
  test_manifest_labels_discover_canonical_identity "$tmp"
  test_project_lock_release_failure_is_nonzero "$tmp"

  echo "cleanup-docker-resources regression checks passed"
}

main "$@"
