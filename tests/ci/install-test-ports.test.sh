#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/install-test-ports.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

run_case() {
  local run_id="$1"
  local offset="$2"
  local output_file="$tmp_dir/env-$run_id-$offset"

  GITHUB_RUN_ID="$run_id" GITHUB_ENV="$output_file" bash "$SCRIPT" "$offset" >/dev/null
  cat "$output_file"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "Expected output to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

output="$(run_case 144 15)"
assert_contains "$output" "HTTPS_PORT=25775"
assert_contains "$output" "HTTP_PORT=25776"
assert_contains "$output" "GATEWAY_PORT=25777"

output="$(run_case not-a-number 3)"
assert_contains "$output" "HTTPS_PORT=20003"
assert_contains "$output" "HTTP_PORT=20004"
assert_contains "$output" "GATEWAY_PORT=20005"

output="$(run_case 00000123 6)"
assert_contains "$output" "HTTPS_PORT=24926"
assert_contains "$output" "HTTP_PORT=24927"
assert_contains "$output" "GATEWAY_PORT=24928"

output="$(run_case 123456789012345678901234567890 9)"
assert_contains "$output" "HTTPS_PORT=55609"
assert_contains "$output" "HTTP_PORT=55610"
assert_contains "$output" "GATEWAY_PORT=55611"

if bash "$SCRIPT" nope >/dev/null 2>&1; then
  echo "Expected non-numeric offsets to fail" >&2
  exit 1
fi

echo "install-test-ports regression checks passed"
