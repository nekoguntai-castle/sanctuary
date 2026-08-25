#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/aggregate-runner-locks.sh"
TEST_TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TEMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  grep -Fq -- "$2" "$1" || fail "expected $1 to contain: $2"
}

mkdir -p "$TEST_TEMP_DIR/logs/nested path"
cat > "$TEST_TEMP_DIR/logs/a.log" <<'LOG'
runner-lock: acquired node-toolchain after 0s
runner-lock: released node-toolchain held 4s status=0
runner-lock: acquired node-toolchain after 3s
runner-lock: released node-toolchain held 5s status=17
runner-lock: timeout e2e after 8s
LOG
printf '{"schema_version":1,"wrapped_exit":17}\n' > "$TEST_TEMP_DIR/logs/a.log.status.json"
cat > "$TEST_TEMP_DIR/logs/nested path/b.log" <<'LOG'
runner-lock: acquired e2e after 2s
runner-lock: released e2e held 9s status=0
runner-lock: acquired orphan after 1s
runner-lock: released release-only held 7s status=0
prefix runner-lock: acquired prose after 99s suffix
prefix runner-lock: released prose held 88s status=0 suffix
unrelated runner-lock: acquired malformed after xs
LOG
printf '{"schema_version":1,"wrapped_exit":0}\n' > "$TEST_TEMP_DIR/logs/nested path/b.log.status.json"

# The integration lane tees its inner attempt output into the outer
# run-with-log-owned log. The inner copy has no sidecar and must not count the
# same physical lock acquisition a second time.
cp "$TEST_TEMP_DIR/logs/a.log" "$TEST_TEMP_DIR/logs/backend-integration-attempt-1.log"

output="$TEST_TEMP_DIR/output.md"
json="$TEST_TEMP_DIR/report.json"
bash "$SCRIPT" "$TEST_TEMP_DIR/logs" --json-out "$json" > "$output"

assert_contains "$output" '### Runner Lock Wait/Hold'
assert_contains "$output" '| `node-toolchain` | 2 | 1 | 3s | 9s | 0 | 1 | 0 |'
assert_contains "$output" '| `e2e` | 2 | 2 | 10s | 9s (1/2 known) | 1 | 0 | 0 |'
assert_contains "$output" '| `orphan` | 1 | 1 | 1s | n/a | 0 | 0 | 1 |'
assert_contains "$output" '| `release-only` | 1 | 0 | n/a | 7s | 0 | 0 | 1 |'
jq -e '.schema_version == 1 and .precision == "whole-seconds"' "$json" >/dev/null
jq -e '[.invocations[] | select(.lock == "node-toolchain")] | length == 2' "$json" >/dev/null
jq -e '.invocations[] | select(.lock == "e2e" and .outcome == "timeout") | .hold_seconds == null' "$json" >/dev/null
jq -e '.invocations[] | select(.lock == "orphan") | .outcome == "incomplete"' "$json" >/dev/null
jq -e '[.invocations[] | select(.lock == "prose")] | length == 0' "$json" >/dev/null

mkdir -p "$TEST_TEMP_DIR/empty"
bash "$SCRIPT" "$TEST_TEMP_DIR/empty" > "$TEST_TEMP_DIR/empty.md"
assert_contains "$TEST_TEMP_DIR/empty.md" 'No runner-lock records were found.'
jq -e '.invocations == [] and .aggregates == []' \
  "$TEST_TEMP_DIR/empty/runner-lock-summary.json" >/dev/null

if bash "$SCRIPT" "$TEST_TEMP_DIR/missing" >/dev/null 2>&1; then
  fail 'missing diagnostic directory unexpectedly succeeded'
fi

echo 'runner-lock aggregation regression checks passed'
