#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WORKSPACE="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"
ORIGINAL_WORKSPACE="${SANCTUARY_CI_ORIGINAL_WORKSPACE:?original workspace is required}"
DIAGNOSTIC_DIR="$ORIGINAL_WORKSPACE/.tmp/ci-diagnostics/architecture"
CORE_SCOPE="${SANCTUARY_ARCHITECTURE_CORE_SCOPE:-false}"
DOCS_SCOPE="${SANCTUARY_ARCHITECTURE_DOCS_SCOPE:-false}"

is_boolean() { [[ ${1:-} == true || ${1:-} == false ]]; }

run_logged() {
  local log_name=$1
  shift
  "$SCRIPT_DIR/run-with-log.sh" "$DIAGNOSTIC_DIR/$log_name.log" "$@"
}

run_locked_retry() {
  local log_name=$1 retry_label=$2
  shift 2
  run_logged "$log_name" "$SCRIPT_DIR/with-runner-lock.sh" node-toolchain \
    "$SCRIPT_DIR/retry-command.sh" "$retry_label" "$@"
}

collect_failure_diagnostics() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    set +e
    git diff -- docs/architecture/generated > "$DIAGNOSTIC_DIR/full-diff.txt" 2>&1
    local graph source
    for graph in frontend server gateway; do
      source="docs/architecture/generated/${graph}.md"
      [[ ! -f $source ]] || cp "$source" "$DIAGNOSTIC_DIR/${graph}.regenerated.md"
    done
    {
      ls -la "$DIAGNOSTIC_DIR" 2>&1
      echo '---'
      node --version
      npm --version
      uname -a
      pwd
    } > "$DIAGNOSTIC_DIR/env.txt" 2>&1
  fi
  exit "$status"
}

run_core_checks() {
  run_locked_retry install-dependencies 'root npm ci' npm ci --strict-allow-scripts \
    --audit=false --fund=false --cache "$WORKSPACE/.npm-cache/root"
  run_logged lint-diagrams npm run arch:lint
  run_logged runtime-boundaries npm run check:architecture-boundaries
  run_logged wallet-sync-lifecycle-contract npm run check:wallet-sync-lifecycle-contract
  run_logged wallet-sync-mutation-boundaries bash -euo pipefail -c \
    'npm run check:wallet-sync-mutation-boundaries && node --test tests/ci/check-wallet-sync-mutation-boundaries.test.mjs'
  run_logged resource-ownership-contract bash -euo pipefail -c \
    'npm run check:resource-ownership-contract && npm run test:ownership'
  run_logged prisma-imports npm --workspace server run check:prisma-imports
  run_logged server-cycle-baseline npm run check:server-cycle-baseline
  if [[ $(ci_event_name) == pull_request ]]; then
    node scripts/architecture/detect-drift.mjs "${SANCTUARY_ARCHITECTURE_BASE_SHA:?base SHA is required}"
  fi
  run_locked_retry dependency-graphs 'architecture dependency graphs' npm run arch:graphs
  run_locked_retry call-graphs 'architecture call graphs' npm run arch:calls
  run_logged stale-generated-graphs bash -euo pipefail -c '
    if ! git diff --exit-code -- docs/architecture/generated; then
      echo "::error::Generated architecture graphs are stale. Run npm run arch:graphs and npm run arch:calls locally and commit the result."
      git diff -- docs/architecture/generated/ | head -300
      exit 1
    fi
  '
}

run_docs_checks() {
  run_locked_retry install-docs-dependencies 'docs-site npm ci' npm --prefix docs/site ci --strict-allow-scripts \
    --audit=false --fund=false --cache "$WORKSPACE/.npm-cache/docs-site"
  SANCTUARY_RETRY_ATTEMPTS=5 run_locked_retry docs-typecheck 'docs typecheck' \
    "$SCRIPT_DIR/time-command.sh" 'docs typecheck' npm --prefix docs/site run typecheck
  run_locked_retry docs-build 'docs build' npm --prefix docs/site run build
}

main() {
  is_boolean "$CORE_SCOPE" || { echo 'core scope must be true or false' >&2; return 2; }
  is_boolean "$DOCS_SCOPE" || { echo 'docs scope must be true or false' >&2; return 2; }
  mkdir -p "$DIAGNOSTIC_DIR"
  cd "$WORKSPACE"
  trap collect_failure_diagnostics EXIT
  [[ $CORE_SCOPE != true ]] || run_core_checks
  [[ $DOCS_SCOPE != true ]] || run_docs_checks
}

main "$@"
