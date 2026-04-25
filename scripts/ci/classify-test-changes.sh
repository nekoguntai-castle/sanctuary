#!/usr/bin/env bash
set -euo pipefail

output_file="${GITHUB_OUTPUT:-/dev/stdout}"
event_name="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
workflow_sha="${WORKFLOW_SHA:-${GITHUB_SHA:-HEAD}}"
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"

full_scan=false
test_suite_changed=false
frontend_changed=false
backend_changed=false
critical_mutation_changed=false
gateway_changed=false
e2e_changed=false
browser_smoke_changed=false
render_changed=false
build_changed=false

frontend_files=''
backend_files=''
critical_mutation_files=''
gateway_files=''
test_files=''

append_file() {
  local var_name="$1"
  local file="$2"
  local current_value="${!var_name}"

  if [ -z "$current_value" ]; then
    printf -v "$var_name" '%s' "$file"
  else
    printf -v "$var_name" '%s %s' "$current_value" "$file"
  fi
}

emit_outputs() {
  {
    echo "full_scan=$full_scan"
    echo "test_suite_changed=$test_suite_changed"
    echo "frontend_changed=$frontend_changed"
    echo "frontend_files=$frontend_files"
    echo "backend_changed=$backend_changed"
    echo "backend_files=$backend_files"
    echo "critical_mutation_changed=$critical_mutation_changed"
    echo "critical_mutation_files=$critical_mutation_files"
    echo "gateway_changed=$gateway_changed"
    echo "gateway_files=$gateway_files"
    echo "e2e_changed=$e2e_changed"
    echo "browser_smoke_changed=$browser_smoke_changed"
    echo "render_changed=$render_changed"
    echo "build_changed=$build_changed"
    echo "test_files=$test_files"
  } >> "$output_file"
}

mark_full_scan() {
  full_scan=true
  frontend_changed=true
  backend_changed=true
  critical_mutation_changed=true
  gateway_changed=true
  e2e_changed=true
  browser_smoke_changed=true
  render_changed=true
  build_changed=true
}

if [ "$event_name" = "schedule" ] || [ "$event_name" = "workflow_dispatch" ]; then
  mark_full_scan
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
  merge_group)
    base_sha="${MERGE_GROUP_BASE_SHA:-}"
    head_sha="${MERGE_GROUP_HEAD_SHA:-$workflow_sha}"
    ;;
  push)
    base_sha="${PUSH_BEFORE_SHA:-}"
    head_sha="$workflow_sha"
    if [ "$base_sha" = "$zero_sha" ]; then
      base_sha="$(git rev-list --max-parents=0 "$head_sha")"
    fi
    ;;
  *)
    mark_full_scan
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

is_frontend_file() {
  case "$1" in
    App.tsx|index.html|index.tsx|src/*|components/*|hooks/*|contexts/*|providers/*|services/*|themes/*|utils/*|shared/*|vitest.config.ts|vitest.coverage-shard.config.ts|scripts/ci/frontend-coverage-*.sh|package.json|package-lock.json|tests/*.ts|tests/*.tsx|tests/*.mts|tests/*.cts|tests/*.js|tests/*.jsx|tests/*.mjs|tests/*.cjs|tests/*.json)
      return 0
      ;;
  esac
  return 1
}

is_backend_file() {
  case "$1" in
    server/*)
      return 0
      ;;
  esac
  return 1
}

is_critical_mutation_file() {
  case "$1" in
    server/src/services/bitcoin/addressDerivation.ts|server/src/services/bitcoin/addressDerivation/*|server/src/services/bitcoin/psbtValidation.ts|server/src/services/bitcoin/psbtInfo.ts|server/src/middleware/auth.ts|server/src/services/accessControl.ts|server/tests/unit/services/bitcoin/addressDerivation.verified.test.ts|server/tests/unit/services/bitcoin/psbt.verified.test.ts|server/tests/unit/services/bitcoin/psbtValidation.test.ts|server/tests/unit/services/bitcoin/psbtInfo.test.ts|server/tests/unit/middleware/auth.test.ts|server/tests/unit/services/accessControl.test.ts|server/stryker.critical.config.mjs|server/scripts/mutation/*|.github/mutation-baseline.json)
      return 0
      ;;
  esac
  return 1
}

is_gateway_file() {
  case "$1" in
    gateway/*)
      return 0
      ;;
  esac
  return 1
}

is_e2e_file() {
  case "$1" in
    e2e/*|playwright.config.ts)
      return 0
      ;;
  esac
  return 1
}

is_browser_smoke_file() {
  case "$1" in
    App.tsx|index.tsx|index.html|playwright.config.ts)
      return 0
      ;;
    src/app/*|src/api/*|components/Layout/*|components/Login/*|components/DraftList/*|components/AuditLogs/*|components/Monitoring/*|components/WalletDetail/*)
      return 0
      ;;
    e2e/*)
      case "$1" in
        e2e/render-regression.spec.ts|e2e/render-regression/*|e2e/render-regression.spec.ts-snapshots/*)
          return 1
          ;;
      esac
      return 0
      ;;
    server/src/api/*|server/src/routes.ts|server/src/index.ts|server/prisma/*)
      return 0
      ;;
    server/src/middleware/auth.ts|server/src/middleware/csrf.ts|server/src/middleware/corsOrigin.ts|server/src/middleware/bodyParsing.ts|server/src/middleware/validate.ts)
      return 0
      ;;
  esac
  return 1
}

is_render_file() {
  case "$1" in
    App.tsx|index.tsx|index.html|package.json|package-lock.json|playwright.config.ts)
      return 0
      ;;
    src/app/*|components/*|hooks/*|contexts/*|providers/*|themes/*|utils/*)
      return 0
      ;;
    e2e/render-regression.spec.ts|e2e/render-regression/*|e2e/render-regression.spec.ts-snapshots/*)
      return 0
      ;;
  esac
  return 1
}

is_build_file() {
  case "$1" in
    package.json|package-lock.json|server/package.json|server/package-lock.json)
      return 0
      ;;
    Dockerfile|server/Dockerfile|vite.config.*|tsconfig*.json|server/tsconfig*.json)
      return 0
      ;;
    App.tsx|index.tsx|index.html|server/src/index.ts|server/prisma/*)
      return 0
      ;;
  esac
  return 1
}

is_test_file() {
  case "$1" in
    tests/*.test.ts|tests/*.test.tsx|tests/*.spec.ts|tests/*.spec.tsx|server/tests/*.test.ts|server/tests/*.spec.ts|gateway/tests/*.test.ts|gateway/tests/*.spec.ts|e2e/*.spec.ts)
      return 0
      ;;
  esac
  return 1
}

is_test_suite_file() {
  case "$1" in
    .github/workflows/test.yml|scripts/ci/backend-integration-groups.sh|scripts/ci/browser-e2e-groups.sh)
      return 0
      ;;
  esac
  return 1
}

while IFS= read -r file; do
  [ -n "$file" ] || continue

  if is_test_suite_file "$file"; then
    test_suite_changed=true
    browser_smoke_changed=true
    render_changed=true
    build_changed=true
  fi

  if is_frontend_file "$file"; then
    frontend_changed=true
    append_file frontend_files "$file"
  fi

  if is_backend_file "$file"; then
    backend_changed=true
    append_file backend_files "$file"
  fi

  if is_critical_mutation_file "$file"; then
    critical_mutation_changed=true
    append_file critical_mutation_files "$file"
  fi

  if is_gateway_file "$file"; then
    gateway_changed=true
    append_file gateway_files "$file"
  fi

  if is_e2e_file "$file"; then
    e2e_changed=true
  fi

  if is_browser_smoke_file "$file"; then
    browser_smoke_changed=true
  fi

  if is_render_file "$file"; then
    render_changed=true
  fi

  if is_build_file "$file"; then
    build_changed=true
  fi

  if is_test_file "$file"; then
    append_file test_files "$file"
  fi
done < <(git diff --name-only "$base_sha" "$head_sha")

emit_outputs
