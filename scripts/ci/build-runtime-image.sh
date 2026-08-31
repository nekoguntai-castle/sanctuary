#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/provider-context.sh"

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 ROLE DOCKERFILE CONTEXT IMAGE" >&2
  exit 2
fi

role="$1"
dockerfile="$2"
context="$3"
image="$4"
source_commit="${GITHUB_SHA:-$(git rev-parse HEAD)}"
image_lock='config/container-image-lock.json'

if ! printf '%s' "$source_commit" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "build-runtime-image: source commit must be a full lowercase SHA" >&2
  exit 1
fi

image_lock_sha256="$(sha256sum "$image_lock" | cut -d ' ' -f 1)"
build_version="$(node -p 'require("./package.json").version')"
build_id="$(ci_run_id)-$(ci_run_attempt)-$role"
cache_args=()
if [ "${SANCTUARY_IMAGE_CACHE:-true}" = true ]; then
  cache_args+=(--cache-from "type=gha,scope=$role")
  cache_args+=(--cache-to "type=gha,mode=max,scope=$role,ignore-error=true")
fi

docker buildx build \
  --file "$dockerfile" \
  --load \
  --tag "$image" \
  --build-arg "SANCTUARY_SOURCE_COMMIT=$source_commit" \
  --build-arg "SANCTUARY_IMAGE_LOCK_SHA256=$image_lock_sha256" \
  --build-arg "SANCTUARY_BUILD_VERSION=$build_version" \
  --build-arg "SANCTUARY_BUILD_ID=$build_id" \
  "${cache_args[@]}" \
  "$context"

node scripts/ci/write-runtime-image-evidence.mjs \
  --role "$role" \
  --image "$image" \
  --commit "$source_commit" \
  --image-lock "$image_lock" \
  --output-dir "${SANCTUARY_IMAGE_EVIDENCE_DIR:-.tmp/runtime-image-evidence}/$role"
