#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
classifier="$repo_root/scripts/ci/classify-architecture-scope.sh"

assert_scope() {
  local label="$1" expected="$2"
  shift 2
  local actual
  if [ "$#" -eq 0 ]; then
    # CI invokes this test from a heredoc. An empty-input case must not inherit
    # and consume the caller's remaining command stream.
    actual="$(bash "$classifier" </dev/null)"
  else
    actual="$(bash "$classifier" "$@")"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label" >&2
    echo "expected: [$expected]" >&2
    echo "actual:   [$actual]" >&2
    exit 1
  fi
  echo "PASS: $label"
}

assert_scope "core source selects architecture only" \
  $'core=true\ndocs=false' \
  "server/src/index.ts"
assert_scope "diagram-linted README selects architecture only" \
  $'core=true\ndocs=false' \
  "README.md"
assert_scope "dependency-cruiser tsconfig selects architecture only" \
  $'core=true\ndocs=false' \
  "config/tooling/tsconfig.app.json"
assert_scope "wallet lifecycle schema and contract fail closed into both scopes" \
  $'core=true\ndocs=true' \
  "server/prisma/schema.prisma" \
  "server/prisma/migrations/20260822070000_add_incremental_sync_intent/migration.sql" \
  "config/wallet-sync-lifecycle-contract.json"
assert_scope "wallet lifecycle ADR remains a contract input" \
  $'core=true\ndocs=true' \
  "docs/adr/0004-wallet-sync-lifecycle.md"
assert_scope "ownership policy, implementation, tests, and docs select both scopes" \
  $'core=true\ndocs=true' \
  "config/resource-ownership-contract.json" \
  "config/resource-lifecycle-callsites.json" \
  "scripts/ownership/schemas.mjs" \
  "tests/ownership/ownership-core.test.mjs" \
  "docs/adr/0005-resource-ownership-and-cleanup-receipts.md"
assert_scope "docs content selects docs only" \
  $'core=false\ndocs=true' \
  "docs/reference/ci-cd-strategy.md"
assert_scope "docs-site TypeScript remains docs only" \
  $'core=false\ndocs=true' \
  "docs/site/docusaurus.config.ts"
assert_scope "architecture docs select both scopes" \
  $'core=true\ndocs=true' \
  "docs/architecture/containers.md"
assert_scope "published service architecture selects both scopes" \
  $'core=true\ndocs=true' \
  "gateway/ARCHITECTURE.md"
assert_scope "shared workflow controls select both scopes" \
  $'core=true\ndocs=true' \
  ".github/workflows/architecture.yml"
assert_scope "runner lock aggregation selects both scopes" \
  $'core=true\ndocs=true' \
  "scripts/ci/aggregate-runner-locks.sh"
assert_scope "docs timing controls select docs only" \
  $'core=false\ndocs=true' \
  "scripts/ci/record-command-timing.mjs" ".github/ci-performance-budget.json"
assert_scope "multiple paths union their scopes" \
  $'core=true\ndocs=true' \
  "src/App.tsx" "docs/how-to/install.md"
assert_scope "unknown triggered paths fail closed" \
  $'core=true\ndocs=true' \
  "unexpected/new-boundary-policy.toml"
assert_scope "empty diffs fail closed" \
  $'core=true\ndocs=true'

nul_actual="$(printf 'docs/README.md\0server/src/index.ts\0' | bash "$classifier")"
if [ "$nul_actual" != $'core=true\ndocs=true' ]; then
  echo "FAIL: NUL-delimited workflow input unions scopes" >&2
  exit 1
fi
echo "PASS: NUL-delimited workflow input unions scopes"

rename_repo="$(mktemp -d)"
trap 'rm -rf -- "$rename_repo"' EXIT
git -C "$rename_repo" init -q
git -C "$rename_repo" config user.name "CI Scope Test"
git -C "$rename_repo" config user.email "ci-scope@example.invalid"
mkdir -p "$rename_repo/src"
printf 'export const value = true;\n' > "$rename_repo/src/value.ts"
git -C "$rename_repo" add src/value.ts
git -C "$rename_repo" commit -qm "add core source"
mkdir -p "$rename_repo/docs"
git -C "$rename_repo" mv src/value.ts docs/value.md
git -C "$rename_repo" commit -qm "move source to docs"
rename_actual="$(
  git -C "$rename_repo" diff --no-renames --name-only -z HEAD^ HEAD |
    bash "$classifier"
)"
if [ "$rename_actual" != $'core=true\ndocs=true' ]; then
  echo "FAIL: cross-scope renames classify both old and new paths" >&2
  exit 1
fi
echo "PASS: cross-scope renames classify both old and new paths"

echo "classify-architecture-scope regression checks passed"
