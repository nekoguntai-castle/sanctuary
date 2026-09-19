#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRAPPER="$ROOT_DIR/scripts/ci/run-actionlint.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

cat >"$TEST_DIR/fake-actionlint" <<'FAKE_ACTIONLINT'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >"${ACTIONLINT_TEST_ARGS:?}"
sleep 10
FAKE_ACTIONLINT
chmod +x "$TEST_DIR/fake-actionlint"

export ACTIONLINT_TEST_ARGS="$TEST_DIR/args"
export SANCTUARY_ACTIONLINT_BIN="$TEST_DIR/fake-actionlint"
export SANCTUARY_ACTIONLINT_TIMEOUT_SECONDS=1

if ! timeout --help 2>&1 | grep -q -- '--kill-after'; then
  printf 'SKIP: GNU timeout with --kill-after is required\n'
  exit 0
fi

set +e
"$WRAPPER" >"$TEST_DIR/stdout" 2>"$TEST_DIR/stderr"
status=$?
set -e

[[ "$status" == 124 ]] || {
  echo "FAIL: expected timeout status 124, got $status" >&2
  exit 1
}
grep -q -- '-color' "$TEST_DIR/args"
grep -q -- '-shellcheck=' "$TEST_DIR/args"
grep -q -- '-ignore' "$TEST_DIR/args"

printf 'PASS: actionlint invocation is bounded and preserves timeout status\n'
