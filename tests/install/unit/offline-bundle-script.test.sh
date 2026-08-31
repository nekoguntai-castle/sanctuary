#!/bin/bash
# Unit tests for scripts/offline/apply-bundle.sh.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
APPLY_SCRIPT="$PROJECT_ROOT/scripts/offline/apply-bundle.sh"
CREATE_SCRIPT="$PROJECT_ROOT/scripts/offline/create-bundle.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
FAILED_TESTS=()
TEST_TMP_DIR=""

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="${3:-String should contain substring}"

  if [[ "$haystack" == *"$needle"* ]]; then
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} $message"
  echo "  Missing: $needle"
  echo "  Output: $haystack"
  return 1
}

assert_command_fails() {
  local output
  set +e
  output="$("$@" 2>&1)"
  local exit_code=$?
  set -e

  if [ "$exit_code" -ne 0 ]; then
    printf '%s' "$output"
    return 0
  fi

  echo -e "${RED}ASSERTION FAILED:${NC} command should fail"
  echo "  Command: $*"
  return 1
}

run_test() {
  local test_name="$1"
  local test_func="$2"

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -n "  Running: $test_name... "

  set +e
  "$test_func"
  local exit_code=$?
  set -e

  if [ "$exit_code" -eq 0 ]; then
    echo -e "${GREEN}PASSED${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}FAILED${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("$test_name")
  fi
}

host_platform() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      echo "linux/amd64"
      ;;
    aarch64|arm64)
      echo "linux/arm64"
      ;;
    *)
      echo "unsupported"
      ;;
  esac
}

setup_bundle_workspace() {
  TEST_TMP_DIR="$(mktemp -d)"
  BUNDLE_DIR="$TEST_TMP_DIR/bundle"
  STAGE_DIR="$TEST_TMP_DIR/stage"
  BUNDLE_TAR="$TEST_TMP_DIR/bundle.tar.gz"
  PRIVATE_KEY="$TEST_TMP_DIR/private.pem"
  PUBLIC_KEY="$TEST_TMP_DIR/public.pem"
  mkdir -p "$BUNDLE_DIR/payload" "$STAGE_DIR"

  local platform
  platform="$(host_platform)"
  [ "$platform" != "unsupported" ] || return 1

  cat > "$BUNDLE_DIR/manifest.env" <<EOF
SANCTUARY_OFFLINE_BUNDLE_SCHEMA=1
SANCTUARY_VERSION=9.9.9
SANCTUARY_GIT_TAG=v9.9.9
SANCTUARY_GIT_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SANCTUARY_PLATFORM=$platform
SANCTUARY_BUNDLE_FLAVOR=core-dev
SANCTUARY_INCLUDED_PROFILES=core
SANCTUARY_BUNDLE_CREATED_AT=2026-05-02T00:00:00Z
EOF
  printf '{"schema":1}\n' > "$BUNDLE_DIR/manifest.json"
  printf 'bundle payload\n' > "$BUNDLE_DIR/payload/file.txt"
  write_test_image_inventory
  write_checksums
}

write_test_image_inventory() {
  local platform arch image archive_ref file_name repo_digest repo_digests inventory_lines
  platform="$(host_platform)"
  arch="${platform#linux/}"
  inventory_lines="$TEST_TMP_DIR/image-inventory.jsonl"
  mkdir -p "$BUNDLE_DIR/images/core" "$TEST_TMP_DIR/image-tar"
  : > "$inventory_lines"
  printf 'SANCTUARY_IMAGE_INVENTORY_SCHEMA=1\nSANCTUARY_IMAGE_INVENTORY_PLATFORM=%s\n' \
    "$platform" > "$BUNDLE_DIR/image-inventory.tsv"
  # shellcheck disable=SC1090
  source "$PROJECT_ROOT/scripts/offline/bundle-common.sh"
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    archive_ref="$(offline_archive_image_ref "$image")"
    file_name="$(offline_image_file_name "$image").tar"
    printf '[{"Config":"config.json","RepoTags":["%s"],"Layers":[]}]\n' "$archive_ref" \
      > "$TEST_TMP_DIR/image-tar/manifest.json"
    printf '{}\n' > "$TEST_TMP_DIR/image-tar/config.json"
    tar -cf "$BUNDLE_DIR/images/core/$file_name" -C "$TEST_TMP_DIR/image-tar" manifest.json config.json
    repo_digests='[]'
    repo_digest="-"
    if [[ "$image" == *@sha256:* ]]; then
      repo_digest="$(offline_repo_digest_ref "$image")"
      repo_digests="[\"$repo_digest\"]"
    fi
    printf '{"image":"%s","archiveRef":"%s","id":"%s","os":"linux","architecture":"%s","repoDigests":%s}\n' \
      "$image" "$archive_ref" \
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
      "$arch" "$repo_digests" >> "$inventory_lines"
    printf '%s\t%s\t%s\tlinux\t%s\t%s\n' "$image" "$archive_ref" \
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
      "$arch" "$repo_digest" \
      >> "$BUNDLE_DIR/image-inventory.tsv"
  done < <(offline_core_images)
  jq -s --arg platform "$platform" '{schema: 1, platform: $platform, images: .}' \
    "$inventory_lines" > "$BUNDLE_DIR/image-inventory.json"
}

setup_fake_docker() {
  FAKE_BIN="$TEST_TMP_DIR/bin"
  DOCKER_LOG="$TEST_TMP_DIR/docker.log"
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/docker" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$SANCTUARY_FAKE_DOCKER_LOG"

case "$1" in
  compose)
    [ "$POSTGRES_PASSWORD" = "offline-build-postgres-password" ] || exit 1
    [ "$REDIS_PASSWORD" = "offline-build-redis-password" ] || exit 1
    [ "$JWT_SECRET" = "offline-build-jwt-secret-not-for-runtime" ] || exit 1
    [ "$ENCRYPTION_KEY" = "offline-build-encryption-key-not-for-runtime" ] || exit 1
    [ "$ENCRYPTION_SALT" = "offline-build-encryption-salt" ] || exit 1
    [ "$WORKER_DIAGNOSTICS_SECRET" = "0000000000000000000000000000000000000000000000000000000000000000" ] || exit 1
    [ "$LLM_EGRESS_PROXY_SECRET" = "0000000000000000000000000000000000000000000000000000000000000000" ] || exit 1
    for name in SANCTUARY_PROJECT SANCTUARY_DEPLOYMENT_ID SANCTUARY_OWNER_ID SANCTUARY_OPERATION_RUN_ID SANCTUARY_RELEASE SANCTUARY_COMMIT SANCTUARY_CLEANUP_CREATED_AT SANCTUARY_SOURCE_COMMIT SANCTUARY_IMAGE_LOCK_SHA256 SANCTUARY_VERSION SANCTUARY_BUILD_ID; do
      [ -n "${!name:-}" ] || exit 1
    done
    [ -z "${SANCTUARY_EXPECTED_COMMIT:-}" ] || [ "$SANCTUARY_COMMIT" = "$SANCTUARY_EXPECTED_COMMIT" ] || exit 1
    [ -z "${SANCTUARY_EXPECTED_COMMIT:-}" ] || [ "$SANCTUARY_SOURCE_COMMIT" = "$SANCTUARY_EXPECTED_COMMIT" ] || exit 1
    [ -z "${SANCTUARY_EXPECTED_RELEASE:-}" ] || [ "$SANCTUARY_RELEASE" = "$SANCTUARY_EXPECTED_RELEASE" ] || exit 1
    [ -z "${SANCTUARY_EXPECTED_LOCK:-}" ] || [ "$SANCTUARY_IMAGE_LOCK_SHA256" = "$SANCTUARY_EXPECTED_LOCK" ] || exit 1
    [ -z "${SANCTUARY_EXPECTED_VERSION:-}" ] || [ "$SANCTUARY_VERSION" = "$SANCTUARY_EXPECTED_VERSION" ] || exit 1
    [ -z "${SANCTUARY_EXPECTED_BUILD_ID:-}" ] || [ "$SANCTUARY_BUILD_ID" = "$SANCTUARY_EXPECTED_BUILD_ID" ] || exit 1
    exit 0
    ;;
  pull)
    exit 0
    ;;
  tag)
    exit 0
    ;;
  load)
    exit 0
    ;;
  image)
    if [ "${2:-}" = "tag" ]; then
      exit 0
    fi
    if [ "${2:-}" = "inspect" ]; then
      image="${@: -1}"
      image_id="${SANCTUARY_FAKE_IMAGE_ID:-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
      image_os="${SANCTUARY_FAKE_IMAGE_OS:-linux}"
      image_arch="${SANCTUARY_FAKE_IMAGE_ARCH:-amd64}"
      case "$image" in
        *@sha256:*) ;;
        postgres:*|redis:*|tecnativa/*|jaegertracing/*|grafana/*|prom/*|dperson/*)
          image_id="${SANCTUARY_FAKE_RUNTIME_IMAGE_ID:-$image_id}"
          ;;
      esac
      case "$image" in
        *@sha256:*)
          archive_ref="${image%@sha256:*}"
          digest="${image##*@sha256:}"
          final_component="${archive_ref##*/}"
          repository="$archive_ref"
          [[ "$final_component" == *:* ]] && repository="${archive_ref%:*}"
          repo_digests="[\"$repository@sha256:$digest\"]"
          ;;
        sanctuary-*) repo_digests='[]' ;;
        *) repo_digests='["example.invalid/test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]' ;;
      esac
      case "$*" in
        *'{{.Id}} {{.Os}} {{.Architecture}}'*) printf '%s %s %s\n' "$image_id" "$image_os" "$image_arch" ;;
        *'{{.Id}}'*) printf '%s\n' "$image_id" ;;
        *'{{.Os}}/{{.Architecture}}'*) printf '%s/%s\n' "$image_os" "$image_arch" ;;
        *) printf '[{"Id":"%s","Os":"%s","Architecture":"%s","RepoDigests":%s}]\n' \
          "$image_id" "$image_os" "$image_arch" "$repo_digests" ;;
      esac
      exit 0
    fi
    ;;
  volume)
    if [ "${2:-}" = "ls" ]; then
      case "$*" in
        *"label=com.docker.compose.project=${SANCTUARY_FAKE_DATABASE_PROJECT:-__none__}"*"label=com.docker.compose.volume=postgres_data"*)
          printf '%s\n' "${SANCTUARY_FAKE_DATABASE_PROJECT}_postgres_data"
          exit 0
          ;;
        *"label=com.docker.compose.project=${SANCTUARY_EXPECTED_COMPOSE_PROJECT:-}"*"label=com.docker.compose.volume=postgres_data"*)
          exit 0
          ;;
        *)
          printf '%s\n' sanctuary-unrelated_postgres_data
          exit 0
          ;;
      esac
    fi
    ;;
  save)
    output=""
    saved_image=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -o)
          output="$2"
          shift 2
          ;;
        *)
          saved_image="$1"
          shift
          ;;
      esac
    done
    [ -n "$output" ] || exit 1
    repo_tag="${SANCTUARY_FAKE_SAVED_REPO_TAG:-$saved_image}"
    tar_dir="$(mktemp -d)"
    printf '[{"Config":"config.json","RepoTags":["%s"],"Layers":[]}]\n' "$repo_tag" \
      > "$tar_dir/manifest.json"
    printf '{}\n' > "$tar_dir/config.json"
    tar -cf "$output" -C "$tar_dir" manifest.json config.json
    find "$tar_dir" -type f -delete
    find "$tar_dir" -depth -type d -empty -delete
    exit 0
    ;;
esac

exit 1
EOF
  chmod +x "$FAKE_BIN/docker"
}

setup_fake_git() {
  cat > "$FAKE_BIN/git" <<'EOF'
#!/bin/bash
exit 0
EOF
  chmod +x "$FAKE_BIN/git"
}

teardown_bundle_workspace() {
  if [ -n "${TEST_TMP_DIR:-}" ] && [ -d "$TEST_TMP_DIR" ]; then
    find "$TEST_TMP_DIR" -type f -delete
    find "$TEST_TMP_DIR" -type l -delete
    find "$TEST_TMP_DIR" -depth -type d -empty -delete
  fi
}

write_checksums() {
  (
    cd "$BUNDLE_DIR"
    find . -type f ! -name checksums.sha256 ! -name checksums.sha256.sig | LC_ALL=C sort | while IFS= read -r file; do
      sha256sum "$file"
    done > checksums.sha256
  )
}

archive_bundle() {
  tar -czf "$BUNDLE_TAR" -C "$BUNDLE_DIR" .
}

sign_bundle() {
  openssl genrsa -out "$PRIVATE_KEY" 2048 >/dev/null 2>&1
  openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" >/dev/null 2>&1
  openssl dgst -sha256 -sign "$PRIVATE_KEY" -out "$BUNDLE_DIR/checksums.sha256.sig" "$BUNDLE_DIR/checksums.sha256"
}

test_script_has_valid_syntax() {
  bash -n "$APPLY_SCRIPT"
  bash -n "$CREATE_SCRIPT"
}

test_bundle_bootstrap_includes_backup_helper() {
  grep -q "create-upgrade-backup.sh" "$CREATE_SCRIPT" \
    && grep -q "create_upgrade_backup_or_prompt" "$CREATE_SCRIPT" \
    && grep -q -- "--verify-only" "$CREATE_SCRIPT"
}

test_full_bundle_packages_grafana_migration_image() {
  grep -Fq 'sanctuary-grafana-migration:local' \
    "$PROJECT_ROOT/scripts/offline/bundle-common.sh" \
    && grep -Fq 'grafana-password-migration' "$CREATE_SCRIPT" \
    && grep -Fq 'docker/compose/monitoring.yml' "$CREATE_SCRIPT"
}

test_digest_refs_map_to_tag_only_archive_refs() {
  # shellcheck disable=SC1090
  source "$PROJECT_ROOT/scripts/offline/bundle-common.sh"

  local exact_ref runtime_ref
  exact_ref="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
  runtime_ref="postgres:16-alpine"

  [ "$(offline_archive_image_ref "$exact_ref")" = "$runtime_ref" ] \
    && [ "$(offline_repo_digest_ref "$exact_ref")" = "postgres@sha256:${exact_ref##*@sha256:}" ] \
    && [ "$(offline_archive_image_ref 'registry.example:5000/team/image:v1@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" = "registry.example:5000/team/image:v1" ] \
    && [ "$(offline_repo_digest_ref 'registry.example:5000/team/image:v1@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" = "registry.example:5000/team/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ] \
    && ! (offline_archive_image_ref 'registry.example:5000/team/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' >/dev/null 2>&1) \
    && [ "$(offline_archive_image_ref 'sanctuary-backend:local')" = "sanctuary-backend:local" ] \
    && printf '%s\n' "${CORE_IMAGES[@]}" | grep -Fxq "$exact_ref"
}

test_unsigned_bundle_requires_override() {
  setup_bundle_workspace
  archive_bundle

  local output failures=0
  output="$(assert_command_fails "$APPLY_SCRIPT" --bundle "$BUNDLE_TAR" --stage-dir "$STAGE_DIR" --prepare-only)" || failures=1
  assert_contains "$output" "bundle is unsigned" "unsigned bundle should be rejected by default" || failures=1

  "$APPLY_SCRIPT" --bundle "$BUNDLE_TAR" --stage-dir "$STAGE_DIR" --prepare-only --allow-unsigned-dev-bundle >/dev/null || failures=1

  teardown_bundle_workspace
  return "$failures"
}

test_signed_bundle_verifies() {
  setup_bundle_workspace
  sign_bundle
  archive_bundle

  local failures=0
  "$APPLY_SCRIPT" --bundle "$BUNDLE_TAR" --stage-dir "$STAGE_DIR" --prepare-only --public-key "$PUBLIC_KEY" >/dev/null || failures=1
  "$APPLY_SCRIPT" --staged-dir "$BUNDLE_DIR" --verify-only --public-key "$PUBLIC_KEY" >/dev/null || failures=1

  teardown_bundle_workspace
  return "$failures"
}

test_tampered_signed_bundle_fails_checksum() {
  setup_bundle_workspace
  sign_bundle
  printf 'tampered payload\n' > "$BUNDLE_DIR/payload/file.txt"
  archive_bundle

  local output failures=0
  output="$(assert_command_fails "$APPLY_SCRIPT" --bundle "$BUNDLE_TAR" --stage-dir "$STAGE_DIR" --prepare-only --public-key "$PUBLIC_KEY")" || failures=1
  assert_contains "$output" "checksum verification failed" "tampered payload should fail checksum validation" || failures=1

  teardown_bundle_workspace
  return "$failures"
}

test_apply_rejects_archive_without_expected_runtime_tag() {
  setup_bundle_workspace

  local image_tar output failures=0
  image_tar="$(find "$BUNDLE_DIR/images" -type f -name '*.tar' | head -n 1)"
  printf '[{"Config":"config.json","RepoTags":null,"Layers":[]}]\n' \
    > "$TEST_TMP_DIR/image-tar/manifest.json"
  tar -cf "$image_tar" -C "$TEST_TMP_DIR/image-tar" manifest.json config.json
  write_checksums
  sign_bundle
  archive_bundle

  output="$(assert_command_fails "$APPLY_SCRIPT" --bundle "$BUNDLE_TAR" --stage-dir "$STAGE_DIR" --prepare-only --public-key "$PUBLIC_KEY")" || failures=1
  assert_contains "$output" "does not restore exactly" \
    "apply should reject a signed archive that cannot restore its runtime tag" || failures=1

  teardown_bundle_workspace
  return "$failures"
}

test_create_bundle_unsigned_core_dev_archive_shape() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output list manifest expected_commit expected_lock expected_version failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  expected_commit="$(git -C "$PROJECT_ROOT" rev-list -n 1 "$tag")"
  expected_lock="$(sha256sum "$PROJECT_ROOT/config/container-image-lock.json" | awk '{print $1}')"
  expected_version="$(awk -F'"' '/"version":/{print $4; exit}' "$PROJECT_ROOT/package.json")"
  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_EXPECTED_COMMIT="$expected_commit" \
    SANCTUARY_EXPECTED_RELEASE="$tag" \
    SANCTUARY_EXPECTED_LOCK="$expected_lock" \
    SANCTUARY_EXPECTED_VERSION="$expected_version" \
    SANCTUARY_EXPECTED_BUILD_ID="offline-${expected_commit:0:12}" \
    SANCTUARY_RELEASE=poison-release SANCTUARY_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    SANCTUARY_SOURCE_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
    SANCTUARY_IMAGE_LOCK_SHA256=poison-lock SANCTUARY_VERSION=poison-version SANCTUARY_BUILD_ID=poison-build \
    POSTGRES_PASSWORD="operator-postgres-secret" \
    ENCRYPTION_KEY="operator-encryption-secret" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev --core-only >/dev/null || failures=1

  if [ "$failures" -eq 0 ]; then
    list="$(tar -tzf "$output")" || failures=1
    assert_contains "$list" "./manifest.env" "bundle should include manifest.env" || failures=1
    assert_contains "$list" "./image-inventory.json" "bundle should include immutable image inventory" || failures=1
    assert_contains "$list" "./image-inventory.tsv" "bundle should include target-readable image inventory" || failures=1
    assert_contains "$list" "./install-offline.sh" "bundle should include bootstrap installer" || failures=1
    assert_contains "$list" "./tools/create-upgrade-backup.sh" "bundle should include backup helper" || failures=1
    assert_contains "$list" "./images/core/sanctuary-backend-local.tar" "bundle should include backend image" || failures=1
    assert_contains "$list" "./images/core/sanctuary-gateway-local.tar" "bundle should include gateway image" || failures=1
    assert_contains "$list" "./images/core/sanctuary-llm-egress-proxy-local.tar" "bundle should include LLM egress proxy image" || failures=1
    assert_contains "$(cat "$DOCKER_LOG")" "compose -f $PROJECT_ROOT/docker-compose.yml build backend frontend gateway llm-egress-proxy" \
      "bundle creation should build Sanctuary images with the release Compose file" || failures=1
    manifest="$(tar -xOf "$output" ./manifest.env)" || failures=1
    assert_contains "$manifest" "SANCTUARY_BUNDLE_FLAVOR=core-dev" "dev core-only bundle should be marked" || failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_create_bundle_tags_digest_refs_and_saves_runtime_refs() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output exact_ref runtime_ref inventory docker_log failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  exact_ref="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
  runtime_ref="postgres:16-alpine"
  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev --core-only >/dev/null \
    || failures=1

  if [ "$failures" -eq 0 ]; then
    docker_log="$(cat "$DOCKER_LOG")"
    assert_contains "$docker_log" "image tag $exact_ref $runtime_ref" \
      "bundle creation should tag the pulled digest as the runtime reference" || failures=1
    if ! grep -F 'save -o ' "$DOCKER_LOG" | grep -Fq " $runtime_ref"; then
      echo "digest-pinned image was not saved by its tag-only runtime reference" >&2
      failures=1
    fi
    inventory="$(tar -xOf "$output" ./image-inventory.json)" || failures=1
    printf '%s' "$inventory" | jq -e --arg exact "$exact_ref" --arg archive "$runtime_ref" \
      '.images[] | select(.image == $exact and .archiveRef == $archive)' >/dev/null \
      || failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_create_bundle_rejects_unexpected_archive_repo_tag() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  if PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime" \
    SANCTUARY_FAKE_SAVED_REPO_TAG="unexpected.invalid/image:wrong" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev --core-only \
      >/dev/null 2>&1; then
    echo "bundle creation accepted an archive with an unexpected RepoTag" >&2
    failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_create_bundle_rejects_runtime_tag_for_different_image_id() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  if PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_FAKE_RUNTIME_IMAGE_ID="sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev --core-only \
      >/dev/null 2>&1; then
    echo "bundle creation accepted a runtime tag that resolved to a different image ID" >&2
    failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

setup_inventory_bundle() {
  setup_bundle_workspace
  setup_fake_docker
  setup_fake_git

  mkdir -p "$BUNDLE_DIR/repo"
  printf 'fake git bundle\n' > "$BUNDLE_DIR/repo/sanctuary.git.bundle"
  write_checksums
  sign_bundle
}

test_apply_validates_loaded_runtime_image_id() {
  setup_inventory_bundle

  local failures=0
  if PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime" \
    SANCTUARY_FAKE_IMAGE_ID="sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" \
    "$APPLY_SCRIPT" --staged-dir "$BUNDLE_DIR" --install-dir "$TEST_TMP_DIR/install" \
      --public-key "$PUBLIC_KEY" --apply >/dev/null 2>&1; then
    echo "offline apply accepted a loaded runtime image with the wrong image ID" >&2
    failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_apply_accepts_signed_inventory_via_runtime_refs() {
  setup_inventory_bundle

  local apply_output docker_log failures=0
  apply_output="$(PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime" \
    "$APPLY_SCRIPT" --staged-dir "$BUNDLE_DIR" --install-dir "$TEST_TMP_DIR/install" \
      --public-key "$PUBLIC_KEY" --apply 2>&1)" || {
    echo "$apply_output" >&2
    failures=1
  }
  docker_log="$(cat "$DOCKER_LOG")"
  if ! grep -Eq 'image inspect .* postgres:16-alpine$' "$DOCKER_LOG"; then
    echo "offline apply did not validate the tag-only runtime image reference" >&2
    failures=1
  fi
  if grep -Eq \
    'image inspect .*postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777$' \
    "$DOCKER_LOG"; then
    echo "offline apply attempted to validate a registry-only digest reference" >&2
    failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_apply_validates_loaded_runtime_image_platform() {
  setup_inventory_bundle

  local wrong_arch failures=0
  case "$(host_platform)" in
    linux/amd64) wrong_arch="arm64" ;;
    *) wrong_arch="amd64" ;;
  esac
  if PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    SANCTUARY_RUNTIME_DIR="$TEST_TMP_DIR/runtime" \
    SANCTUARY_FAKE_IMAGE_ARCH="$wrong_arch" \
    "$APPLY_SCRIPT" --staged-dir "$BUNDLE_DIR" --install-dir "$TEST_TMP_DIR/install" \
      --public-key "$PUBLIC_KEY" --apply >/dev/null 2>&1; then
    echo "offline apply accepted a loaded runtime image for the wrong platform" >&2
    failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_create_full_bundle_builds_and_saves_migration_without_pull() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output docker_log failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-full-test.tar.gz"
  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev >/dev/null \
    || failures=1
  docker_log="$(cat "$DOCKER_LOG")"

  assert_contains "$docker_log" \
    "docker/compose/monitoring.yml build grafana-password-migration" \
    "full bundle must build the packaged Grafana migration image" || failures=1
  assert_contains "$docker_log" \
    "sanctuary-grafana-migration:local" \
    "full bundle must inspect and save the packaged Grafana migration image" || failures=1
  if ! grep -F 'save -o ' "$DOCKER_LOG" | grep -Fq 'sanctuary-grafana-migration:local'; then
    echo "packaged Grafana migration image was not saved" >&2
    failures=1
  fi
  if grep -Eq '^pull .* sanctuary-grafana-migration:local$' "$DOCKER_LOG"; then
    echo "packaged Grafana migration image was incorrectly pulled as external" >&2
    failures=1
  fi
  if ! tar -tzf "$output" > "$TEST_TMP_DIR/archive-list.txt" \
    || ! grep -Fxq './images/monitoring/sanctuary-grafana-migration-local.tar' \
      "$TEST_TMP_DIR/archive-list.txt"; then
    failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_create_bundle_signs_outer_archive() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output private_key public_key release_repo failures=0
  tag="v9.9.9"
  release_repo="$TEST_TMP_DIR/release-repo"
  mkdir -p "$release_repo/scripts/offline"
  cp "$PROJECT_ROOT/package.json" "$release_repo/package.json"
  cp "$PROJECT_ROOT/scripts/create-upgrade-backup.sh" "$release_repo/scripts/create-upgrade-backup.sh"
  cp "$PROJECT_ROOT/scripts/offline/create-bundle.sh" "$release_repo/scripts/offline/create-bundle.sh"
  cp "$PROJECT_ROOT/scripts/offline/apply-bundle.sh" "$release_repo/scripts/offline/apply-bundle.sh"
  cp "$PROJECT_ROOT/scripts/offline/bundle-common.sh" "$release_repo/scripts/offline/bundle-common.sh"
  git -C "$release_repo" init -q
  git -C "$release_repo" config user.name "Sanctuary Tests"
  git -C "$release_repo" config user.email "tests@sanctuary.local"
  git -C "$release_repo" add .
  git -C "$release_repo" commit -qm "test release checkout"
  git -C "$release_repo" tag "$tag"

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  private_key="$TEST_TMP_DIR/private.pem"
  public_key="$TEST_TMP_DIR/public.pem"
  openssl genrsa -out "$private_key" 2048 >/dev/null 2>&1 || failures=1
  openssl rsa -in "$private_key" -pubout -out "$public_key" >/dev/null 2>&1 || failures=1

  if [ "$failures" -eq 0 ]; then
    PATH="$FAKE_BIN:$PATH" \
      SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
      "$release_repo/scripts/offline/create-bundle.sh" --tag "$tag" --output "$output" --skip-build \
        --signing-key "$private_key" --public-key "$public_key" >/dev/null \
      || failures=1
  fi

  [ -s "${output}.sig" ] || failures=1
  openssl dgst -sha256 -verify "$public_key" -signature "${output}.sig" "$output" \
    >/dev/null 2>&1 || failures=1
  printf 'tampered\n' >> "$output"
  if openssl dgst -sha256 -verify "$public_key" -signature "${output}.sig" "$output" \
    >/dev/null 2>&1; then
    failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_fresh_bootstrap_ignores_unrelated_database_volume() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output extracted install_dir failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  extracted="$TEST_TMP_DIR/extracted"
  install_dir="$TEST_TMP_DIR/fresh-install"
  mkdir -p "$extracted"

  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev --core-only >/dev/null \
    || failures=1
  [ "$failures" -eq 0 ] && tar -xzf "$output" -C "$extracted" || failures=1

  if [ "$failures" -eq 0 ]; then
    cat > "$extracted/tools/apply-bundle.sh" <<'EOF'
#!/bin/bash
set -e
install_dir=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--install-dir" ]; then
    install_dir="$2"
    shift 2
  else
    shift
  fi
done
if [ -n "$install_dir" ]; then
  mkdir -p "$install_dir"
  printf '#!/bin/bash\nexit 0\n' > "$install_dir/install.sh"
  chmod +x "$install_dir/install.sh"
fi
EOF
    cat > "$extracted/tools/create-upgrade-backup.sh" <<'EOF'
#!/bin/bash
echo "unexpected backup" >> "$SANCTUARY_FAKE_BACKUP_LOG"
exit 99
EOF
    chmod +x "$extracted/tools/apply-bundle.sh" "$extracted/tools/create-upgrade-backup.sh"

    PATH="$FAKE_BIN:$PATH" \
      SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
      SANCTUARY_FAKE_BACKUP_LOG="$TEST_TMP_DIR/backup.log" \
      SANCTUARY_EXPECTED_COMPOSE_PROJECT=fresh-install \
      "$extracted/install-offline.sh" --install-dir "$install_dir" --allow-unsigned-dev-bundle --yes >/dev/null \
      || failures=1
    assert_contains "$(cat "$DOCKER_LOG")" \
      "volume ls -q --filter label=com.docker.compose.project=fresh-install --filter label=com.docker.compose.volume=postgres_data" \
      "fresh bootstrap should scope database detection to its Compose project" || failures=1
    [ ! -e "$TEST_TMP_DIR/backup.log" ] || failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_upgrade_bootstrap_resolves_current_and_legacy_project_names() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output extracted current_install legacy_install backup_log failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  extracted="$TEST_TMP_DIR/extracted"
  current_install="$TEST_TMP_DIR/custom-current-install"
  legacy_install="$TEST_TMP_DIR/custom-legacy-install"
  backup_log="$TEST_TMP_DIR/backup.log"
  mkdir -p "$extracted" "$current_install" "$legacy_install"
  printf 'name: sanctuary\n' > "$current_install/docker-compose.yml"
  printf 'services: {}\n' > "$legacy_install/docker-compose.yml"

  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev --core-only >/dev/null \
    || failures=1
  [ "$failures" -eq 0 ] && tar -xzf "$output" -C "$extracted" || failures=1

  if [ "$failures" -eq 0 ]; then
    cat > "$extracted/tools/apply-bundle.sh" <<'EOF'
#!/bin/bash
set -e
install_dir=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--install-dir" ]; then
    install_dir="$2"
    shift 2
  else
    shift
  fi
done
if [ -n "$install_dir" ]; then
  printf '#!/bin/bash\nexit 0\n' > "$install_dir/install.sh"
  chmod +x "$install_dir/install.sh"
fi
EOF
    cat > "$extracted/tools/create-upgrade-backup.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$SANCTUARY_FAKE_BACKUP_LOG"
EOF
    chmod +x "$extracted/tools/apply-bundle.sh" "$extracted/tools/create-upgrade-backup.sh"

    PATH="$FAKE_BIN:$PATH" \
      SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
      SANCTUARY_FAKE_BACKUP_LOG="$backup_log" \
      SANCTUARY_FAKE_DATABASE_PROJECT=sanctuary \
      "$extracted/install-offline.sh" --install-dir "$current_install" --allow-unsigned-dev-bundle --yes >/dev/null \
      || failures=1
    assert_contains "$(cat "$DOCKER_LOG")" \
      "label=com.docker.compose.project=sanctuary" \
      "current Compose name should override a custom install-directory basename" || failures=1
    assert_contains "$(cat "$backup_log")" "$current_install" \
      "current custom-directory upgrade should invoke backup" || failures=1

    : > "$DOCKER_LOG"
    : > "$backup_log"
    PATH="$FAKE_BIN:$PATH" \
      SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
      SANCTUARY_FAKE_BACKUP_LOG="$backup_log" \
      SANCTUARY_FAKE_DATABASE_PROJECT=custom-legacy-install \
      "$extracted/install-offline.sh" --install-dir "$legacy_install" --allow-unsigned-dev-bundle --yes >/dev/null \
      || failures=1
    assert_contains "$(cat "$DOCKER_LOG")" \
      "label=com.docker.compose.project=custom-legacy-install" \
      "legacy Compose should fall back to the install-directory basename" || failures=1
    assert_contains "$(cat "$backup_log")" "$legacy_install" \
      "legacy custom-directory upgrade should invoke backup" || failures=1
  fi

  teardown_bundle_workspace
  return "$failures"
}

test_tar_links_are_rejected() {
  setup_bundle_workspace
  ln -s payload/file.txt "$BUNDLE_DIR/link-to-payload"
  archive_bundle

  local output failures=0
  output="$(assert_command_fails "$APPLY_SCRIPT" --bundle "$BUNDLE_TAR" --stage-dir "$STAGE_DIR" --prepare-only --allow-unsigned-dev-bundle)" || failures=1
  assert_contains "$output" "links or special files" "bundle symlinks should be rejected before extraction" || failures=1

  teardown_bundle_workspace
  return "$failures"
}

main() {
  echo "Offline Bundle Script Unit Tests"
  echo "================================"

  run_test "script has valid syntax" test_script_has_valid_syntax
  run_test "bundle bootstrap includes backup helper" test_bundle_bootstrap_includes_backup_helper
  run_test "full bundle packages Grafana migration image" test_full_bundle_packages_grafana_migration_image
  run_test "digest refs map to tag-only archive refs" test_digest_refs_map_to_tag_only_archive_refs
  run_test "unsigned bundle requires override" test_unsigned_bundle_requires_override
  run_test "signed bundle verifies" test_signed_bundle_verifies
  run_test "tampered signed bundle fails checksum" test_tampered_signed_bundle_fails_checksum
  run_test "apply rejects an archive without its runtime tag" test_apply_rejects_archive_without_expected_runtime_tag
  run_test "create bundle emits dev archive shape" test_create_bundle_unsigned_core_dev_archive_shape
  run_test "create bundle tags digest refs and saves runtime refs" test_create_bundle_tags_digest_refs_and_saves_runtime_refs
  run_test "create bundle rejects unexpected archive RepoTag" test_create_bundle_rejects_unexpected_archive_repo_tag
  run_test "create bundle rejects a mismatched runtime tag ID" test_create_bundle_rejects_runtime_tag_for_different_image_id
  run_test "apply accepts signed inventory via runtime refs" test_apply_accepts_signed_inventory_via_runtime_refs
  run_test "apply validates loaded runtime image ID" test_apply_validates_loaded_runtime_image_id
  run_test "apply validates loaded runtime image platform" test_apply_validates_loaded_runtime_image_platform
  run_test "full bundle builds and saves local Grafana migration image" test_create_full_bundle_builds_and_saves_migration_without_pull
  run_test "create bundle signs outer archive" test_create_bundle_signs_outer_archive
  run_test "fresh bootstrap ignores unrelated database volume" test_fresh_bootstrap_ignores_unrelated_database_volume
  run_test "upgrade bootstrap resolves current and legacy project names" test_upgrade_bootstrap_resolves_current_and_legacy_project_names
  run_test "tar links are rejected" test_tar_links_are_rejected

  echo ""
  echo "Tests run:    $TESTS_RUN"
  echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"

  if [ "$TESTS_FAILED" -gt 0 ]; then
    echo ""
    echo "Failed tests:"
    for test_name in "${FAILED_TESTS[@]}"; do
      echo "  - $test_name"
    done
    exit 1
  fi

  echo -e "${GREEN}All offline bundle script tests passed!${NC}"
}

main "$@"
