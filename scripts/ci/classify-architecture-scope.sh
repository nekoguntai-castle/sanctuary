#!/usr/bin/env bash
set -euo pipefail

core=false
docs=false
saw_path=false

classify_path() {
  local path="$1"
  saw_path=true

  case "$path" in
    docs/architecture/* | docs/adr/0004-wallet-sync-lifecycle.md | \
      docs/adr/0005-resource-ownership-and-cleanup-receipts.md | \
      docs/reference/resource-ownership-cleanup.md | \
      config/resource-ownership-contract.json | \
      config/resource-lifecycle-callsites.json | \
      scripts/ownership/* | tests/ownership/* | \
      ARCHITECTURE.md | */ARCHITECTURE.md)
      core=true
      docs=true
      ;;
    docs/* | .github/CONTRIBUTING.md | \
      scripts/ci/time-command.sh | \
      scripts/ci/record-command-timing.mjs | \
      .github/ci-performance-budget.json)
      docs=true
      ;;
    .github/workflows/architecture.yml | \
      scripts/ci/classify-architecture-scope.sh | \
      scripts/ci/create-isolated-workspace.sh | \
      scripts/ci/retry-command.sh | \
      scripts/ci/run-with-log.sh | \
      scripts/ci/redactor.sh | \
      scripts/ci/provider-context.sh | \
      scripts/ci/with-runner-lock.sh | \
      scripts/ci/aggregate-runner-locks.sh | \
      scripts/ci/write-diagnostic-summary.sh)
      core=true
      docs=true
      ;;
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | \
      config/tooling/dependency-cruiser.cjs | \
      server/.dependency-cruiser.cjs | \
      gateway/.dependency-cruiser.cjs | \
      config/tooling/tsconfig.app.json | \
      server/tsconfig.json | \
      gateway/tsconfig.json | \
      scripts/architecture/* | \
      scripts/quality/architecture-boundary-exceptions.json | \
      scripts/quality/server-cycle-baseline.json | \
      package.json | package-lock.json | server/package.json | README.md)
      core=true
      ;;
    *)
      # Workflow path filters should keep unrelated files out. If they ever
      # drift, fail closed by validating both scopes instead of silently
      # classifying a newly relevant path as harmless.
      core=true
      docs=true
      ;;
  esac
}

if [ "$#" -gt 0 ]; then
  for path in "$@"; do
    classify_path "$path"
  done
else
  while IFS= read -r -d '' path; do
    classify_path "$path"
  done
fi

if [ "$saw_path" = false ]; then
  core=true
  docs=true
fi

printf 'core=%s\ndocs=%s\n' "$core" "$docs"
