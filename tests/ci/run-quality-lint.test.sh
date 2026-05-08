#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LINT_SCRIPT="$REPO_ROOT/scripts/ci/run-quality-lint.sh"

TMP_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "$label: missing '$needle'"
  fi
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" != "$actual" ]; then
    fail "$label: expected '$expected', got '$actual'"
  fi
}

make_source_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  printf '{"scripts":{"lint":"echo lint"}}\n' > "$repo/package.json"
  git -C "$repo" add package.json
  git -C "$repo" \
    -c user.email=ci@example.invalid \
    -c user.name='CI Test' \
    commit -qm 'fixture'
}

write_fake_npm() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/npm" <<'NPM'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$PWD $*" >> "$NPM_CALL_LOG"

if [ "${1:-}" = "ci" ]; then
  printf '%s\n' "$PWD" >> "$NPM_CI_WORKDIRS"
  exit 0
fi

if [ "${1:-}" = "run" ] && [ "${2:-}" = "lint" ]; then
  count=0
  if [ -f "$NPM_LINT_COUNT_FILE" ]; then
    count="$(cat "$NPM_LINT_COUNT_FILE")"
  fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$NPM_LINT_COUNT_FILE"
  printf '%s\n' "$PWD" >> "$NPM_LINT_WORKDIRS"
  if [ "$count" -eq 1 ]; then
    exit 2
  fi
  exit 0
fi

exit 99
NPM
  chmod +x "$bin_dir/npm"
}

test_retries_with_fresh_workspace() {
  local source_repo="$TMP_ROOT/source"
  local fake_bin="$TMP_ROOT/bin"
  local runner_temp="$TMP_ROOT/runner"
  local output

  make_source_repo "$source_repo"
  write_fake_npm "$fake_bin"
  mkdir -p "$runner_temp"

  export NPM_CALL_LOG="$TMP_ROOT/npm-calls.log"
  export NPM_CI_WORKDIRS="$TMP_ROOT/npm-ci-workdirs.log"
  export NPM_LINT_WORKDIRS="$TMP_ROOT/npm-lint-workdirs.log"
  export NPM_LINT_COUNT_FILE="$TMP_ROOT/npm-lint-count"

  output="$(
    PATH="$fake_bin:$PATH" \
    SANCTUARY_CI_WORKSPACE_OVERRIDE="$source_repo" \
    SANCTUARY_CI_TEMP_DIR_OVERRIDE="$runner_temp" \
    SANCTUARY_LINT_ATTEMPTS=2 \
    SANCTUARY_LINT_DELAY_SECONDS=0 \
    bash "$LINT_SCRIPT"
  )"

  assert_contains "$output" 'quality lint workspace, attempt 1' 'first attempt logged'
  assert_contains "$output" 'quality lint workspace, attempt 2' 'retry attempt logged'
  assert_eq 'npm ci attempts' '2' "$(wc -l < "$NPM_CI_WORKDIRS" | tr -d ' ')"
  assert_eq 'npm run lint attempts' '2' "$(wc -l < "$NPM_LINT_WORKDIRS" | tr -d ' ')"

  while IFS= read -r workdir; do
    [ ! -d "$workdir" ] || fail "lint workdir should be removed after attempt: $workdir"
  done < "$NPM_CI_WORKDIRS"
}

test_rejects_invalid_attempt_count() {
  local output status
  set +e
  output="$(SANCTUARY_LINT_ATTEMPTS=0 bash "$LINT_SCRIPT" 2>&1)"
  status="$?"
  set -e

  [ "$status" -ne 0 ] || fail 'invalid attempt count should fail'
  assert_contains "$output" 'SANCTUARY_LINT_ATTEMPTS must be a positive integer' \
    'invalid attempt count error'
}

test_retries_with_fresh_workspace
test_rejects_invalid_attempt_count
echo 'quality lint runner regression checks passed'
