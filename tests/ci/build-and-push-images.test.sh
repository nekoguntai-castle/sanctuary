#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_SCRIPT="$ROOT_DIR/scripts/ci/build-and-push-images.sh"
COMPOSE_FILE="$ROOT_DIR/docker-compose.ghcr.yml"
TEST_TEMP_DIR=''
STUB_BIN=''
DOCKER_CALLS=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ] && [ -d "$TEST_TEMP_DIR" ]; then
    find "$TEST_TEMP_DIR" -type f -delete
    find "$TEST_TEMP_DIR" -type l -delete
    find "$TEST_TEMP_DIR" -depth -type d -empty -delete
  fi
}

assert_contains() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "expected $file to contain: $expected"
}

assert_not_contains() {
  local file="$1"
  local unexpected="$2"

  if grep -Fq -- "$unexpected" "$file"; then
    fail "expected $file not to contain: $unexpected"
  fi
}

assert_fails_with() {
  local expected="$1"
  shift
  local output_file="$TEST_TEMP_DIR/failure-output"

  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi
  assert_contains "$output_file" "$expected"
}

install_docker_stub() {
  STUB_BIN="$TEST_TEMP_DIR/bin"
  DOCKER_CALLS="$TEST_TEMP_DIR/docker-calls"
  mkdir -p "$STUB_BIN"
  : >"$DOCKER_CALLS"

  cat >"$STUB_BIN/docker" <<'DOCKER_STUB'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$DOCKER_CALLS"
if [ "${1:-} ${2:-} ${3:-}" = "buildx imagetools inspect" ]; then
  printf '%s\n' "${DOCKER_DIGEST:-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"
fi
DOCKER_STUB
  chmod +x "$STUB_BIN/docker"
}

run_build() {
  env \
    PATH="$STUB_BIN:$PATH" \
    DOCKER_CALLS="$DOCKER_CALLS" \
    IMAGE_REVISION=0123456789abcdef0123456789abcdef01234567 \
    "$@"
}

test_validation() {
  local validation_dist="$TEST_TEMP_DIR/validation-dist"

  assert_fails_with 'IMAGE_TAG must be set' \
    run_build DIST_DIR="$validation_dist" bash "$BUILD_SCRIPT"
  assert_fails_with 'must be a v-prefixed semantic version' \
    run_build DIST_DIR="$validation_dist" IMAGE_TAG=0.8.53 PUSH=false bash "$BUILD_SCRIPT"
  assert_fails_with "PUSH must be either 'true' or 'false'" \
    run_build DIST_DIR="$validation_dist" IMAGE_TAG=v0.8.53 PUSH=yes bash "$BUILD_SCRIPT"
  assert_fails_with 'Pre-release tags may only be used with PUSH=false' \
    run_build DIST_DIR="$validation_dist" IMAGE_TAG=v0.8.54-rc.1 PUSH=true bash "$BUILD_SCRIPT"
  assert_fails_with "Unknown image 'gateway'" \
    run_build DIST_DIR="$validation_dist" IMAGE_TAG=v0.8.53 PUSH=false IMAGES=gateway bash "$BUILD_SCRIPT"
}

test_dry_run_defaults_and_labels() {
  local dry_dist="$TEST_TEMP_DIR/dry-dist"
  local dry_summary="$dry_dist/image-build-summary-v0.8.54-rc.1.txt"

  : >"$DOCKER_CALLS"
  run_build \
    DIST_DIR="$dry_dist" \
    IMAGE_TAG=v0.8.54-rc.1 \
    PUSH=false \
    bash "$BUILD_SCRIPT"

  assert_contains "$dry_summary" 'IMAGE_REGISTRY=ghcr.io/nekoguntai-castle'
  assert_contains "$dry_summary" 'IMAGE_PLATFORMS=linux/amd64,linux/arm64'
  assert_contains "$dry_summary" 'IMAGES=frontend backend'
  assert_contains "$DOCKER_CALLS" '--tag ghcr.io/nekoguntai-castle/sanctuary-frontend:v0.8.54-rc.1'
  assert_contains "$DOCKER_CALLS" '--tag ghcr.io/nekoguntai-castle/sanctuary-backend:v0.8.54-rc.1'
  assert_contains "$DOCKER_CALLS" '--platform linux/amd64,linux/arm64'
  assert_contains "$DOCKER_CALLS" '--label org.opencontainers.image.source=https://github.com/nekoguntai-castle/sanctuary'
  assert_contains "$DOCKER_CALLS" '--label org.opencontainers.image.version=v0.8.54-rc.1'
  assert_contains "$DOCKER_CALLS" '--label org.opencontainers.image.revision=0123456789abcdef0123456789abcdef01234567'
  assert_contains "$DOCKER_CALLS" '--output=type=cacheonly'
  assert_contains "$DOCKER_CALLS" '--cache-from=type=registry,ref=ghcr.io/nekoguntai-castle/sanctuary-frontend:cache-frontend'
  assert_not_contains "$DOCKER_CALLS" '--push'
  assert_not_contains "$DOCKER_CALLS" '--cache-to='
  [ "$(cat "$dry_dist/image-digests-v0.8.54-rc.1.json")" = '{}' ] ||
    fail 'dry run should leave an empty digest manifest'
}

test_push_and_digest_paths() {
  local push_dist="$TEST_TEMP_DIR/push-dist"
  local digest='sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  : >"$DOCKER_CALLS"
  DOCKER_DIGEST="$digest" run_build \
    DIST_DIR="$push_dist" \
    IMAGE_TAG=v0.8.54 \
    IMAGES=frontend \
    PUSH=true \
    bash "$BUILD_SCRIPT"

  assert_contains "$DOCKER_CALLS" '--push'
  assert_contains "$DOCKER_CALLS" '--cache-to=type=registry,ref=ghcr.io/nekoguntai-castle/sanctuary-frontend:cache-frontend,mode=max,ignore-error=true'
  [ "$(jq -r '.frontend' "$push_dist/image-digests-v0.8.54.json")" = "$digest" ] ||
    fail 'stable push should record the resolved manifest digest'

  assert_fails_with 'is not a sha256:<64hex> value' \
    run_build \
      DOCKER_DIGEST=sha256:bad \
      DIST_DIR="$TEST_TEMP_DIR/invalid-digest-dist" \
      IMAGE_TAG=v0.8.55 \
      IMAGES=backend \
      PUSH=true \
      bash "$BUILD_SCRIPT"
}

test_compose_defaults() {
  local expected_image_default='${IMAGE_REGISTRY:-ghcr.io/nekoguntai-castle}/sanctuary-'
  local default_count

  default_count="$(grep -Fc "$expected_image_default" "$COMPOSE_FILE")"
  [ "$default_count" = '5' ] ||
    fail "expected all 5 prebuilt services to use the overridable GHCR default, got $default_count"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$BUILD_SCRIPT"
  bash -n "$0"
  install_docker_stub
  test_validation
  test_dry_run_defaults_and_labels
  test_push_and_digest_paths
  test_compose_defaults

  echo 'build-and-push image regression checks passed'
}

main "$@"
