#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/scripts/ci/classify-quality-scope.sh"

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

assert_quality_scope() {
  local output_file="$1"
  local repo="$2"
  local source="$3"
  local dependency="$4"
  local workflow="$5"
  local classifier="$6"

  assert_exact_output "$output_file" "run_repo_quality" "$repo"
  assert_exact_output "$output_file" "run_source_quality" "$source"
  assert_exact_output "$output_file" "run_dependency_audit" "$dependency"
  assert_exact_output "$output_file" "run_workflow_quality" "$workflow"
  assert_exact_output "$output_file" "run_ci_classifier_tests" "$classifier"
}

# The lifecycle callsite gate has its own output because the scanner covers
# nearly every source file, while the classifier suites stay narrowly gated.
assert_lifecycle_scope() {
  assert_exact_output "$1" "run_lifecycle_callsites" "$2"
}

create_repo() {
  local repo_dir="$1"

  git init -q "$repo_dir"
  git -C "$repo_dir" config user.name "Codex Test"
  git -C "$repo_dir" config user.email "codex@example.com"
  # The fixture creates enough commits to trip runner-specific auto-maintenance
  # thresholds. Keep cleanup deterministic by preventing detached Git writers
  # from racing the EXIT trap inside .git/objects.
  git -C "$repo_dir" config gc.auto 0
  git -C "$repo_dir" config gc.autoDetach false
  git -C "$repo_dir" config maintenance.auto false
  git -C "$repo_dir" config maintenance.autoDetach false
  printf '{ "name": "fixture" }\n' > "$repo_dir/package.json"
  git -C "$repo_dir" add package.json
  git -C "$repo_dir" commit -qm "base"
}

run_classifier() {
  local repo_dir="$1"
  local base_sha="$2"
  local head_sha="$3"
  local output_file="$4"
  local event_name="${5:-push}"
  local include_base_sha="${6:-true}"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME="$event_name"
    export GITHUB_OUTPUT="$output_file"
    export MERGE_GROUP_BASE_SHA="$base_sha"
    export MERGE_GROUP_HEAD_SHA="$head_sha"
    if [ "$include_base_sha" = true ]; then
      export PUSH_BEFORE_SHA="$base_sha"
      export PR_BASE_SHA="$base_sha"
    else
      unset PUSH_BEFORE_SHA PR_BASE_SHA MERGE_GROUP_BASE_SHA
    fi
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
}

commit_file() {
  local repo_dir="$1"
  local path="$2"
  local content="$3"
  local message="$4"

  mkdir -p "$repo_dir/$(dirname "$path")"
  printf '%s\n' "$content" > "$repo_dir/$path"
  git -C "$repo_dir" add "$path"
  git -C "$repo_dir" commit -qm "$message"
}

classify_commit() {
  local repo_dir="$1"
  local base_sha="$2"
  local output_file="$3"
  local path="$4"
  local content="$5"
  local message="$6"
  local repo="$7"
  local source="$8"
  local dependency="$9"
  local workflow="${10}"
  local classifier="${11}"
  local head_sha

  commit_file "$repo_dir" "$path" "$content" "$message"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" "$repo" "$source" "$dependency" "$workflow" "$classifier"
  printf '%s\n' "$head_sha"
}

# D-11.18 static guard: the gate, backup and pre-commit scripts that the
# ci-classifier-tests suites exercise. Tokens are kept only when, after
# stripping trailing punctuation, they are tracked regular files, so directory
# tokens (scripts/quality/) and untracked temp-tree files are dropped.
CLASSIFIER_SUBJECT_SUITES=(
  tests/ci/jscpd-only.test.sh
  tests/ci/check-lockfile-peer-resolution.test.sh
  tests/ci/quality-lizard-bootstrap.test.sh
  tests/ci/quality-audit.test.sh
  tests/ci/sanctuary-backup.test.sh
  tests/ci/pre-commit-agent-gate.test.sh
)
EXPECTED_CLASSIFIER_SUBJECTS="scripts/ops/install-sanctuary-backup.sh
scripts/ops/sanctuary-backup.sh
scripts/quality.sh
scripts/quality/check-lockfile-peer-resolution.sh
scripts/quality/jscpd-only.sh
scripts/quality/lizard-only.sh
server/.husky/pre-commit"

# Reads candidate path tokens on stdin and prints, sorted and unique, those
# that are tracked regular files once trailing punctuation is stripped.
filter_tracked_subjects() {
  local token
  sed -E 's#[.,:;)/]+$##' | LC_ALL=C sort -u | while IFS= read -r token; do
    if [ -f "$ROOT_DIR/$token" ] && git -C "$ROOT_DIR" ls-files --error-unmatch -- "$token" >/dev/null 2>&1; then
      printf '%s\n' "$token"
    fi
  done
}

derive_classifier_subjects() {
  local suite
  for suite in "${CLASSIFIER_SUBJECT_SUITES[@]}"; do
    grep -oE '(scripts/quality[A-Za-z0-9_./-]*|scripts/ops/[A-Za-z0-9_./-]*|server/\.husky/[A-Za-z0-9_./-]*)' \
      "$ROOT_DIR/$suite" || true
  done | filter_tracked_subjects
}

# D-14.C6 static guard: real checkout files read by classifier-only contract
# suites. Tokens anchored on $ROOT_DIR/, $REPO_ROOT/ or readFileSync(' plus
# const x = '<dir>/<file>' literals; kept only when, after stripping trailing
# punctuation, they are tracked regular files (as derive_classifier_subjects).
REAL_INPUT_SUITES=(
  tests/ci/docker-compose-test-contract.test.mjs
  tests/ci/integration-compose-isolation.test.sh
  tests/ci/verify-addresses-repeatable.test.sh
  tests/ci/verify-repeatable-rpc-wait.test.sh
)
EXPECTED_REAL_INPUT_SUBJECTS="docker/compose/test.yml
docker/frontend/Dockerfile
docker/test/backend.Dockerfile
docker/test/backend.Dockerfile.dockerignore
scripts/ci/docker-endpoint-lib.sh
scripts/ci/provider-context.sh
scripts/ownership/producer-hooks.sh
scripts/run-integration-tests.sh
scripts/run-tests.sh
scripts/verify-addresses/docker-compose.yml
scripts/verify-addresses/implementations/go.mod
scripts/verify-addresses/implementations/go.sum
scripts/verify-addresses/verify-repeatable.sh
server/tests/integration/ops/phase2OperationsProof.integration.test.ts"

derive_real_input_subjects() {
  local suite
  for suite in "${REAL_INPUT_SUITES[@]}"; do
    {
      grep -oE '\$(ROOT_DIR|REPO_ROOT)/[A-Za-z0-9_./-]+' "$ROOT_DIR/$suite" | sed -E 's#^\$[A-Z_]+/##' || true
      grep -oE "readFileSync\('[A-Za-z0-9_./-]+'" "$ROOT_DIR/$suite" | sed -E "s#^readFileSync\\('##; s#'\$##" || true
      grep -oE "const [A-Za-z_]+ = '[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+'" "$ROOT_DIR/$suite" | sed -E "s#^[^']*'##; s#'\$##" || true
    }
  done | filter_tracked_subjects
}

# assert_subjects_routed <derive_fn> <expected> <label> <repo_dir> <head_sha> <output_file>
# Checks the derived subjects against the expected list, commits each one in
# the fixture, and fails listing every subject that does not select the
# classifier suites. Prints the new head SHA.
assert_subjects_routed() {
  local derive_fn="$1"
  local expected="$2"
  local label="$3"
  local repo_dir="$4"
  local head_sha="$5"
  local output_file="$6"
  local derived subject base_sha unrouted=""

  derived="$("$derive_fn")"
  [ "$derived" = "$expected" ] ||
    fail "$label subjects drifted; derived:"$'\n'"$derived"
  for subject in $derived; do
    base_sha="$head_sha"
    commit_file "$repo_dir" "$subject" "$label subject" "$label $subject"
    head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
    run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
    [ "$(sed -n 's/^run_ci_classifier_tests=//p' "$output_file")" = true ] || unrouted="$unrouted $subject"
  done
  [ -z "$unrouted" ] || fail "$label subjects do not run ci-classifier-tests:$unrouted"
  printf '%s\n' "$head_sha"
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha entry path expected_source expected_dependency expected_classifier

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "schedule"
  assert_quality_scope "$output_file" true true true true true
  assert_lifecycle_scope "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "workflow_dispatch"
  assert_quality_scope "$output_file" true true true true true
  assert_lifecycle_scope "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "repository_dispatch"
  assert_quality_scope "$output_file" true true true true true
  assert_lifecycle_scope "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "push" false
  assert_quality_scope "$output_file" true true true true true
  assert_lifecycle_scope "$output_file" true

  run_classifier "$repo_dir" "$base_sha" "$base_sha" "$output_file" "pull_request" false
  assert_quality_scope "$output_file" true true true true true
  assert_lifecycle_scope "$output_file" true

  mkdir -p "$repo_dir/docs/images"
  printf '# Docs only\n' > "$repo_dir/README.md"
  printf 'fakepng' > "$repo_dir/docs/images/logo.png"
  git -C "$repo_dir" add README.md docs/images/logo.png
  git -C "$repo_dir" commit -qm "docs only"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" false false false false false
  # README.md documents public commands, so the lifecycle scanner reads it.
  assert_lifecycle_scope "$output_file" true

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .github/workflows/example.yml 'name: Example' 'workflow change' \
    false false false true false)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file" "merge_group"
  assert_quality_scope "$output_file" false false false true false

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .github/workflows/verify-vectors.yml 'name: Verify Bitcoin Vectors' 'vector workflow change' \
    false false false true true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .github/workflows/quality.yml 'name: Code Quality' 'quality workflow change' \
    false true true true true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    scripts/ci/classify-quality-scope.sh 'echo classifier' 'ci classifier change' \
    true true true false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    config/hardware-emulator-source-inventory.json '{"schemaVersion":1}' \
    'hardware emulator source inventory change' true false false false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    server/tests/integration/repositories/maintenanceStatementTimeout.test.ts 'export {};' \
    'server integration spec change' true true false false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    scripts/ownership/schemas.mjs 'export {};' \
    'ownership protocol change' true true false false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    docs/reference/resource-ownership-cleanup.md '# Ownership' \
    'ownership operator contract change' false false false false true)"
  assert_lifecycle_scope "$output_file" false

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    tests/release/release-policy.test.mjs 'export {};' \
    'release policy contract change' true true false false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    docs/reference/release-distribution.md '# Release distribution' \
    'release policy documentation change' false false false false true)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    server/src/example.ts 'export const example = 1;' 'code change' \
    true true false false false)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    package-lock.json '{"lockfileVersion": 3}' 'lockfile change' \
    true true true false false)"

  base_sha="$head_sha"
  commit_file "$repo_dir" src/mixed.ts 'export const mixed = true;' 'mixed source'
  printf '{"name":"fixture","version":"1.0.0"}\n' > "$repo_dir/package.json"
  git -C "$repo_dir" add package.json
  git -C "$repo_dir" commit --amend -qm 'mixed source and manifest'
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" true true true false true

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    fixtures/archive.bin binary 'binary fixture' true false false false false)"
  assert_lifecycle_scope "$output_file" false

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    .gitignore '*.generated.ts' 'root gitignore change' \
    true true false false false)"

  base_sha="$head_sha"
  head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
    server/.gitignore 'generated/' 'nested gitignore change' \
    true true false false false)"

  head_sha="$(assert_subjects_routed derive_classifier_subjects "$EXPECTED_CLASSIFIER_SUBJECTS" \
    'classifier suite' "$repo_dir" "$head_sha" "$output_file")"
  head_sha="$(assert_subjects_routed derive_real_input_subjects "$EXPECTED_REAL_INPUT_SUBJECTS" \
    'real-input suite' "$repo_dir" "$head_sha" "$output_file")"

  for entry in \
    '.github/actions/setup-node-toolchain/action.yml|true|true' \
    '.github/actions/setup-python-toolchain/action.yml|true|false' \
    'scripts/ci/bootstrap-node.sh|true|true' \
    'scripts/ci/ensure-node.sh|true|true' \
    'scripts/ci/ensure-python.sh|true|false' \
    'config/ci-toolchain-lock.json|true|true' \
    'scripts/ci/run-quality-lint.sh|true|false' \
    'scripts/quality.sh|true|false' \
    'scripts/quality/lizard-only.sh|true|false' \
    'scripts/quality/jscpd-only.sh|true|false' \
    'scripts/quality/lizard-requirements.txt|true|false' \
    'config/tooling/jscpd.json|true|false' \
    'scripts/quality/check-lockfile-peer-resolution.sh|false|true' \
    'scripts/quality/lockfile-peer-resolution-allowlist.txt|false|true' \
    'scripts/ci/npm-policy.json|false|true'; do
    IFS='|' read -r path expected_source expected_dependency <<< "$entry"
    expected_classifier=false
    case "$path" in
      scripts/ci/*) expected_classifier=true ;;
      config/ci-toolchain-lock.json) expected_classifier=true ;;
      .github/actions/setup-node-toolchain/action.yml) expected_classifier=true ;;
      # Gate scripts whose fail-closed suites run only in ci-classifier-tests
      # (D-11.18). The allowlist is untracked and optional: creating it runs
      # its suite, and this entry is its only assertion.
      scripts/quality.sh|scripts/quality/lizard-only.sh|scripts/quality/jscpd-only.sh) expected_classifier=true ;;
      scripts/quality/check-lockfile-peer-resolution.sh) expected_classifier=true ;;
      scripts/quality/lockfile-peer-resolution-allowlist.txt) expected_classifier=true ;;
    esac
    base_sha="$head_sha"
    head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
      "$path" tool "classify $path" true "$expected_source" "$expected_dependency" false \
      "$expected_classifier")"
  done

  # The backup and pre-commit scripts run their regression suites.
  for path in scripts/ops/sanctuary-backup.sh scripts/ops/install-sanctuary-backup.sh server/.husky/pre-commit; do
    base_sha="$head_sha"
    head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
      "$path" 'echo subject' "classify $path" true false false false true)"
  done

  # Host and compose sources the lifecycle scanner reads run its gate without
  # running the classifier suites.
  for path in \
    uninstall.sh \
    start.sh \
    scripts/setup.sh \
    docker-compose.yml \
    docker/compose/example.yml \
    scripts/offline/example.sh \
    scripts/ops/example.sh \
    tests/install/unit/x.test.sh; do
    base_sha="$head_sha"
    head_sha="$(classify_commit "$repo_dir" "$base_sha" "$output_file" \
      "$path" 'echo lifecycle' "classify $path" true false false false false)"
    assert_lifecycle_scope "$output_file" true
  done

  # Parity: every path registered in the lifecycle callsite inventory is in the
  # scanner scope the classifier asks about, so an edit to a registered callsite
  # always runs the gate. The module path travels in the environment, as in the
  # classifier, so the scanner's isMainModule guard does not run the full scan.
  LIFECYCLE_SCANNER_MODULE="$ROOT_DIR/scripts/ownership/check-lifecycle-callsites.mjs" \
  LIFECYCLE_REGISTRY="$ROOT_DIR/config/resource-lifecycle-callsites.json" \
    node --input-type=module -e '
      import { readFileSync } from "node:fs";
      import { pathToFileURL } from "node:url";
      const scanner = pathToFileURL(process.env.LIFECYCLE_SCANNER_MODULE).href;
      const { isLifecycleScannedPath } = await import(scanner);
      const { callsites } = JSON.parse(readFileSync(process.env.LIFECYCLE_REGISTRY, "utf8"));
      const rejected = [...new Set(callsites.map((entry) => entry.path))]
        .filter((path) => !isLifecycleScannedPath(path)).sort();
      if (rejected.length > 0) {
        process.stderr.write(`registered lifecycle paths outside the gate scope:\n${rejected.join("\n")}\n`);
        process.exit(1);
      }
    ' || fail "registered lifecycle paths do not run the lifecycle gate"

  base_sha="$head_sha"
  commit_file "$repo_dir" src/renamed.ts 'export const renamed = true;' 'add source before rename'
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  mkdir -p "$repo_dir/docs"
  git -C "$repo_dir" mv src/renamed.ts docs/renamed.md
  git -C "$repo_dir" commit -qm "rename source to docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" true true false false false

  base_sha="$head_sha"
  commit_file "$repo_dir" nested/package-lock.json '{"lockfileVersion":3}' 'add nested lockfile'
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  git -C "$repo_dir" rm -q nested/package-lock.json
  git -C "$repo_dir" commit -qm 'delete nested lockfile'
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_quality_scope "$output_file" true true true false false

  echo "classify-quality-scope regression checks passed"
}

main "$@"
