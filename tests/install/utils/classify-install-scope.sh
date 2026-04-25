#!/usr/bin/env bash
set -euo pipefail

output_file="${GITHUB_OUTPUT:-/dev/stdout}"
event_name="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
workflow_sha="${WORKFLOW_SHA:-${GITHUB_SHA:-HEAD}}"
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"
github_ref="${GITHUB_REF:-}"
input_test_suite="${WORKFLOW_INPUT_TEST_SUITE:-}"

is_release=false
test_suite=all
should_run=false
run_unit=false
run_fresh_install=false
run_install_script=false
run_container_health=false
run_auth_flow=false
run_upgrade=false
run_upgrade_baseline=false
run_upgrade_extended=false
run_reuse_stack=false
scope=none
reason='No install-relevant files changed'

emit_outputs() {
  {
    echo "is_release=$is_release"
    echo "test_suite=$test_suite"
    echo "should_run=$should_run"
    echo "run_unit=$run_unit"
    echo "run_fresh_install=$run_fresh_install"
    echo "run_install_script=$run_install_script"
    echo "run_container_health=$run_container_health"
    echo "run_auth_flow=$run_auth_flow"
    echo "run_upgrade=$run_upgrade"
    echo "run_upgrade_baseline=$run_upgrade_baseline"
    echo "run_upgrade_extended=$run_upgrade_extended"
    echo "run_reuse_stack=$run_reuse_stack"
    echo "scope=$scope"
    echo "reason=$reason"
  } >> "$output_file"
}

enable_unit() {
  should_run=true
  run_unit=true
}

enable_fresh_install() {
  should_run=true
  run_fresh_install=true
}

enable_install_script() {
  should_run=true
  run_install_script=true
}

enable_container_health() {
  should_run=true
  run_container_health=true
}

enable_auth_flow() {
  should_run=true
  run_auth_flow=true
}

enable_upgrade_baseline() {
  should_run=true
  run_upgrade=true
  run_upgrade_baseline=true
}

enable_upgrade_extended() {
  should_run=true
  run_upgrade=true
  run_upgrade_extended=true
}

enable_upgrade() {
  enable_upgrade_baseline
  enable_upgrade_extended
}

enable_standard_stack() {
  enable_fresh_install
  enable_container_health
  enable_auth_flow
  run_reuse_stack=true
}

enable_release_critical() {
  enable_unit
  enable_standard_stack
  enable_install_script
  enable_upgrade
}

apply_manual_suite() {
  local suite="$1"

  should_run=true
  test_suite="$suite"
  reason="Manual dispatch suite: $suite"

  case "$suite" in
    all)
      enable_unit
      enable_standard_stack
      enable_install_script
      enable_upgrade
      scope=all
      ;;
    unit)
      enable_unit
      scope=unit-only
      ;;
    fresh-install)
      enable_unit
      enable_fresh_install
      scope=fresh-install
      ;;
    install-script)
      enable_unit
      enable_install_script
      scope=installer
      ;;
    container-health)
      enable_unit
      enable_fresh_install
      enable_container_health
      run_reuse_stack=true
      scope=compose-docker
      ;;
    auth-flow)
      enable_unit
      enable_fresh_install
      enable_auth_flow
      run_reuse_stack=true
      scope=auth-flow
      ;;
    upgrade)
      enable_upgrade
      scope=upgrade
      ;;
    release-critical)
      enable_release_critical
      scope=release-critical
      ;;
    *)
      echo "Unknown install test suite: $suite" >&2
      exit 1
      ;;
  esac
}

if [[ "$github_ref" == refs/tags/v* ]]; then
  is_release=true
  test_suite=release-critical
  reason="Release tag: $github_ref"
  scope=release-critical
  enable_release_critical
  emit_outputs
  exit 0
fi

if [ -n "$input_test_suite" ]; then
  apply_manual_suite "$input_test_suite"
  emit_outputs
  exit 0
fi

if [ "$event_name" = "schedule" ]; then
  should_run=true
  test_suite=upgrade
  reason="Scheduled upgrade validation"
  scope=upgrade
  enable_upgrade
  emit_outputs
  exit 0
fi

zero_sha='0000000000000000000000000000000000000000'
base_sha=''
head_sha="$workflow_sha"

case "$event_name" in
  pull_request)
    base_sha="${PR_BASE_SHA:-}"
    head_sha="${PR_HEAD_SHA:-$workflow_sha}"
    ;;
  push)
    base_sha="${PUSH_BEFORE_SHA:-}"
    head_sha="$workflow_sha"
    if [ "$base_sha" = "$zero_sha" ]; then
      base_sha="$(git rev-list --max-parents=0 "$head_sha")"
    fi
    ;;
  *)
    apply_manual_suite all
    reason="Unrecognized event uses full install scope: $event_name"
    emit_outputs
    exit 0
    ;;
esac

if [ -z "$base_sha" ]; then
  base_sha="$(git merge-base "$origin_main_ref" "$head_sha")"
fi

ensure_commit() {
  local sha="$1"
  if ! git rev-parse --verify "$sha^{commit}" >/dev/null 2>&1; then
    git fetch --no-tags --depth=1 origin "$sha" || true
  fi
}

ensure_commit "$base_sha"
ensure_commit "$head_sha"

git rev-parse --verify "$base_sha^{commit}" >/dev/null
git rev-parse --verify "$head_sha^{commit}" >/dev/null

add_scope() {
  local name="$1"
  if [ "$scope" = "none" ]; then
    scope="$name"
  else
    case ",$scope," in
      *",$name,"*) ;;
      *) scope="$scope,$name" ;;
    esac
  fi
}

while IFS= read -r file; do
  [ -n "$file" ] || continue

  case "$file" in
    .github/workflows/install-test.yml)
      enable_release_critical
      add_scope workflow
      reason="Install workflow changed"
      ;;
    tests/install/README.md|tests/install/unit/*|tests/install/utils/classify-install-scope.sh)
      enable_unit
      add_scope unit-only
      reason="Install unit/docs scope changed"
      ;;
    install.sh|scripts/setup.sh|scripts/reset-user-2fa.sh|tests/install/e2e/install-script.test.sh)
      enable_unit
      enable_install_script
      add_scope installer
      reason="Installer scope changed"
      ;;
    docker-compose.yml|docker-compose.*.yml|Dockerfile|server/Dockerfile|docker/*)
      enable_unit
      enable_fresh_install
      enable_container_health
      run_reuse_stack=true
      add_scope compose-docker
      reason="Compose or Docker scope changed"
      ;;
    tests/install/e2e/fresh-install.test.sh)
      enable_unit
      enable_fresh_install
      add_scope fresh-install
      reason="Fresh install test changed"
      ;;
    tests/install/e2e/container-health.test.sh)
      enable_unit
      enable_fresh_install
      enable_container_health
      run_reuse_stack=true
      add_scope compose-docker
      reason="Container health test changed"
      ;;
    tests/install/e2e/auth-flow.test.sh)
      enable_unit
      enable_fresh_install
      enable_auth_flow
      run_reuse_stack=true
      add_scope auth-flow
      reason="Auth flow test changed"
      ;;
    server/prisma/*)
      enable_unit
      enable_upgrade_baseline
      add_scope upgrade-baseline
      reason="Prisma migration scope changed"
      ;;
    tests/install/e2e/upgrade-install.test.sh|tests/install/e2e/upgrade-*.test.sh|tests/install/utils/upgrade-*|tests/install/fixtures/upgrade/*)
      enable_unit
      enable_upgrade
      add_scope upgrade
      reason="Upgrade harness or fixture scope changed"
      ;;
    tests/install/utils/helpers.sh)
      enable_unit
      enable_standard_stack
      enable_install_script
      add_scope install-helpers
      reason="Shared install helper changed"
      ;;
  esac
done < <(git diff --name-only "$base_sha" "$head_sha")

emit_outputs
