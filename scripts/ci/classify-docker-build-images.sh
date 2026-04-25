#!/usr/bin/env bash
set -euo pipefail

output_file="${GITHUB_OUTPUT:-/dev/stdout}"
event_name="${EVENT_NAME:-${GITHUB_EVENT_NAME:-}}"
workflow_sha="${WORKFLOW_SHA:-${GITHUB_SHA:-HEAD}}"
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"

frontend_image=false
backend_image=false
reason='No image-impacting files changed'

emit_outputs() {
  {
    echo "frontend_image=$frontend_image"
    echo "backend_image=$backend_image"
    echo "reason=$reason"
  } >> "$output_file"
}

mark_both_images() {
  frontend_image=true
  backend_image=true
}

if [ "$event_name" = "workflow_dispatch" ]; then
  mark_both_images
  reason='Manual dispatch builds all dev images'
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
    mark_both_images
    reason="Unrecognized event builds all dev images: $event_name"
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

is_docs_only_file() {
  case "$1" in
    *.md|*.mdx)
      return 0
      ;;
  esac
  return 1
}

is_both_image_file() {
  case "$1" in
    .github/workflows/docker-build.yml|.dockerignore|shared/*|docker-compose.yml|docker-compose.*.yml)
      return 0
      ;;
  esac
  return 1
}

is_frontend_image_file() {
  case "$1" in
    App.tsx|index.html|index.tsx|src/*|components/*|contexts/*|hooks/*|providers/*|services/*|themes/*|utils/*|Dockerfile|package.json|package-lock.json|tsconfig*.json|vite*.ts)
      return 0
      ;;
    docker/nginx/nginx.conf|docker/nginx/default.conf.template|docker/nginx/default-ssl.conf.template|docker/nginx/docker-entrypoint.sh)
      return 0
      ;;
  esac
  return 1
}

is_backend_image_file() {
  case "$1" in
    server/Dockerfile|server/package.json|server/package-lock.json|server/prisma/*|server/prisma.config.ts|server/tsconfig*.json|server/scripts/*|server/src/*)
      return 0
      ;;
  esac
  return 1
}

while IFS= read -r file; do
  [ -n "$file" ] || continue

  if is_docs_only_file "$file"; then
    continue
  fi

  if is_both_image_file "$file"; then
    mark_both_images
    reason="Shared image input changed: $file"
    continue
  fi

  if is_frontend_image_file "$file"; then
    frontend_image=true
    reason="Image input changed"
  fi

  if is_backend_image_file "$file"; then
    backend_image=true
    reason="Image input changed"
  fi
done < <(git diff --name-only "$base_sha" "$head_sha")

emit_outputs
