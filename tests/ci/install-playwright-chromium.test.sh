#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/install-playwright-chromium.sh"
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
  grep -Fq "$2" "$1" || fail "expected $1 to contain: $2"
}

assert_not_contains() {
  if grep -Fq "$2" "$1"; then
    fail "expected $1 not to contain: $2"
  fi
}

write_mock_npx() {
  local bin_dir="$1"
  local log_file="$2"
  cat >"$bin_dir/npx" <<MOCK
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$log_file"
MOCK
  chmod +x "$bin_dir/npx"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SCRIPT"

  local bin_dir="$TEST_TEMP_DIR/bin"
  local log_file="$TEST_TEMP_DIR/npx.log"
  mkdir -p "$bin_dir"
  write_mock_npx "$bin_dir" "$log_file"

  PATH="$bin_dir:$PATH" SANCTUARY_RETRY_DELAY_SECONDS=0 SANCTUARY_PLAYWRIGHT_PROBE_CMD=true bash "$SCRIPT"
  assert_contains "$log_file" 'playwright install chromium'
  assert_not_contains "$log_file" 'install-deps'

  : >"$log_file"
  local probe_count="$TEST_TEMP_DIR/probe-count"
  printf '0' >"$probe_count"
  local probe_cmd
  probe_cmd="count=\$(cat \"$probe_count\"); count=\$((count + 1)); printf '%s' \"\$count\" > \"$probe_count\"; [ \"\$count\" -ge 2 ]"
  PATH="$bin_dir:$PATH" \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    SANCTUARY_PLAYWRIGHT_PROBE_CMD="$probe_cmd" \
    bash "$SCRIPT"
  assert_contains "$log_file" 'playwright install chromium'
  assert_contains "$log_file" 'playwright install-deps chromium'
  [ "$(cat "$probe_count")" = '2' ] || fail 'expected probe to run twice'

  echo 'install-playwright-chromium regression checks passed'
}

main "$@"
