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

# Non-regression (2026-10-05: runs 20181, 20245, 20268). The step feeds its
# script to bash through a heredoc, so actionlint inherited that stdin, and it
# wedged with no child process until the cap. actionlint must get an empty
# stdin; a wedged attempt must dump its goroutines (SIGQUIT) and be retried
# once within the step budget.
cat >"$TEST_DIR/fake-actionlint-stateful" <<'FAKE_ACTIONLINT'
#!/usr/bin/env bash
set -eu
count_file="${ACTIONLINT_TEST_COUNT:?}"
count=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$count" >"$count_file"
cat >"${ACTIONLINT_TEST_STDIN:?}.$count"
trap 'printf "goroutine dump requested\n" >&2; exit 2' QUIT
if [ "$count" -le "${ACTIONLINT_TEST_WEDGED_ATTEMPTS:?}" ]; then
  sleep 10 &
  wait $!
fi
printf 'lint ok\n'
FAKE_ACTIONLINT
chmod +x "$TEST_DIR/fake-actionlint-stateful"
export SANCTUARY_ACTIONLINT_BIN="$TEST_DIR/fake-actionlint-stateful"
export ACTIONLINT_TEST_COUNT="$TEST_DIR/count"
export ACTIONLINT_TEST_STDIN="$TEST_DIR/stdin"

# One wedged attempt, then a clean one: the wrapper succeeds, warns, and the
# wedged attempt received SIGQUIT.
rm -f "$ACTIONLINT_TEST_COUNT"
set +e
ACTIONLINT_TEST_WEDGED_ATTEMPTS=1 "$WRAPPER" >"$TEST_DIR/stdout" 2>"$TEST_DIR/stderr" <<<'heredoc script text'
status=$?
set -e
[[ "$status" == 0 ]] || { echo "FAIL: expected a retried success, got $status" >&2; exit 1; }
[[ "$(cat "$ACTIONLINT_TEST_COUNT")" == 2 ]] || { echo 'FAIL: expected exactly two attempts' >&2; exit 1; }
grep -q 'goroutine dump requested' "$TEST_DIR/stderr" || { echo 'FAIL: wedged attempt did not get SIGQUIT' >&2; exit 1; }
grep -q '::warning' "$TEST_DIR/stdout" "$TEST_DIR/stderr" || { echo 'FAIL: retry was not announced' >&2; exit 1; }
for attempt in 1 2; do
  [[ ! -s "$ACTIONLINT_TEST_STDIN.$attempt" ]] || { echo "FAIL: attempt $attempt read the caller's stdin" >&2; exit 1; }
done

# Two wedged attempts still fail with the timeout status.
rm -f "$ACTIONLINT_TEST_COUNT"
set +e
ACTIONLINT_TEST_WEDGED_ATTEMPTS=2 "$WRAPPER" >"$TEST_DIR/stdout" 2>"$TEST_DIR/stderr" </dev/null
status=$?
set -e
[[ "$status" == 124 ]] || { echo "FAIL: expected 124 after two wedged attempts, got $status" >&2; exit 1; }
[[ "$(cat "$ACTIONLINT_TEST_COUNT")" == 2 ]] || { echo 'FAIL: expected no third attempt' >&2; exit 1; }

# A real lint failure is not retried.
cat >"$TEST_DIR/fake-actionlint-fails" <<'FAKE_ACTIONLINT'
#!/usr/bin/env bash
count_file="${ACTIONLINT_TEST_COUNT:?}"
printf '%s' $(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 )) >"$count_file"
exit 1
FAKE_ACTIONLINT
chmod +x "$TEST_DIR/fake-actionlint-fails"
rm -f "$ACTIONLINT_TEST_COUNT"
set +e
SANCTUARY_ACTIONLINT_BIN="$TEST_DIR/fake-actionlint-fails" "$WRAPPER" >/dev/null 2>&1 </dev/null
status=$?
set -e
[[ "$status" == 1 && "$(cat "$ACTIONLINT_TEST_COUNT")" == 1 ]] || { echo "FAIL: lint failure must fail once without retry (status $status)" >&2; exit 1; }

printf 'PASS: actionlint gets no stdin, dumps and retries a wedge once, never retries lint failures\n'
