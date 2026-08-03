#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/tests/install/utils/classify-install-scope.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_exact_output() {
  local output_file="$1"
  local key="$2"
  local expected="$3"
  local actual

  actual="$(sed -n "s/^${key}=//p" "$output_file")"
  [ "$actual" = "$expected" ] || fail "expected ${key}=${expected}, got ${key}=${actual}"
}

create_repo() {
  local repo_dir="$1"

  git init -q "$repo_dir"
  git -C "$repo_dir" config user.name "Codex Test"
  git -C "$repo_dir" config user.email "codex@example.com"
  printf '# Fixture\n' > "$repo_dir/README.md"
  git -C "$repo_dir" add README.md
  git -C "$repo_dir" commit -qm "base"
}

commit_file() {
  local repo_dir="$1"
  local path="$2"
  local content="$3"
  local message="$4"

  mkdir -p "$(dirname "$repo_dir/$path")"
  printf '%s\n' "$content" > "$repo_dir/$path"
  git -C "$repo_dir" add "$path"
  git -C "$repo_dir" commit -qm "$message"
}

run_classifier_for_event() {
  local repo_dir="$1"
  local base_sha="$2"
  local head_sha="$3"
  local output_file="$4"
  local event_name="$5"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME="$event_name"
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    case "$event_name" in
      pull_request)
        export PR_BASE_SHA="$base_sha"
        export PR_HEAD_SHA="$head_sha"
        ;;
      push)
        export PUSH_BEFORE_SHA="$base_sha"
        ;;
    esac
    bash "$CLASSIFIER_SCRIPT"
  )
}

run_classifier() {
  run_classifier_for_event "$1" "$2" "$3" "$4" push
}

assert_scope() {
  local output_file="$1"
  local should_run="$2"
  local run_unit="$3"
  local run_fresh_install="$4"
  local run_install_script="$5"
  local run_container_health="$6"
  local run_auth_flow="$7"
  local run_upgrade="$8"
  local run_upgrade_baseline="$9"
  local run_upgrade_extended="${10}"
  local run_reuse_stack="${11}"

  assert_exact_output "$output_file" "should_run" "$should_run"
  assert_exact_output "$output_file" "run_unit" "$run_unit"
  assert_exact_output "$output_file" "run_fresh_install" "$run_fresh_install"
  assert_exact_output "$output_file" "run_install_script" "$run_install_script"
  assert_exact_output "$output_file" "run_container_health" "$run_container_health"
  assert_exact_output "$output_file" "run_auth_flow" "$run_auth_flow"
  assert_exact_output "$output_file" "run_upgrade" "$run_upgrade"
  assert_exact_output "$output_file" "run_upgrade_baseline" "$run_upgrade_baseline"
  assert_exact_output "$output_file" "run_upgrade_extended" "$run_upgrade_extended"
  assert_exact_output "$output_file" "run_reuse_stack" "$run_reuse_stack"
}

assert_release_critical_scope() {
  local output_file="$1"
  assert_scope "$output_file" "true" "true" "true" "true" "true" "true" "true" "true" "true" "true"
}

assert_release_smoke_scope() {
  local output_file="$1"
  assert_scope "$output_file" "true" "true" "true" "true" "true" "true" "false" "false" "false" "true"
  assert_upgrade_selection "$output_file" "" ""
}

assert_upgrade_selection() {
  local output_file="$1"
  local expected_baseline_refs="$2"
  local expected_extended_fixtures="$3"

  assert_exact_output "$output_file" "upgrade_baseline_refs" "$expected_baseline_refs"
  assert_exact_output "$output_file" "upgrade_extended_fixtures" "$expected_extended_fixtures"
}

assert_static_workflow_scope() {
  local output_file="$1"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"
  assert_exact_output "$output_file" "scope" "workflow-static"
}

assert_unit_only_scope() {
  local output_file="$1"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"
  assert_exact_output "$output_file" "scope" "unit-only"
  assert_upgrade_selection "$output_file" "" ""
}

workflow_variant() {
  local variant="${1:-base}"
  local permission=read
  local concurrency_group=install-tests
  local run_line='echo unit'

  case "$variant" in
    permission)
      permission=write
      ;;
    concurrency)
      concurrency_group=install-tests-changed
      ;;
    run-change)
      run_line='echo changed'
      ;;
  esac

  cat <<'EOF'
name: Install Tests

EOF

  if [ "$variant" = comment ]; then
    echo '# Workflow-only comment.'
  fi

  cat <<'EOF'
on:
  push:
    branches:
      - main
EOF

  if [ "$variant" = path-filter ]; then
    cat <<'EOF'
    paths:
      - install.sh
EOF
  fi

  if [ "$variant" = blank ]; then
    echo
  fi

  cat <<EOF

permissions:
  contents: $permission

concurrency:
  group: $concurrency_group
  cancel-in-progress: false

jobs:
  unit-tests:
    name: Install Script Unit Tests
    runs-on: ubuntu-latest
    steps:
EOF

  if [ "$variant" = uses ]; then
    echo '      - uses: actions/checkout@v4'
  fi

  cat <<'EOF'
      - name: Run unit tests
        run: |
EOF

  if [ "$variant" = run-comment ]; then
    echo '          # shell comment inside executable run block'
  fi

  echo "          $run_line"
}

commit_workflow_variant() {
  local repo_dir="$1"
  local message="$2"
  local variant="${3:-base}"

  mkdir -p "$repo_dir/.github/workflows"
  workflow_variant "$variant" > "$repo_dir/.github/workflows/install-test.yml"
  git -C "$repo_dir" add .github/workflows/install-test.yml
  git -C "$repo_dir" commit -qm "$message"
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha

  unset GITHUB_REF GITHUB_EVENT_NAME GITHUB_SHA \
    WORKFLOW_INPUT_TEST_SUITE WORKFLOW_INPUT_UPGRADE_FIXTURE WORKFLOW_INPUT_UPGRADE_SOURCE_REF \
    PR_BASE_SHA PR_HEAD_SHA

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  commit_file "$repo_dir" "docs/install.md" "# docs" "irrelevant docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "false" "false" "false" "false" "false" "false" "false" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/README.md" "# install docs" "install docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "false" "false" "false" "false" "false" "false" "false" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/utils/README.md" "# utility docs" "install utility docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "false" "false" "false" "false" "false" "false" "false" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/utils/classify-install-workflow-diff.sh" "#!/usr/bin/env bash" "workflow diff helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "install.sh" "#!/usr/bin/env bash" "installer"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "true" "false" "false" "false" "false" "false" "false"
  assert_upgrade_selection "$output_file" "" ""
  run_classifier_for_event "$repo_dir" "$base_sha" "$head_sha" "$output_file" pull_request
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"
  assert_exact_output "$output_file" "scope" "installer,upgrade-deferred,docker-e2e-deferred"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/offline/apply-bundle.sh" "#!/usr/bin/env bash" "offline bundle"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "true" "false" "false" "false" "false" "false" "false"
  assert_upgrade_selection "$output_file" "" ""

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/ci/with-runner-lock.sh" "#!/usr/bin/env bash" "install CI helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/ci/wait-for-docker.sh" "#!/usr/bin/env bash" "docker readiness helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/ci/run-extended-upgrade-fixtures.sh" "#!/usr/bin/env bash" "upgrade fixture helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"
  assert_upgrade_selection "$output_file" "" ""

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker-compose.yml" "services: {}" "compose"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "true" "false" "true" "false" "false" "false" "false" "true"
  run_classifier_for_event "$repo_dir" "$base_sha" "$head_sha" "$output_file" pull_request
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"
  assert_exact_output "$output_file" "scope" "compose-docker,docker-e2e-deferred"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker/compose/monitoring.yml" "services: {}" "compose overlay"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "true" "false" "true" "false" "false" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/e2e/auth-flow.test.sh" "echo auth" "auth"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "true" "false" "false" "true" "false" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "server/prisma/schema.prisma" "datasource db {}" "migration"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "true" "false" "false" "false" "false" "false" "false" "false"
  assert_upgrade_selection "$output_file" "" ""

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/e2e/upgrade-install.test.sh" "echo upgrade" "upgrade harness"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"
  assert_upgrade_selection "$output_file" "" ""

  base_sha="$head_sha"
  commit_file "$repo_dir" "tests/install/fixtures/upgrade/browser-origin-ip.sh" "echo fixture" "upgrade fixture file"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "false" "false" "false" "false" "false" "false" "false" "false"
  assert_upgrade_selection "$output_file" "" ""

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow base" base
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  commit_workflow_variant "$repo_dir" "install workflow comment" comment
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_static_workflow_scope "$output_file"
  assert_exact_output "$output_file" "reason" "Install workflow static-only change"

  run_classifier_for_event "$repo_dir" "$base_sha" "$head_sha" "$output_file" pull_request
  assert_static_workflow_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow blank line" blank
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_static_workflow_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow run-block comment" run-comment
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow run block" run-change
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow uses" uses
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow permissions" permission
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow concurrency" concurrency
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow path filter" path-filter
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  git -C "$repo_dir" rm -q .github/workflows/install-test.yml
  git -C "$repo_dir" commit -qm "delete install workflow"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_release_smoke_scope "$output_file"

  base_sha="$head_sha"
  commit_workflow_variant "$repo_dir" "install workflow reset base" base
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  commit_workflow_variant "$repo_dir" "install workflow static again" comment
  commit_file "$repo_dir" "server/prisma/20260513000000_example/migration.sql" "select 1;" "migration plus workflow"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_scope "$output_file" "true" "true" "true" "false" "false" "false" "false" "false" "false" "false"
  assert_upgrade_selection "$output_file" "" ""

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=workflow_dispatch
    export WORKFLOW_INPUT_TEST_SUITE=all
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_scope "$output_file" "true" "true" "true" "true" "true" "true" "true" "true" "true" "true"
  assert_upgrade_selection "$output_file" \
    "latest-stable,n-2" \
    "browser-origin-ip,legacy-runtime-env,notification-delivery,optional-profiles"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=workflow_dispatch
    export WORKFLOW_INPUT_TEST_SUITE=upgrade
    export WORKFLOW_INPUT_UPGRADE_FIXTURE=baseline
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_scope "$output_file" "true" "false" "false" "false" "false" "false" "true" "true" "false" "false"
  assert_upgrade_selection "$output_file" "latest-stable,n-2" ""

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=workflow_dispatch
    export WORKFLOW_INPUT_TEST_SUITE=upgrade
    export WORKFLOW_INPUT_UPGRADE_FIXTURE=optional-profiles
    export WORKFLOW_INPUT_UPGRADE_SOURCE_REF=release/v0.8.39
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_scope "$output_file" "true" "false" "false" "false" "false" "false" "true" "true" "true" "false"
  assert_upgrade_selection "$output_file" "release/v0.8.39" "optional-profiles"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=workflow_dispatch
    export WORKFLOW_INPUT_TEST_SUITE=upgrade
    export WORKFLOW_INPUT_UPGRADE_FIXTURE=not-a-fixture
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    if bash "$CLASSIFIER_SCRIPT"; then
      fail "invalid manual upgrade fixture should fail classification"
    fi
  )

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=push
    export GITHUB_REF=refs/tags/v0.9.0
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_exact_output "$output_file" "is_release" "true"
  assert_exact_output "$output_file" "test_suite" "release-critical"
  assert_release_critical_scope "$output_file"
  assert_upgrade_selection "$output_file" \
    "latest-stable,n-2" \
    "browser-origin-ip,legacy-runtime-env,notification-delivery,optional-profiles"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=schedule
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_exact_output "$output_file" "test_suite" "unit"
  assert_unit_only_scope "$output_file"

  echo "install scope classifier regression checks passed"
}

main "$@"
