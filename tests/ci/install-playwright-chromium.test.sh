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

# Builds a probe command that returns success once the shared counter file
# reaches $1, so a test can control exactly which call to probe_chromium
# succeeds (1-indexed).
probe_cmd_succeeding_on_call() {
  local target="$1" counter="$2"
  printf 'count=$(cat "%s"); count=$((count + 1)); printf %%s "$count" > "%s"; [ "$count" -ge %s ]' \
    "$counter" "$counter" "$target"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SCRIPT"

  local bin_dir="$TEST_TEMP_DIR/bin"
  local log_file="$TEST_TEMP_DIR/npx.log"
  mkdir -p "$bin_dir"
  write_mock_npx "$bin_dir" "$log_file"

  # Case 1: the browser is already present (the sanctuary-playwright-* image
  # bakes it in) -- the leading probe succeeds on its first call, and the
  # script must skip the install entirely, making it a no-op fallback.
  local probe_count="$TEST_TEMP_DIR/probe-count"
  printf '0' >"$probe_count"
  PATH="$bin_dir:$PATH" \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    SANCTUARY_PLAYWRIGHT_PROBE_CMD="$(probe_cmd_succeeding_on_call 1 "$probe_count")" \
    bash "$SCRIPT"
  [ ! -s "$log_file" ] || fail 'expected no npx calls when Chromium is already present'
  [ "$(cat "$probe_count")" = '1' ] || fail 'expected exactly one probe call when already present'

  # Case 2: not present yet, but launches cleanly right after
  # `playwright install chromium` -- no OS dependency install needed.
  : >"$log_file"
  printf '0' >"$probe_count"
  PATH="$bin_dir:$PATH" \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    SANCTUARY_PLAYWRIGHT_PROBE_CMD="$(probe_cmd_succeeding_on_call 2 "$probe_count")" \
    bash "$SCRIPT"
  assert_contains "$log_file" 'playwright install chromium'
  assert_not_contains "$log_file" 'install-deps'
  [ "$(cat "$probe_count")" = '2' ] || fail 'expected exactly two probe calls'

  # Case 3: still fails to launch after `install chromium` -- falls through
  # to `install-deps` and verifies once more.
  : >"$log_file"
  printf '0' >"$probe_count"
  PATH="$bin_dir:$PATH" \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    SANCTUARY_PLAYWRIGHT_PROBE_CMD="$(probe_cmd_succeeding_on_call 3 "$probe_count")" \
    bash "$SCRIPT"
  assert_contains "$log_file" 'playwright install chromium'
  assert_contains "$log_file" 'playwright install-deps chromium'
  [ "$(cat "$probe_count")" = '3' ] || fail 'expected exactly three probe calls'

  echo 'install-playwright-chromium regression checks passed'
}

main "$@"
