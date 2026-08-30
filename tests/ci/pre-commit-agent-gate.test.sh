#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRE_COMMIT_HOOK="$ROOT_DIR/server/.husky/pre-commit"
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
  local haystack="$1"
  local needle="$2"
  case "$haystack" in
    *"$needle"*) ;;
    *) fail "expected output to contain: $needle" ;;
  esac
}

assert_file_equals() {
  local expected="$1"
  local file="$2"
  local actual
  actual="$(cat "$file" 2>/dev/null || printf '')"
  [ "$actual" = "$expected" ] || fail "expected ${file} to contain ${expected}, got ${actual}"
}

assert_file_exists() {
  local file="$1"
  [ -e "$file" ] || fail "expected file to exist: $file"
}

assert_file_absent() {
  local file="$1"
  [ ! -e "$file" ] || fail "expected file to be absent: $file"
}

assert_cache_verdict() {
  local file="$1"
  local expected="$2"
  jq -e --arg expected "$expected" '.verdict == $expected' "$file" >/dev/null \
    || fail "expected ${file} to contain verdict ${expected}"
}

write_claude_stub() {
  local stub_dir="$1"
  mkdir -p "$stub_dir"
  cat > "$stub_dir/claude" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

count="$(cat "$CLAUDE_COUNT_FILE" 2>/dev/null || printf '0')"
count="$((count + 1))"
printf '%s' "$count" > "$CLAUDE_COUNT_FILE"
printf '%s\n' "$*" >> "$CLAUDE_ARGS_FILE"
for var in $CLAUDE_GIT_ENV_VARS; do
  eval "value=\${$var-<unset>}"
  printf '%s=%s\n' "$var" "$value" >> "$CLAUDE_ENV_FILE"
done
cat > "$CLAUDE_PROMPT_DIR/prompt-${count}.txt"

if [ -f "$CLAUDE_RESPONSE_DIR/${count}" ]; then
  cat "$CLAUDE_RESPONSE_DIR/${count}"
elif [ -f "$CLAUDE_RESPONSE_DIR/default" ]; then
  cat "$CLAUDE_RESPONSE_DIR/default"
fi
STUB
  chmod +x "$stub_dir/claude"
}

reset_case() {
  local name="$1"
  local case_dir="$TEST_TEMP_DIR/$name"
  rm -rf "$case_dir"
  mkdir -p "$case_dir/responses" "$case_dir/prompts"

  AGENT_TMP_DIR="$case_dir/agent-tmp"
  AGENT_LOG_DIR="$case_dir/claude-state"
  AGENT_LOG_FILE="$AGENT_LOG_DIR/agent-audit.jsonl"
  AGENT_CACHE_DIR="$AGENT_LOG_DIR/agent-cache"
  DIFF_HASH="$name"
  mkdir -p "$AGENT_TMP_DIR" "$AGENT_CACHE_DIR"

  export CLAUDE_COUNT_FILE="$case_dir/count"
  export CLAUDE_ARGS_FILE="$case_dir/args"
  export CLAUDE_PROMPT_DIR="$case_dir/prompts"
  export CLAUDE_RESPONSE_DIR="$case_dir/responses"
  export CLAUDE_ENV_FILE="$case_dir/agent-env"
  : > "$CLAUDE_ARGS_FILE"
  : > "$CLAUDE_ENV_FILE"
}

write_response() {
  local index="$1"
  local body="$2"
  printf '%s\n' "$body" > "$CLAUDE_RESPONSE_DIR/$index"
}

cache_file_for() {
  local agent_name="$1"
  printf '%s/%s-%s-%s.txt' "$AGENT_CACHE_DIR" "$PROMPT_VERSION" "$DIFF_HASH" "$agent_name"
}

run_agent() {
  invoke_agent_with_cache "backend-quality" "lead-software-architect" "review this diff" 1 "backend-quality"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  export CLAUDE_GIT_ENV_VARS
  CLAUDE_GIT_ENV_VARS="$(git rev-parse --local-env-vars)"

  local stub_dir="$TEST_TEMP_DIR/bin"
  write_claude_stub "$stub_dir"
  PATH="$stub_dir:$PATH"

  export SANCTUARY_PRE_COMMIT_LIBRARY_ONLY=1
  export SANCTUARY_AGENT_LOG_DIR="$TEST_TEMP_DIR/library-claude-state"
  export SANCTUARY_AGENT_TMP_DIR="$TEST_TEMP_DIR/library-agent-tmp"
  # shellcheck source=/dev/null
  . "$PRE_COMMIT_HOOK"
  unset SANCTUARY_PRE_COMMIT_LIBRARY_ONLY
  unset SANCTUARY_AGENT_TMP_DIR
  trap cleanup EXIT

  is_precommit_release_path "tests/release/release-candidate-canary.test.mjs" \
    || fail "release contract path was not classified for the release suite"
  is_precommit_release_path "scripts/release/verify-release-candidate-canary.mjs" \
    || fail "release implementation path was not classified for the release suite"
  if is_precommit_backend_path "server/.husky/pre-commit"; then
    fail "pre-commit hook was incorrectly classified as backend"
  fi
  is_precommit_backend_path "server/src/index.ts" \
    || fail "backend source path was not classified as backend"
  if is_precommit_frontend_path "tests/release/release-candidate-canary.test.mjs"; then
    fail "release contract path was incorrectly classified as frontend"
  fi
  is_precommit_frontend_path "tests/components/Wallet.test.tsx" \
    || fail "frontend test path was not classified as frontend"
  is_precommit_frontend_path "src/components/Wallet.tsx" \
    || fail "frontend source path was not classified as frontend"
  if is_precommit_frontend_path "tests/ci/classify-test-changes.test.sh"; then
    fail "CI shell test was incorrectly classified as frontend"
  fi
  for guarded_command in \
    'run_without_git_env npx prisma generate' \
    'run_without_git_env timeout $TEST_TIMEOUT npm run test:fast' \
    'run_without_git_env timeout $TEST_TIMEOUT npm run test:release-distribution' \
    'run_without_git_env timeout $TEST_TIMEOUT npm run test:run'; do
    grep -Fq "$guarded_command" "$PRE_COMMIT_HOOK" \
      || fail "pre-commit subprocess does not clear Git hook state: $guarded_command"
  done

  local proceed_json='{"rubric":{"format":"OK"},"verdict":"PROCEED","issues":[]}'
  local output cache_file agent_env leaked_var

  reset_case "malformed-cache-rerun"
  cache_file="$(cache_file_for backend-quality)"
  printf 'not-json\n' > "$cache_file"
  write_response 1 "$proceed_json"
  output="$(run_agent 2>&1)"
  assert_contains "$output" "cached backend-quality output was malformed"
  assert_file_equals "1" "$CLAUDE_COUNT_FILE"
  assert_contains "$(cat "$CLAUDE_ARGS_FILE")" "--agent lead-software-architect --print"
  assert_cache_verdict "$cache_file" "PROCEED"
  assert_file_absent "$AGENT_TMP_DIR/backend-quality.stop"

  reset_case "fresh-malformed-retry"
  cache_file="$(cache_file_for backend-quality)"
  write_response 1 "not-json"
  write_response 2 "$proceed_json"
  output="$(run_agent 2>&1)"
  assert_contains "$output" "retry produced parseable JSON"
  assert_file_equals "2" "$CLAUDE_COUNT_FILE"
  assert_contains "$(cat "$CLAUDE_PROMPT_DIR/prompt-2.txt")" "Your previous response was malformed"
  assert_cache_verdict "$cache_file" "PROCEED"
  assert_file_absent "$AGENT_TMP_DIR/backend-quality.stop"

  reset_case "persistent-unknown"
  cache_file="$(cache_file_for backend-quality)"
  write_response 1 "not-json"
  write_response 2 "still-not-json"
  output="$(run_agent 2>&1)"
  assert_contains "$output" "failing closed"
  assert_file_equals "2" "$CLAUDE_COUNT_FILE"
  assert_file_exists "$AGENT_TMP_DIR/backend-quality.stop"
  assert_file_absent "$cache_file"

  # Non-regression: git exports its hook environment to every hook, and the
  # agent refreshes plugin marketplaces that are themselves git repositories.
  # Leaking GIT_INDEX_FILE/GIT_DIR into the agent lets a git command inside a
  # marketplace write that repository's entries into the index being committed,
  # which kills the commit with "error: Error building trees" and leaves a
  # corrupted index behind.
  reset_case "strips-git-env"
  write_response 1 "$proceed_json"
  for leaked_var in $CLAUDE_GIT_ENV_VARS; do
    export "$leaked_var=$TEST_TEMP_DIR/leaked-$leaked_var"
  done
  run_agent >/dev/null 2>&1
  assert_file_equals "1" "$CLAUDE_COUNT_FILE"
  agent_env="$(cat "$CLAUDE_ENV_FILE")"
  for leaked_var in $CLAUDE_GIT_ENV_VARS; do
    assert_contains "$agent_env" "${leaked_var}=<unset>"
    unset "$leaked_var"
  done

  echo "pre-commit agent gate regression checks passed"
}

main "$@"
