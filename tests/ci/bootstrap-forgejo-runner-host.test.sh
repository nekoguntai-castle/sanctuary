#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOTSTRAP_SCRIPT="$ROOT_DIR/scripts/ops/bootstrap-forgejo-runner-host.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_contains() {
  local file="$1"
  local needle="$2"

  grep -Fq -- "$needle" "$file" || fail "expected ${file} to contain: ${needle}"
}

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  assert_contains "$output_file" "$expected"
}

run_bootstrap() {
  local root="$1"
  local systemd_dir="$2"
  shift 2

  bash "$BOOTSTRAP_SCRIPT" \
    --root "$root" \
    --systemd-dir "$systemd_dir" \
    --service-name forgejo-runner-test \
    --runner-name test-runner \
    --skip-register \
    --skip-systemctl \
    --skip-compose-validate \
    "$@" >/dev/null
}

test_generates_runner_host_files() {
  local root="$TEST_TEMP_DIR/new/root"
  local systemd_dir="$TEST_TEMP_DIR/new/systemd"

  run_bootstrap "$root" "$systemd_dir" --capacity 8

  assert_contains "$root/data/runner-config.yml" "capacity: 8"
  assert_contains "$root/data/runner-config.yml" "shutdown_timeout: 5m"
  assert_contains "$root/docker-compose.yml" "--default-address-pool=base=172.30.0.0/16,size=24"
  assert_contains "$root/docker-compose.yml" "--default-address-pool=base=10.241.0.0/16,size=24"
  # docker:dind enables TLS automatically when DOCKER_TLS_CERTDIR is non-empty
  # (the image's entrypoint sets it), which silently overrides --tls=false and
  # makes the plain-HTTP healthcheck loop. Force it empty.
  assert_contains "$root/docker-compose.yml" 'DOCKER_TLS_CERTDIR: ""'
  assert_contains "$root/bin/forgejo-runner-dind-cleanup" "docker -H tcp://127.0.0.1:2375"
  assert_contains "$systemd_dir/forgejo-runner-test.service" "After=docker.service network-online.target"
  assert_contains "$systemd_dir/forgejo-runner-test-cleanup.timer" "OnBootSec=20min"
  assert_contains "$systemd_dir/forgejo-runner-test-cleanup.timer" "OnUnitActiveSec=1h"
}

test_preserves_existing_runner_registration_block() {
  local root="$TEST_TEMP_DIR/existing/root"
  local systemd_dir="$TEST_TEMP_DIR/existing/systemd"
  mkdir -p "$root/data"
  cat > "$root/data/runner-config.yml" <<'YAML'
runner:
  capacity: 1
server:
  connections:
    example:
      url: https://forgejo.example.invalid/
      token_url: file:/data/token.txt
      labels:
        - ubuntu-latest:docker://example.invalid/image:tag
YAML

  run_bootstrap "$root" "$systemd_dir" --capacity 6

  assert_contains "$root/data/runner-config.yml" "capacity: 6"
  assert_contains "$root/data/runner-config.yml" "server:"
  assert_contains "$root/data/runner-config.yml" "token_url: file:/data/token.txt"
  assert_contains "$root/data/runner-config.yml" "ubuntu-latest:docker://example.invalid/image:tag"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$BOOTSTRAP_SCRIPT"
  test_generates_runner_host_files
  test_preserves_existing_runner_registration_block
  assert_fails_with "--capacity must be a positive integer" \
    bash "$BOOTSTRAP_SCRIPT" \
      --root "$TEST_TEMP_DIR/invalid/root" \
      --systemd-dir "$TEST_TEMP_DIR/invalid/systemd" \
      --capacity 0 \
      --skip-register \
      --skip-systemctl \
      --skip-compose-validate

  echo "bootstrap-forgejo-runner-host regression checks passed"
}

main "$@"
