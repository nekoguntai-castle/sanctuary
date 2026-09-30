#!/usr/bin/env bash
# run-parallel-suites.sh must overlap its commands, run every command even
# after one fails, name each failed command and print its log, skip blank and
# comment lines, and fail when a command's result is missing (R7 of
# tasks/ci-speedup-analysis-2026-09-29.md).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="$ROOT_DIR/scripts/ci/run-parallel-suites.sh"
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
  grep -Fq -- "$1" "$2" || fail "expected $2 to contain: $1"
}

assert_not_contains() {
  if grep -Fq -- "$1" "$2"; then
    fail "expected $2 not to contain: $1"
  fi
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT
  bash -n "$RUNNER"
  local markers="$TEST_TEMP_DIR/markers"
  local out="$TEST_TEMP_DIR/out"
  mkdir -p "$markers"

  # Each command records its start, then waits for the other to start. A serial
  # runner would never start the second while the first waits.
  local wait_for='for _ in $(seq 100); do [ -e "$M/$2" ] && break; sleep 0.1; done; [ -e "$M/$2" ]'
  cat >"$TEST_TEMP_DIR/overlap.sh" <<OVERLAP
#!/usr/bin/env bash
set -euo pipefail
: >"\$M/\$1"
${wait_for}
echo "suite \$1 ran"
OVERLAP
  M="$markers" bash "$RUNNER" "$TEST_TEMP_DIR/logs" >"$out" 2>&1 <<COMMANDS ||
# a comment line

bash $TEST_TEMP_DIR/overlap.sh a b
   bash $TEST_TEMP_DIR/overlap.sh b a
COMMANDS
    { cat "$out" >&2; fail 'expected two overlapping commands to pass'; }
  assert_contains '2/2 commands finished, 0 failed' "$out"
  assert_contains 'suite a ran' "$TEST_TEMP_DIR/logs/0.log"
  assert_contains 'suite b ran' "$TEST_TEMP_DIR/logs/1.log"

  # A failing command is reported with its log; later commands still run, and
  # stale results from the earlier run in the same directory do not count.
  if SANCTUARY_PARALLEL_SUITES_JOBS=1 bash "$RUNNER" "$TEST_TEMP_DIR/logs" >"$out" 2>&1 <<COMMANDS
echo first-output; exit 7
echo second-output
false
COMMANDS
  then
    fail 'expected a failing command to fail the run'
  fi
  assert_contains '3/3 commands finished, 2 failed' "$out"
  assert_contains 'FAILED (exit 7): echo first-output; exit 7' "$out"
  assert_contains 'first-output' "$out"
  assert_contains 'FAILED: false' "$out"
  assert_not_contains 'FAILED: echo second-output' "$out"
  assert_contains 'second-output' "$TEST_TEMP_DIR/logs/1.log"

  # `set -e` applies inside each command, so a failure mid-command is not
  # masked by a later successful statement.
  if bash "$RUNNER" "$TEST_TEMP_DIR/logs" >"$out" 2>&1 <<'COMMANDS'
false; echo masked
COMMANDS
  then
    fail 'expected a mid-command failure to fail the run'
  fi
  assert_contains '1/1 commands finished, 1 failed' "$out"

  # A command whose status file never appears is reported, not counted as passed.
  mkdir -p "$TEST_TEMP_DIR/fake-bin"
  cat >"$TEST_TEMP_DIR/fake-bin/xargs" <<'FAKE_XARGS'
#!/usr/bin/env bash
cat >/dev/null
FAKE_XARGS
  chmod +x "$TEST_TEMP_DIR/fake-bin/xargs"
  if PATH="$TEST_TEMP_DIR/fake-bin:$PATH" bash "$RUNNER" "$TEST_TEMP_DIR/logs" >"$out" 2>&1 <<'COMMANDS'
true
COMMANDS
  then
    fail 'expected a command without a result to fail the run'
  fi
  assert_contains '0/1 commands finished' "$out"
  assert_contains 'DID NOT FINISH: true' "$out"

  if bash "$RUNNER" "$TEST_TEMP_DIR/logs" >"$out" 2>&1 <<<'# only a comment'; then
    fail 'expected an empty command list to fail'
  fi
  assert_contains 'no commands were given' "$out"

  if SANCTUARY_PARALLEL_SUITES_JOBS=0 bash "$RUNNER" "$TEST_TEMP_DIR/logs" >"$out" 2>&1 <<<'true'; then
    fail 'expected a zero job count to fail'
  fi
  assert_contains 'must be a positive integer' "$out"

  echo 'run-parallel-suites checks passed'
}

main "$@"
