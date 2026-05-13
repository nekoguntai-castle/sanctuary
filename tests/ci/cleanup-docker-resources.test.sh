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
    '{{.ID}}\t{{.Names}}\t{{.Status}}')
      printf 'task-exited\tFORGEJO-ACTIONS-TASK-old\tExited (0) 2 hours ago\n'
      printf 'task-running\tFORGEJO-ACTIONS-TASK-current\tUp 3 minutes\n'
      printf 'task-dead\tGITEA-ACTIONS-TASK-dead\tDead\n'
      printf 'ordinary\tordinary-container\tExited (0) 2 hours ago\n'
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

exit 0
EOF
  chmod +x "$bin_dir/docker"
}

run_with_fake_docker() {
  local tmp="$1" output="$2"
  shift 2

  : > "$tmp/docker-calls.log"
  FAKE_DOCKER_CALL_LOG="$tmp/docker-calls.log" PATH="$tmp/bin:$PATH" \
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

main() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "'"$tmp"'"' EXIT
  write_fake_docker "$tmp/bin"

  test_exact_project_cleanup "$tmp"
  test_protected_project_rejected "$tmp"
  test_prefix_cleanup_excludes_current_project "$tmp"
  test_runner_leftovers_cleanup "$tmp"
  test_dry_run_prints_without_removing "$tmp"
  test_verify_empty_passes_without_matching_resources "$tmp"
  test_verify_empty_fails_when_exact_resources_remain "$tmp"
  test_verify_empty_fails_when_prefix_resources_remain "$tmp"

  echo "cleanup-docker-resources regression checks passed"
}

main "$@"
