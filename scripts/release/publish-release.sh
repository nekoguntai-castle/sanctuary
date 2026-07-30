#!/usr/bin/env bash
#
# Trusted operator release command. Forgejo remains the CI authority; this
# command copies an already-tested stable tag to GitHub, publishes GHCR images,
# verifies their registry digests, creates Forgejo/GitHub Release objects, and
# only then dispatches the local sanctuary-umbrel updater.
#
# Usage:
#   scripts/release/publish-release.sh v0.8.57
#   scripts/release/publish-release.sh v0.8.57-rc.1 --dry-run
#
# Configuration is read from SANCTUARY_RELEASE_CONFIG (default:
# ~/.config/sanctuary/forge-tokens.env) and/or the environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="${SANCTUARY_IMAGE_BUILD_SCRIPT:-$ROOT_DIR/scripts/ci/build-and-push-images.sh}"
VERIFY_SCRIPT="${SANCTUARY_RELEASE_VERIFY_SCRIPT:-$SCRIPT_DIR/verify-release-artifacts.sh}"
CREATE_RELEASE_SCRIPT="${SANCTUARY_CREATE_RELEASE_SCRIPT:-$ROOT_DIR/scripts/create-forge-release.sh}"

TAG=""
DRY_RUN=false
TEMP_DIR=""
DOCKER_CONFIG_DIR=""
BUILDER_NAME=""
GHCR_LOGGED_IN=false

usage() {
  cat <<'EOF'
Usage: scripts/release/publish-release.sh <tag> [--dry-run]

Real publication accepts stable vX.Y.Z tags only. --dry-run also accepts
prerelease tags and performs the build without registry or API mutations.
EOF
}

fail() {
  echo "release publication failed: $*" >&2
  exit 1
}

# shellcheck source=scripts/release/release-operator-api.sh
source "$SCRIPT_DIR/release-operator-api.sh"

parse_args() {
  if [[ $# -lt 1 || $# -gt 2 ]]; then
    usage >&2
    exit 2
  fi
  TAG="$1"
  if [[ $# -eq 2 ]]; then
    [[ "$2" == "--dry-run" ]] || { usage >&2; exit 2; }
    DRY_RUN=true
  fi

  [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] \
    || fail "tag must be a v-prefixed semantic version"
  if [[ "$DRY_RUN" == "false" && ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    fail "only stable tags may be published; use --dry-run for prereleases"
  fi
}

load_config() {
  local config_file="${SANCTUARY_RELEASE_CONFIG:-${HOME}/.config/sanctuary/forge-tokens.env}"
  if [[ -f "$config_file" ]]; then
    # shellcheck disable=SC1090
    source "$config_file"
  fi

  FORGEJO_URL="${FORGEJO_URL:-}"
  FORGEJO_OWNER="${FORGEJO_OWNER:-nekoguntai-castle}"
  FORGEJO_REPO="${FORGEJO_REPO:-sanctuary}"
  FORGEJO_TOKEN="${FORGEJO_TOKEN:-}"
  GITHUB_API_URL="${GITHUB_API_URL:-https://api.github.com}"
  GITHUB_OWNER="${GITHUB_OWNER:-nekoguntai-castle}"
  GITHUB_REPO="${GITHUB_REPO:-sanctuary}"
  GITHUB_RELEASE_TOKEN="${GITHUB_RELEASE_TOKEN:-}"
  GHCR_USER="${GHCR_USER:-}"
  GHCR_TOKEN="${GHCR_TOKEN:-}"
  UMBREL_DISPATCH_TOKEN="${UMBREL_DISPATCH_TOKEN:-}"
  UMBREL_OWNER="${UMBREL_OWNER:-nekoguntai-castle}"
  UMBREL_REPO="${UMBREL_REPO:-sanctuary-umbrel}"

  require_values FORGEJO_URL FORGEJO_OWNER FORGEJO_REPO FORGEJO_TOKEN
  if [[ "$DRY_RUN" == "false" ]]; then
    require_values GITHUB_API_URL GITHUB_OWNER GITHUB_REPO GITHUB_RELEASE_TOKEN \
      GHCR_USER GHCR_TOKEN UMBREL_DISPATCH_TOKEN UMBREL_OWNER UMBREL_REPO
  fi
  reject_unsafe_tokens FORGEJO_TOKEN GITHUB_RELEASE_TOKEN UMBREL_DISPATCH_TOKEN
  export -n FORGEJO_TOKEN GITHUB_RELEASE_TOKEN GHCR_TOKEN UMBREL_DISPATCH_TOKEN
}

require_values() {
  local variable
  local missing=()
  for variable in "$@"; do
    [[ -n "${!variable:-}" ]] || missing+=("$variable")
  done
  (( ${#missing[@]} == 0 )) || fail "missing required configuration: ${missing[*]}"
}

reject_unsafe_tokens() {
  local variable
  for variable in "$@"; do
    [[ "${!variable:-}" != *$'\n'* \
      && "${!variable:-}" != *$'\r'* \
      && "${!variable:-}" != *'"'* \
      && "${!variable:-}" != *'\'* ]] \
      || fail "$variable contains a character that is unsafe in an HTTP header"
  done
}

cleanup() {
  local cleanup_status=0
  if [[ "$GHCR_LOGGED_IN" == "true" && -n "$DOCKER_CONFIG_DIR" ]]; then
    if ! DOCKER_CONFIG="$DOCKER_CONFIG_DIR" docker logout ghcr.io >/dev/null 2>&1; then
      echo "release cleanup failed: GHCR logout did not complete" >&2
      cleanup_status=1
    fi
  fi
  if [[ -n "$BUILDER_NAME" ]]; then
    if ! docker buildx rm "$BUILDER_NAME" >/dev/null 2>&1; then
      echo "release cleanup failed: buildx builder $BUILDER_NAME was not removed" >&2
      cleanup_status=1
    fi
  fi
  if [[ -n "$DOCKER_CONFIG_DIR" && -d "$DOCKER_CONFIG_DIR" ]]; then
    if ! find "$DOCKER_CONFIG_DIR" -type f -delete 2>/dev/null \
      || ! find "$DOCKER_CONFIG_DIR" -depth -type d -empty -delete 2>/dev/null; then
      echo "release cleanup failed: temporary Docker credentials were not removed" >&2
      cleanup_status=1
    fi
  fi
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    if ! find "$TEMP_DIR" -type f -delete 2>/dev/null \
      || ! find "$TEMP_DIR" -depth -type d -empty -delete 2>/dev/null; then
      echo "release cleanup failed: temporary release files were not removed" >&2
      cleanup_status=1
    fi
  fi
  return "$cleanup_status"
}

on_exit() {
  local command_status=$?
  trap - EXIT
  if ! cleanup; then
    (( command_status != 0 )) || command_status=1
  fi
  exit "$command_status"
}

validate_checkout() {
  cd "$ROOT_DIR"
  git rev-parse --verify --quiet "refs/tags/${TAG}^{commit}" >/dev/null \
    || fail "local tag $TAG does not exist"

  local tag_commit head_commit
  tag_commit="$(git rev-parse "refs/tags/${TAG}^{commit}")"
  head_commit="$(git rev-parse HEAD)"
  [[ "$head_commit" == "$tag_commit" ]] \
    || fail "checkout must be at $TAG ($tag_commit), got $head_commit"
  [[ -z "$(git status --porcelain)" ]] || fail "release checkout must be clean"
  RELEASE_COMMIT="$tag_commit"
}

setup_builder() {
  BUILDER_NAME="sanctuary-release-${$}"
  docker run --privileged --rm tonistiigi/binfmt:latest --install arm64
  docker buildx create --name "$BUILDER_NAME" --driver docker-container \
    --platform linux/amd64,linux/arm64 --use >/dev/null
  docker buildx inspect --bootstrap >/dev/null
}

login_ghcr() {
  DOCKER_CONFIG_DIR="$TEMP_DIR/docker-config"
  mkdir -m 700 "$DOCKER_CONFIG_DIR"
  printf '%s' "$GHCR_TOKEN" \
    | DOCKER_CONFIG="$DOCKER_CONFIG_DIR" docker login ghcr.io \
      -u "$GHCR_USER" --password-stdin >/dev/null
  GHCR_LOGGED_IN=true
  export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"
}

build_images() {
  local push=true
  [[ "$DRY_RUN" == "false" ]] || push=false
  IMAGE_REGISTRY="ghcr.io/${GITHUB_OWNER}" \
    IMAGE_TAG="$TAG" \
    IMAGE_REVISION="$RELEASE_COMMIT" \
    IMAGES="${RELEASE_IMAGES:-frontend backend}" \
    PUSH="$push" \
    DIST_DIR="$TEMP_DIR/dist" \
    bash "$BUILD_SCRIPT"
}

published_digest() {
  local role="$1"
  local image_ref="ghcr.io/${GITHUB_OWNER}/sanctuary-${role}:${TAG}"
  local error_file="$TEMP_DIR/${role}-lookup-error.txt"
  local digest
  if digest="$(docker buildx imagetools inspect \
    --format '{{.Manifest.Digest}}' "$image_ref" 2>"$error_file")"; then
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || fail "$image_ref returned an invalid published digest"
    echo "$digest"
    return
  fi
  if grep -Eqi 'manifest unknown|not found|no such manifest' "$error_file"; then
    return 1
  fi
  fail "could not safely determine whether $image_ref already exists: $(sed -n '1p' "$error_file")"
}

prepare_image_publication() {
  local role digest
  local missing=()
  local digest_file="$TEMP_DIR/dist/image-digests-${TAG}.json"
  mkdir -p "$TEMP_DIR/dist"
  printf '{}\n' > "$digest_file"

  for role in frontend backend; do
    if digest="$(published_digest "$role")"; then
      jq --arg role "$role" --arg digest "$digest" \
        '. + {($role): $digest}' "$digest_file" > "$TEMP_DIR/digests-next.json"
      mv "$TEMP_DIR/digests-next.json" "$digest_file"
      echo "Reusing immutable published image ghcr.io/${GITHUB_OWNER}/sanctuary-${role}:${TAG}"
    else
      missing+=("$role")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    cp "$digest_file" "$TEMP_DIR/existing-image-digests.json"
    RELEASE_IMAGES="${missing[*]}" build_images
    jq -s '.[0] * .[1]' \
      "$TEMP_DIR/existing-image-digests.json" "$digest_file" \
      > "$TEMP_DIR/digests-next.json"
    mv "$TEMP_DIR/digests-next.json" "$digest_file"
    for role in frontend backend; do
      [[ -n "$(jq -r --arg role "$role" '.[$role] // empty' "$digest_file")" ]] \
        || fail "publication did not produce a digest for $role"
    done
  fi
}

platform_digest() {
  local raw_file="$1"
  local architecture="$2"
  jq -er \
    --arg architecture "$architecture" \
    '[.manifests[]?
      | select(.platform.os == "linux" and .platform.architecture == $architecture)
      | .digest]
      | if length == 1 then .[0] else error("expected exactly one digest") end' \
    "$raw_file"
}

verify_platform_labels() {
  local image="$1"
  local platform_digest="$2"
  local platform="$3"
  local labels
  labels="$(docker buildx imagetools inspect "${image}@${platform_digest}" \
    --format '{{json .Image.Config.Labels}}')" \
    || fail "$image $platform labels could not be inspected"
  jq -e \
    --arg revision "$RELEASE_COMMIT" \
    --arg version "$TAG" \
    --arg source "https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}" \
    '."org.opencontainers.image.revision" == $revision
      and ."org.opencontainers.image.version" == $version
      and ."org.opencontainers.image.source" == $source' \
    <<<"$labels" >/dev/null \
    || fail "$image $platform OCI source/version/revision labels do not match the release"
}

inspect_image() {
  local role="$1"
  local digest_file="$TEMP_DIR/dist/image-digests-${TAG}.json"
  local image="ghcr.io/${GITHUB_OWNER}/sanctuary-${role}"
  local image_ref="${image}:${TAG}"
  local raw_file="$TEMP_DIR/${role}-manifest.json"
  local manifest_digest expected_digest amd64_digest arm64_digest

  expected_digest="$(jq -er --arg role "$role" '.[$role]' "$digest_file")"
  manifest_digest="$(docker buildx imagetools inspect \
    --format '{{.Manifest.Digest}}' "$image_ref")"
  [[ "$manifest_digest" == "$expected_digest" ]] \
    || fail "$image_ref digest changed after publication"
  docker buildx imagetools inspect --raw "$image_ref" > "$raw_file"
  amd64_digest="$(platform_digest "$raw_file" amd64)" \
    || fail "$image_ref does not contain exactly one linux/amd64 image"
  arm64_digest="$(platform_digest "$raw_file" arm64)" \
    || fail "$image_ref does not contain exactly one linux/arm64 image"
  verify_platform_labels "$image" "$amd64_digest" linux/amd64
  verify_platform_labels "$image" "$arm64_digest" linux/arm64

  jq -cn \
    --arg name "sanctuary $role image" \
    --arg image "$image" \
    --arg tag "$TAG" \
    --arg digest "$manifest_digest" \
    --arg amd64 "$amd64_digest" \
    --arg arm64 "$arm64_digest" \
    '{name: $name, type: "container-image", image: $image, tag: $tag,
      digest: $digest, platforms: [
        {platform: "linux/amd64", digest: $amd64},
        {platform: "linux/arm64", digest: $arm64}
      ]}'
}

write_and_verify_image_manifest() {
  local frontend backend manifest="$TEMP_DIR/release-image-manifest.json"
  frontend="$(inspect_image frontend)"
  backend="$(inspect_image backend)"
  jq -n \
    --arg tag "$TAG" \
    --arg version "${TAG#v}" \
    --arg commit "$RELEASE_COMMIT" \
    --argjson frontend "$frontend" \
    --argjson backend "$backend" \
    '{schema: 1, release: {
      tag: $tag, version: $version, commit: $commit, stability: "stable"
    }, artifacts: [$frontend, $backend]}' > "$manifest"
  "$VERIFY_SCRIPT" --manifest "$manifest" --strict-images --verify-image-digests
}

create_release_objects() {
  env -u DOCKER_CONFIG \
    SANCTUARY_FORGE_TOKENS=/dev/null \
    FORGEJO_URL="$FORGEJO_URL" \
    FORGEJO_OWNER="$FORGEJO_OWNER" \
    FORGEJO_REPO="$FORGEJO_REPO" \
    FORGEJO_TOKEN="$FORGEJO_TOKEN" \
    GITHUB_API_URL="$GITHUB_API_URL" \
    GITHUB_OWNER="$GITHUB_OWNER" \
    GITHUB_REPO="$GITHUB_REPO" \
    GITHUB_RELEASE_TOKEN="$GITHUB_RELEASE_TOKEN" \
    bash "$CREATE_RELEASE_SCRIPT" "$TAG"
}

main() {
  parse_args "$@"
  load_config
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sanctuary-publish-release.XXXXXX")"
  trap on_exit EXIT
  validate_checkout
  verify_forgejo_tag
  verify_forgejo_release_gate

  if [[ "$DRY_RUN" == "true" ]]; then
    setup_builder
    build_images
    echo "Dry run passed for $TAG; no registry or API mutations were performed."
    return
  fi

  verify_github_actions_disabled
  ensure_github_tag
  setup_builder
  login_ghcr
  prepare_image_publication
  write_and_verify_image_manifest
  create_release_objects
  dispatch_umbrel
  echo "Release $TAG published to Forgejo, GitHub, and GHCR; Umbrel dispatch sent."
}

main "$@"
