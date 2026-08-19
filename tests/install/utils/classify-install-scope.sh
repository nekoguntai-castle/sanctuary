#!/usr/bin/env bash
set -euo pipefail

output_file="${GITHUB_OUTPUT:-/dev/stdout}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tests/install/utils/upgrade-selection.sh
. "$script_dir/upgrade-selection.sh"

event_name="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
workflow_sha="${WORKFLOW_SHA:-${GITHUB_SHA:-HEAD}}"
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"
github_ref="${GITHUB_REF:-}"
input_test_suite="${WORKFLOW_INPUT_TEST_SUITE:-}"
input_upgrade_fixture="${WORKFLOW_INPUT_UPGRADE_FIXTURE:-all}"
input_upgrade_source_ref="${WORKFLOW_INPUT_UPGRADE_SOURCE_REF:-}"
workflow_diff_classifier="${INSTALL_WORKFLOW_DIFF_CLASSIFIER:-$script_dir/classify-install-workflow-diff.sh}"
default_upgrade_baseline_refs="$(upgrade_default_baseline_refs)"
default_upgrade_extended_fixtures="$(upgrade_active_extended_fixtures_csv)"

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
upgrade_baseline_refs=''
upgrade_extended_fixtures=''
upgrade_baseline_refs_set=false
upgrade_extended_fixtures_set=false
upgrade_harness_touched=false
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
    echo "upgrade_baseline_refs=$upgrade_baseline_refs"
    echo "upgrade_extended_fixtures=$upgrade_extended_fixtures"
    echo "scope=$scope"
    echo "reason=$reason"
  } >> "$output_file"
}

set_upgrade_baseline_refs() {
  upgrade_baseline_refs="$1"
  upgrade_baseline_refs_set=true
}

set_upgrade_extended_fixtures() {
  upgrade_extended_fixtures="$1"
  upgrade_extended_fixtures_set=true
}

ensure_upgrade_baseline_refs() {
  if [ "$upgrade_baseline_refs_set" != "true" ]; then
    set_upgrade_baseline_refs "$default_upgrade_baseline_refs"
  fi
}

ensure_upgrade_extended_fixtures() {
  if [ "$upgrade_extended_fixtures_set" != "true" ]; then
    set_upgrade_extended_fixtures "$default_upgrade_extended_fixtures"
  fi
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
  ensure_upgrade_baseline_refs
}

enable_upgrade_extended() {
  should_run=true
  run_upgrade=true
  run_upgrade_extended=true
  ensure_upgrade_extended_fixtures
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

selected_manual_baseline_refs() {
  if [ -n "$input_upgrade_source_ref" ]; then
    if ! upgrade_validate_source_selector "$input_upgrade_source_ref"; then
      echo "Unsupported upgrade_source_ref: $input_upgrade_source_ref" >&2
      exit 1
    fi
    printf '%s\n' "$input_upgrade_source_ref"
    return 0
  fi

  printf '%s\n' "$default_upgrade_baseline_refs"
}

apply_manual_upgrade_selection() {
  local fixture_selection="${input_upgrade_fixture:-all}"
  local baseline_refs

  baseline_refs="$(selected_manual_baseline_refs)"

  case "$fixture_selection" in
    all)
      set_upgrade_baseline_refs "$baseline_refs"
      set_upgrade_extended_fixtures "$default_upgrade_extended_fixtures"
      enable_upgrade
      ;;
    baseline)
      set_upgrade_baseline_refs "$baseline_refs"
      set_upgrade_extended_fixtures ''
      enable_upgrade_baseline
      ;;
    *)
      if ! upgrade_validate_extended_fixture_selection "$fixture_selection"; then
        exit 1
      fi
      set_upgrade_baseline_refs "$baseline_refs"
      set_upgrade_extended_fixtures "$fixture_selection"
      enable_upgrade
      ;;
  esac
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
      apply_manual_upgrade_selection
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
      apply_manual_upgrade_selection
      scope=upgrade
      ;;
    release-critical)
      enable_unit
      enable_standard_stack
      enable_install_script
      apply_manual_upgrade_selection
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
  test_suite=unit
  reason="Scheduled install heartbeat; upgrade E2E reserved for release tags or manual dispatch"
  scope=unit-only
  enable_unit
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

classify_install_workflow_change() {
  local classification

  if ! classification="$(bash "$workflow_diff_classifier" "$base_sha" "$head_sha" 2>/dev/null)"; then
    classification=unknown
  fi

  case "$classification" in
    static)
      enable_unit
      add_scope workflow-static
      reason="Install workflow static-only change"
      ;;
    behavioral)
      enable_release_critical
      add_scope workflow
      reason="Install workflow behavioral change"
      ;;
    *)
      enable_release_critical
      add_scope workflow
      reason="Install workflow changed; unknown diff uses release-critical scope"
      ;;
  esac
}

# Baseline sources for the PR-scoped upgrade run. The release gate still uses
# upgrade_default_baseline_refs (latest-stable,n-2); a PR runs one source, which
# exercises the same code path for roughly half the wall-clock.
PR_UPGRADE_BASELINE_REFS='latest-stable'

defer_automatic_upgrade_e2e() {
  if [ "$run_upgrade" != "true" ]; then
    return 0
  fi

  # A pull request that changes the upgrade harness runs the baseline lane.
  #
  # This used to defer on *every* event -- unlike defer_pull_request_docker_e2e
  # below, it never looked at event_name -- so the upgrade lanes were reachable
  # only from a release tag or a manual dispatch. That meant #657's stale-
  # completion protection and the #658 gate guarding it were proven for the
  # first time during a release, which is the worst moment to learn either is
  # broken: #723 went green on all three required checks while executing none
  # of the code it changed.
  #
  # Scoped deliberately:
  #   - only when the diff already enabled the upgrade scope, so an unrelated
  #     install change does not pay for a long lane
  #   - baseline only; the extended fixture matrix stays release-gated
  #   - one source ref rather than two
  if [ "$event_name" = "pull_request" ]; then
    run_upgrade_extended=false
    upgrade_extended_fixtures=''
    set_upgrade_baseline_refs "$PR_UPGRADE_BASELINE_REFS"
    add_scope upgrade-baseline-pr
    reason="${reason}; upgrade baseline runs on this PR because it changes the upgrade harness"
    return 0
  fi

  run_upgrade=false
  run_upgrade_baseline=false
  run_upgrade_extended=false
  upgrade_baseline_refs=''
  upgrade_extended_fixtures=''
  add_scope upgrade-deferred
  reason="${reason}; upgrade E2E reserved for release tags or manual dispatch"
}

# Baseline sources for the PR-scoped upgrade run. The release gate still uses
# upgrade_default_baseline_refs (latest-stable,n-2); a PR runs one source, which
# exercises the same code path for roughly half the wall-clock.
PR_UPGRADE_BASELINE_REFS='latest-stable'

# Re-enable a bounded upgrade baseline for pull requests that change the upgrade
# harness. Runs *after* defer_automatic_upgrade_e2e rather than special-casing
# it, so the deferral stays one rule ("not automatic") and this stays another
# ("except for PRs that change the thing under test").
#
# The lanes used to be unreachable from a PR entirely: the deferral above never
# looked at event_name, and upgrade-baseline-test carried a hardcoded
# `github.event_name != 'pull_request'`. So #657's stale-completion protection
# and the #658 gate guarding it were first exercised during a release. #723
# changed tests/install/utils/upgrade-* and went green on all three required
# checks having executed none of it.
enable_pr_upgrade_baseline_for_harness_changes() {
  [ "$event_name" = "pull_request" ] || return 0
  [ "$upgrade_harness_touched" = "true" ] || return 0

  enable_upgrade_baseline
  set_upgrade_baseline_refs "$PR_UPGRADE_BASELINE_REFS"
  run_upgrade_extended=false
  upgrade_extended_fixtures=''
  add_scope upgrade-baseline-pr
  reason="${reason}; upgrade baseline runs on this PR because it changes the upgrade harness"
}

defer_pull_request_docker_e2e() {
  if [ "$event_name" != "pull_request" ]; then
    return 0
  fi

  if [ "$run_fresh_install" != "true" ] &&
     [ "$run_install_script" != "true" ] &&
     [ "$run_container_health" != "true" ] &&
     [ "$run_auth_flow" != "true" ] &&
     [ "$run_reuse_stack" != "true" ]; then
    return 0
  fi

  run_fresh_install=false
  run_install_script=false
  run_container_health=false
  run_auth_flow=false
  run_reuse_stack=false
  add_scope docker-e2e-deferred
  reason="${reason}; Docker-backed install E2E reserved for release tags, non-PR pushes, or manual dispatch"
}

while IFS= read -r file; do
  [ -n "$file" ] || continue

  # Anything that can change how the upgrade lane behaves: the shared helpers,
  # the e2e specs, the upgrade fixtures, and the classifier that gates the lane
  # itself. tests/install/unit/* is excluded deliberately -- those are
  # self-contained and cannot alter the lane.
  case "$file" in
    *.md|*.mdx)
      ;;
    tests/install/utils/*|tests/install/e2e/*|tests/install/fixtures/upgrade/*)
      upgrade_harness_touched=true
      ;;
  esac

  case "$file" in
    *.md|*.mdx)
      ;;
    .github/workflows/install-test.yml)
      classify_install_workflow_change
      ;;
    tests/install/unit/*|tests/install/utils/classify-install-scope.sh|tests/install/utils/classify-install-workflow-diff.sh)
      enable_unit
      add_scope unit-only
      reason="Install unit/docs scope changed"
      ;;
    start.sh)
      enable_unit
      enable_standard_stack
      add_scope runtime-entrypoint
      reason="Runtime entrypoint changed"
      ;;
    scripts/ops/migrate-grafana-password.sh|scripts/ops/run-grafana-password-migration.sh|scripts/ops/grafana-quiescence-records.sh)
      enable_unit
      add_scope grafana-migration
      reason="Grafana migration helper changed"
      ;;
    install.sh|scripts/setup.sh|scripts/reset-user-2fa.sh|scripts/create-upgrade-backup.sh|scripts/offline/*|scripts/offline/**/*|tests/install/e2e/install-script.test.sh)
      enable_unit
      enable_install_script
      enable_upgrade_baseline
      add_scope installer
      reason="Installer scope changed"
      ;;
    scripts/ci/create-isolated-workspace.sh|scripts/ci/install-test-ports.sh|scripts/ci/run-in-isolated-workspace.sh|scripts/ci/wait-for-docker.sh|scripts/ci/with-runner-lock.sh)
      enable_unit
      enable_standard_stack
      enable_install_script
      enable_upgrade
      add_scope install-ci-helper
      reason="Install CI helper changed"
      ;;
    scripts/ci/run-extended-upgrade-fixtures.sh)
      enable_unit
      enable_upgrade
      add_scope upgrade
      reason="Upgrade CI helper changed"
      ;;
    docker-compose.yml|docker/compose/*|docker/frontend/Dockerfile|server/Dockerfile|docker/*)
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
      enable_fresh_install
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

defer_automatic_upgrade_e2e
enable_pr_upgrade_baseline_for_harness_changes
defer_pull_request_docker_e2e
emit_outputs
