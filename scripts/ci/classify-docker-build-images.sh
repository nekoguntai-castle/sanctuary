#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

event_name="$(ci_event_name)"
workflow_sha="$(ci_event_head_sha)"
origin_main_ref="${ORIGIN_MAIN_REF:-origin/main}"

frontend_image=false
backend_image=false
reason='No image-impacting files changed'

emit_outputs() {
  ci_emit_output \
    "frontend_image=$frontend_image" \
    "backend_image=$backend_image" \
    "reason=$reason"
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
    base_sha="$(ci_event_base_sha)"
    head_sha="$(ci_event_head_sha)"
    ;;
  push)
    base_sha="$(ci_event_base_sha)"
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
    public/*)
      # Markdown under public/ is a shipped asset, not repository documentation.
      return 1
      ;;
    *.md|*.mdx)
      return 0
      ;;
  esac
  return 1
}

is_both_image_file() {
  case "$1" in
    .github/workflows/docker-build.yml|.dockerignore|package.json|package-lock.json|shared/*|docker-compose.yml|docker/compose/*)
      return 0
      ;;
  esac
  return 1
}

is_frontend_image_file() {
  case "$1" in
    src/*|public/*)
      return 0
      ;;
    docker/frontend/Dockerfile|config/tooling/tsconfig*.json|config/tooling/vite*.ts)
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
    gateway/package.json|server/Dockerfile|server/package.json|server/package-lock.json|server/prisma/*|server/prisma.config.ts|server/tsconfig*.json|server/scripts/*|server/src/*)
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
