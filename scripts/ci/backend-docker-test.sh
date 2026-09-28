#!/usr/bin/env bash
# Prepared, serial backend scopes; all generated files stay in the test image.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
mode="${1:-full}"
case "$mode" in prepare-only|full|integration|unit-coverage) ;; *) echo 'Invalid backend test mode' >&2; exit 2 ;; esac

require_inputs() {
  local file
  for file in package.json package-lock.json server/package.json server/vitest.config.ts \
    server/tsconfig.json server/prisma/schema.prisma shared/package.json \
    config/hardware-physical-evidence-trust.json src/hooks/send/useUsbSigning.ts \
    scripts/ci/prepare-integration-db.sh scripts/ci/backend-integration-groups.sh; do
    test -f "$ROOT/$file" || { echo "Missing backend test input: $file" >&2; return 1; }
  done
  for file in vitest prisma tsc; do
    test -x "$ROOT/node_modules/.bin/$file" || { echo "Missing installed binary: $file" >&2; return 1; }
  done
}

prepare_git() {
  local objects="${SANCTUARY_BACKEND_GIT_OBJECTS:-/git-objects}" sha="${SANCTUARY_BACKEND_SOURCE_SHA:?}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ && -d "$objects" ]] || return 1
  test ! -s "$objects/info/alternates" || { echo 'External object alternates are not admitted' >&2; return 1; }
  test ! -e "$ROOT/.git" || { echo 'Test image must not contain Git metadata' >&2; return 1; }
  git init -q "$ROOT"
  printf '%s\n' "$objects" > "$ROOT/.git/objects/info/alternates"
  git -C "$ROOT" cat-file -e "$sha^{commit}"
  git -C "$ROOT" update-ref HEAD "$sha"
}

prepare() {
  require_inputs
  prepare_git
  export PATH="$ROOT/node_modules/.bin:$PATH"
  cd "$ROOT"
  npm --workspace shared run build
  cd "$ROOT/server"
  prisma generate
  vitest list --filesOnly > "$output/discovery.txt"
  test -s "$output/discovery.txt" || { echo 'No backend tests discovered' >&2; return 1; }
  bash "$SCRIPT_DIR/prepare-integration-db.sh"
}

run_junit_scope() {
  local phase=$1
  shift
  vitest run "$@" --no-file-parallelism --maxWorkers=1 \
    --outputFile.junit="$output/junit-${phase}.xml"
}

run_grouped_scope() {
  local listed spec
  local -a destructive_specs main_scope=() exclusions=()
  bash "$SCRIPT_DIR/backend-integration-groups.sh" --check || return $?
  listed=$(bash "$SCRIPT_DIR/backend-integration-groups.sh" ops-destructive) || return $?
  [[ -n "$listed" ]] || { echo 'Empty destructive integration group' >&2; return 1; }
  mapfile -t destructive_specs <<< "$listed"
  for spec in "${destructive_specs[@]}"; do
    [[ -n "$spec" && -f "$ROOT/server/$spec" ]] || {
      echo "Invalid destructive integration spec: $spec" >&2; return 1;
    }
    exclusions+=(--exclude "$spec")
  done
  [[ "$mode" != integration ]] || main_scope=(tests/integration)
  run_junit_scope main "${main_scope[@]}" "${exclusions[@]}" || return $?
  bash "$SCRIPT_DIR/prepare-integration-db.sh" || return $?
  run_junit_scope ops-destructive "${destructive_specs[@]}"
}

run_scope() {
  case "$mode" in
    prepare-only) return ;;
    full|integration) run_grouped_scope ;;
    unit-coverage) vitest run --coverage tests/unit --no-file-parallelism --maxWorkers=1 ;;
  esac
}

output="${SANCTUARY_BACKEND_TEST_OUTPUT:-/test-output}"
[[ ! -L "$output" && -d "$output" && -w "$output" ]]
output_identity=$(stat -c '%d:%i:%u:%g' -- "$output")
[[ "$output_identity" =~ ^[0-9]+:[0-9]+:[0-9]+:[0-9]+$ ]]
output_owner="${output_identity#*:*:}"

same_output_root() {
  local current
  [[ ! -L "$output" && -d "$output" ]] || return 1
  current=$(stat -c '%d:%i:%u:%g' -- "$output") || return $?
  [[ "$current" == "$output_identity" ]]
}

retain_reports() {
  local status=$1 copy_status=0
  same_output_root || { echo 'Output root identity changed; refusing report retention' >&2; return 1; }
  if [[ -f "$ROOT/server/junit.xml" ]]; then cp "$ROOT/server/junit.xml" "$output/" || copy_status=$?; fi
  if [[ -d "$ROOT/server/coverage" ]]; then cp -R "$ROOT/server/coverage" "$output/" || copy_status=$?; fi
  printf '%s\n' "$status" > "$output/exit-status.txt" || copy_status=$?
  return "$copy_status"
}

normalize_output_owner() {
  same_output_root || { echo 'Output root identity changed; refusing ownership normalization' >&2; return 1; }
  # BusyBox -hR changes symlinks themselves and never traverses their targets.
  chown -hR "$output_owner" -- "$output"
}

# Preserve scope failure, then retention failure, then normalization failure.
finish() {
  local status=$? copy_status=0 owner_status=0
  trap - EXIT
  retain_reports "$status" || copy_status=$?
  normalize_output_owner || owner_status=$?
  [[ "$status" -ne 0 ]] && exit "$status"
  [[ "$copy_status" -ne 0 ]] && exit "$copy_status"
  exit "$owner_status"
}
trap finish EXIT
prepare
run_scope 2>&1 | tee "$output/test.log"
