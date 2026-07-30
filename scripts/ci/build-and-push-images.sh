#!/usr/bin/env bash
#
# Build and push Sanctuary prebuilt core container images to GHCR.
#
# Inputs (env):
#   IMAGE_REGISTRY     default ghcr.io/nekoguntai-castle
#   IMAGE_TAG          required (e.g. v0.8.53). MUST start with 'v'.
#   IMAGE_PLATFORMS    default linux/amd64,linux/arm64
#   IMAGES             default "frontend backend" - space-separated core subset
#   PUSH               default "true"; set "false" for build-only dry-run
#   DIST_DIR           default <repo>/dist
#   IMAGE_SOURCE       default public GitHub mirror URL
#   IMAGE_REVISION     default current git commit
#
# Outputs (under DIST_DIR):
#   image-digests-<tag>.json - { "frontend": "sha256:...", "backend": "sha256:..." }
#   image-build-summary-<tag>.txt - human-readable log
#
# Auth: caller must have already run `docker login` against the registry.
#
# Failure semantics:
#   - First image failure aborts the run; later images are not attempted.
#     Re-running on the same tag re-pushes the same content (Dockerfiles +
#     source SHA are immutable for a tag), so partial recovery is idempotent.
#   - The downstream notify-umbrel job MUST gate on this job's success;
#     a partial digests file would write nonsense to sanctuary-umbrel.
#
# Prebuilt image inventory is intentionally limited to the web core.
# Gateway and llm-egress-proxy are distributed through source compose
# builds and offline bundles.
#
# Image-to-Dockerfile mapping (locked):
#   frontend -> Dockerfile          (context: repo root)
#   backend  -> server/Dockerfile   (context: repo root, so build can copy shared/)
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/nekoguntai-castle}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG must be set, e.g. v0.8.53}"
IMAGE_PLATFORMS="${IMAGE_PLATFORMS:-linux/amd64,linux/arm64}"
IMAGES="${IMAGES:-frontend backend}"
PUSH="${PUSH:-true}"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"
IMAGE_SOURCE="${IMAGE_SOURCE:-https://github.com/nekoguntai-castle/sanctuary}"
IMAGE_REVISION="${IMAGE_REVISION:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"

if [ "$PUSH" != "true" ] && [ "$PUSH" != "false" ]; then
  echo "::error::PUSH must be either 'true' or 'false' (got '$PUSH')." >&2
  exit 2
fi

if [[ ! "$IMAGE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
  echo "::error::IMAGE_TAG must be a v-prefixed semantic version (got '$IMAGE_TAG')." >&2
  exit 2
fi

if [ "$PUSH" = "true" ] && [[ ! "$IMAGE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Pre-release tags may only be used with PUSH=false; published tags must be stable." >&2
  exit 2
fi

DIGEST_FILE="$DIST_DIR/image-digests-${IMAGE_TAG}.json"
SUMMARY_FILE="$DIST_DIR/image-build-summary-${IMAGE_TAG}.txt"
mkdir -p "$DIST_DIR"
printf '{}' > "$DIGEST_FILE"
: > "$SUMMARY_FILE"

dockerfile_for() {
  case "$1" in
    frontend) echo "Dockerfile" ;;
    backend)  echo "server/Dockerfile" ;;
    *)
      echo "::error::Unknown image '$1' - update build-and-push-images.sh to map it to a Dockerfile." >&2
      return 1
      ;;
  esac
}

build_one() {
  local image="$1"
  local dockerfile
  if ! dockerfile="$(dockerfile_for "$image")"; then
    return 1
  fi
  local repo_image="${IMAGE_REGISTRY}/sanctuary-${image}"
  local fq_tag="${repo_image}:${IMAGE_TAG}"

  printf '\n=== build %s (platforms=%s, push=%s) ===\n' "$fq_tag" "$IMAGE_PLATFORMS" "$PUSH" \
    | tee -a "$SUMMARY_FILE"

  local start_ts end_ts
  start_ts=$(date -u +%s)

  local output_args=()
  if [ "$PUSH" = "true" ]; then
    output_args+=(--push)
  else
    output_args+=(--output=type=cacheonly)
  fi

  # Registry-based BuildKit cache. arm64 cross-build via QEMU is
  # ~3-5x slower than amd64-only; without a layer cache, every release
  # rebuilds from scratch and risks the 180-min job timeout. Pushing
  # cache to a dedicated `:cache-${image}` tag in the same registry
  # repo lets the next release reuse most layers, turning a 60-90min
  # first build into a ~10-15min incremental.
  #
  # Cache export is best-effort so a registry cache failure cannot
  # cancel an otherwise valid image push.
  local cache_ref="${repo_image}:cache-${image}"
  output_args+=(--cache-from="type=registry,ref=${cache_ref}")
  if [ "$PUSH" = "true" ]; then
    output_args+=(--cache-to="type=registry,ref=${cache_ref},mode=max,ignore-error=true")
  fi

  # Build context is always the repo root. shared/ lives there and the
  # backend Dockerfile copies it.
  if ! docker buildx build \
      --platform "$IMAGE_PLATFORMS" \
      --tag "$fq_tag" \
      --label "org.opencontainers.image.source=$IMAGE_SOURCE" \
      --label "org.opencontainers.image.version=$IMAGE_TAG" \
      --label "org.opencontainers.image.revision=$IMAGE_REVISION" \
      "${output_args[@]}" \
      -f "$ROOT_DIR/$dockerfile" \
      "$ROOT_DIR" 2>&1 | tee -a "$SUMMARY_FILE"; then
    echo "::error::buildx failed for $image" | tee -a "$SUMMARY_FILE"
    return 1
  fi

  if [ "$PUSH" = "true" ]; then
    local digest
    digest=$(docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$fq_tag" 2>/dev/null || true)
    if [ -z "$digest" ] || [ "$digest" = "<no value>" ]; then
      echo "::error::could not resolve manifest digest for $fq_tag" | tee -a "$SUMMARY_FILE"
      return 1
    fi
    if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      echo "::error::digest for $fq_tag is not a sha256:<64hex> value: $digest" | tee -a "$SUMMARY_FILE"
      return 1
    fi
    # Atomic-ish update: read+modify+write in one jq call against a temp.
    local tmp
    tmp=$(mktemp)
    jq --arg img "$image" --arg d "$digest" '. + {($img): $d}' "$DIGEST_FILE" > "$tmp"
    mv "$tmp" "$DIGEST_FILE"
    echo "  pushed digest: $digest" | tee -a "$SUMMARY_FILE"
  else
    echo "  (PUSH=false, skipping digest capture)" | tee -a "$SUMMARY_FILE"
  fi

  end_ts=$(date -u +%s)
  printf '  elapsed: %ss\n' "$((end_ts - start_ts))" | tee -a "$SUMMARY_FILE"
}

main() {
  printf 'IMAGE_REGISTRY=%s\nIMAGE_TAG=%s\nIMAGE_PLATFORMS=%s\nIMAGES=%s\nPUSH=%s\nIMAGE_SOURCE=%s\nIMAGE_REVISION=%s\n\n' \
    "$IMAGE_REGISTRY" "$IMAGE_TAG" "$IMAGE_PLATFORMS" "$IMAGES" "$PUSH" "$IMAGE_SOURCE" "$IMAGE_REVISION" \
    | tee -a "$SUMMARY_FILE"

  for image in $IMAGES; do
    if ! build_one "$image"; then
      printf '\n::error::abort - %s failed; later images skipped.\n' "$image" | tee -a "$SUMMARY_FILE"
      printf 'Partial digest manifest at %s\n' "$DIGEST_FILE" | tee -a "$SUMMARY_FILE"
      exit 1
    fi
  done

  if [ "$PUSH" = "true" ]; then
    printf '\n=== all images published ===\n' | tee -a "$SUMMARY_FILE"
  else
    printf '\n=== all dry-run builds completed ===\n' | tee -a "$SUMMARY_FILE"
  fi
  cat "$DIGEST_FILE"
}

main "$@"
