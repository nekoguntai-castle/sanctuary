#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRAPPER="$ROOT_DIR/scripts/ci/actionlint-shellcheck.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

cat >"$TEST_DIR/fake-shellcheck" <<'FAKE_SHELLCHECK'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${ACTIONLINT_SHELLCHECK_TEST_STATE:?}"
count=0
if [[ -f "$state_dir/count" ]]; then
  count="$(<"$state_dir/count")"
fi
count=$((count + 1))
printf '%s\n' "$count" >"$state_dir/count"
printf '%s\n' "$*" >>"$state_dir/args"
cat >"$state_dir/input-$count"
sleep 0.05
exit "${ACTIONLINT_SHELLCHECK_TEST_EXIT:-0}"
FAKE_SHELLCHECK
chmod +x "$TEST_DIR/fake-shellcheck"

export SANCTUARY_ACTIONLINT_FLOCK_BIN=/usr/bin/flock
export SANCTUARY_ACTIONLINT_SHELLCHECK_BIN="$TEST_DIR/fake-shellcheck"
export SANCTUARY_ACTIONLINT_SHELLCHECK_LOCK="$TEST_DIR/wrapper.lock"
export ACTIONLINT_SHELLCHECK_TEST_STATE="$TEST_DIR"

pids=()
for index in 1 2 3 4; do
  printf 'script-%s\n' "$index" | "$WRAPPER" --severity=error - &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done

[[ "$(<"$TEST_DIR/count")" == "4" ]]
[[ "$(wc -l <"$TEST_DIR/args")" == "4" ]]
for index in 1 2 3 4; do
  grep -qx "script-$index" "$TEST_DIR"/input-*
done

export ACTIONLINT_SHELLCHECK_TEST_EXIT=23
set +e
printf 'failure-case\n' | "$WRAPPER" --severity=error -
status=$?
set -e
[[ "$status" == "23" ]]

printf 'PASS: actionlint ShellCheck wrapper serializes stdin consumers and preserves exit status\n'
