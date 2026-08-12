#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLASSIFIER_SCRIPT="$ROOT_DIR/scripts/ci/classify-docker-build-images.sh"

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

run_classifier() {
  local repo_dir="$1"
  local base_sha="$2"
  local head_sha="$3"
  local output_file="$4"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=push
    export GITHUB_OUTPUT="$output_file"
    export PUSH_BEFORE_SHA="$base_sha"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
}

assert_images() {
  local output_file="$1"
  local frontend="$2"
  local backend="$3"
  local grafana_migration="${4:-false}"
  local gateway="${5:-false}"
  local llm_egress_proxy="${6:-false}"

  assert_exact_output "$output_file" "frontend_image" "$frontend"
  assert_exact_output "$output_file" "backend_image" "$backend"
  assert_exact_output "$output_file" "gateway_image" "$gateway"
  assert_exact_output "$output_file" "llm_egress_proxy_image" "$llm_egress_proxy"
  assert_exact_output "$output_file" "grafana_migration_image" "$grafana_migration"
}

main() {
  local temp_dir repo_dir output_file base_sha head_sha

  grep -Fxq '!src/public/**/*.md' "$ROOT_DIR/.dockerignore" \
    || fail "public Markdown assets must be included in the frontend Docker context"

  temp_dir="$(mktemp -d)"
  trap 'rm -rf "'"$temp_dir"'"' EXIT
  repo_dir="$temp_dir/repo"
  output_file="$temp_dir/output"

  create_repo "$repo_dir"
  base_sha="$(git -C "$repo_dir" rev-parse HEAD)"

  commit_file "$repo_dir" "src/components/WalletList.tsx" "export const WalletList = () => null;" "frontend component"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "server/src/index.ts" "export const server = true;" "backend source"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "shared/schemas/wallet.ts" "export const wallet = true;" "shared schema"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker/grafana-migration/Dockerfile" "FROM grafana/grafana:10.2.0" "Grafana migration dockerfile"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/ops/grafana-quiescence-records.sh" "#!/bin/bash" "Grafana control records"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "config/container-image-lock.json" '{"schemaVersion":1}' "Runtime image lock"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "true" "true" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/ci/validate-docker-build-results.sh" "#!/bin/bash" "Docker result validator"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/ops/migrate-grafana-password.sh" "#!/bin/sh" "Grafana migration payload"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/ops/run-grafana-password-migration.sh" "#!/bin/bash" "Grafana migration wrapper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker/compose/monitoring.yml" "services: {}" "monitoring compose"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "true" "true" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "scripts/offline/bundle-common.sh" "MIGRATION_IMAGE=local" "offline migration inventory"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker/nginx/nginx.conf" "events {}" "nginx config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker/frontend/Dockerfile" "FROM scratch" "frontend dockerfile"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "package.json" '{"scripts":{"check:quality":"node scripts/check.js"}}' "root package script"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "package-lock.json" '{"lockfileVersion":3}' "root package lock"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker/compose/prod.yml" "services: {}" "compose overlay"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "false" "true" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "src/public/favicon.svg" "<svg />" "public asset"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "src/public/help.md" "# Product help" "public markdown asset"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "src/public/guide.mdx" "# Product guide" "public mdx asset"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "src/types/wallet.ts" "export type Wallet = {};" "frontend type"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "src/index.html" '<script type="module" src="/main.tsx"></script>' "frontend html entry"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "shared/types/ambient-modules.d.ts" "declare const __BUILD__: string;" "shared ambient types"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "config/tooling/vite.nodePolyfills.ts" "export const polyfills = [];" "vite helper"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "server/Dockerfile" "FROM scratch" "backend dockerfile"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "gateway/package.json" '{"type":"module"}' "gateway package metadata"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "true" "false" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" ".dockerignore" "node_modules" "dockerignore"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "true" "true" "true" "true"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docker/monitoring/prometheus.yml" "global: {}" "monitoring config"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docs/reference/changelog.md" "# Release notes" "release notes"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "docs/guide.mdx" "# Internal guide" "docs mdx"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false"

  base_sha="$head_sha"
  commit_file "$repo_dir" "server/README.md" "# server docs" "server docs"
  head_sha="$(git -C "$repo_dir" rev-parse HEAD)"
  run_classifier "$repo_dir" "$base_sha" "$head_sha" "$output_file"
  assert_images "$output_file" "false" "false"

  : > "$output_file"
  (
    cd "$repo_dir"
    export EVENT_NAME=workflow_dispatch
    export GITHUB_OUTPUT="$output_file"
    export WORKFLOW_SHA="$head_sha"
    bash "$CLASSIFIER_SCRIPT"
  )
  assert_images "$output_file" "true" "true" "true" "true" "true"

  echo "docker image scope classifier regression checks passed"
}

main "$@"
