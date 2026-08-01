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
SANCTUARY_GIT_COMMIT=testcommit
SANCTUARY_PLATFORM=$platform
SANCTUARY_BUNDLE_FLAVOR=core-dev
SANCTUARY_INCLUDED_PROFILES=core
SANCTUARY_BUNDLE_CREATED_AT=2026-05-02T00:00:00Z
EOF
  printf '{"schema":1}\n' > "$BUNDLE_DIR/manifest.json"
  printf 'bundle payload\n' > "$BUNDLE_DIR/payload/file.txt"
  write_checksums
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
    [ "$LLM_EGRESS_PROXY_SECRET" = "0000000000000000000000000000000000000000000000000000000000000000" ] || exit 1
    exit 0
    ;;
  pull)
    exit 0
    ;;
  image)
    if [ "${2:-}" = "inspect" ]; then
      image="${@: -1}"
      case "$image" in
        sanctuary-*) repo_digests='[]' ;;
        *) repo_digests='["example.invalid/test@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]' ;;
      esac
      printf '[{"Id":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Os":"linux","Architecture":"amd64","RepoDigests":%s}]\n' "$repo_digests"
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
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -o)
          output="$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    [ -n "$output" ] || exit 1
    printf 'fake image tar\n' > "$output"
    exit 0
    ;;
esac

exit 1
EOF
  chmod +x "$FAKE_BIN/docker"
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

test_create_bundle_unsigned_core_dev_archive_shape() {
  TEST_TMP_DIR="$(mktemp -d)"
  setup_fake_docker

  local tag output list manifest failures=0
  tag="$(git -C "$PROJECT_ROOT" tag --list 'v*' | LC_ALL=C sort -V | tail -n 1)"
  if [ -z "$tag" ]; then
    teardown_bundle_workspace
    return 0
  fi

  output="$TEST_TMP_DIR/sanctuary-offline-test.tar.gz"
  PATH="$FAKE_BIN:$PATH" \
    SANCTUARY_FAKE_DOCKER_LOG="$DOCKER_LOG" \
    POSTGRES_PASSWORD="operator-postgres-secret" \
    ENCRYPTION_KEY="operator-encryption-secret" \
    "$CREATE_SCRIPT" --tag "$tag" --output "$output" --unsigned-for-dev --core-only >/dev/null || failures=1

  if [ "$failures" -eq 0 ]; then
    list="$(tar -tzf "$output")" || failures=1
    assert_contains "$list" "./manifest.env" "bundle should include manifest.env" || failures=1
    assert_contains "$list" "./image-inventory.json" "bundle should include immutable image inventory" || failures=1
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
  run_test "unsigned bundle requires override" test_unsigned_bundle_requires_override
  run_test "signed bundle verifies" test_signed_bundle_verifies
  run_test "tampered signed bundle fails checksum" test_tampered_signed_bundle_fails_checksum
  run_test "create bundle emits dev archive shape" test_create_bundle_unsigned_core_dev_archive_shape
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
