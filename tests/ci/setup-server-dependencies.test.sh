#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/setup-server-dependencies.sh"
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

assert_no_line() {
  if grep -Fxq "$2" "$1"; then
    fail "expected $1 not to contain line: $2"
  fi
}

write_mock_commands() {
  local bin_dir="$1"
  local log_file="$2"
  local npx_count_file="$3"

  cat >"$bin_dir/npm" <<MOCK
#!/usr/bin/env bash
printf 'npm:%s:%s\\n' "\$PWD" "\$*" >> "$log_file"
case " \$* " in
  *" ci --ignore-scripts "*) exit 0 ;;
  *" --workspace shared run build "*) exit 0 ;;
  *) exit 64 ;;
esac
MOCK

  cat >"$bin_dir/node" <<MOCK
#!/usr/bin/env bash
printf 'node:%s:%s\\n' "\$PWD" "\$*" >> "$log_file"
exit 0
MOCK

  cat >"$bin_dir/npx" <<MOCK
#!/usr/bin/env bash
printf 'npx:%s:%s\\n' "\$PWD" "\$*" >> "$log_file"
count="\$(cat "$npx_count_file")"
count="\$((count + 1))"
printf '%s' "\$count" > "$npx_count_file"
[ "\$count" -ge 2 ]
MOCK

  chmod +x "$bin_dir/npm" "$bin_dir/node" "$bin_dir/npx"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SCRIPT"

  local server_dir="$TEST_TEMP_DIR/server"
  local bin_dir="$TEST_TEMP_DIR/bin"
  local log_file="$TEST_TEMP_DIR/commands.log"
  local npx_count_file="$TEST_TEMP_DIR/npx-count"
  mkdir -p "$server_dir/scripts" "$bin_dir"
  touch "$server_dir/package-lock.json" "$server_dir/package.json"
  : >"$log_file"
  printf '0' >"$npx_count_file"
  write_mock_commands "$bin_dir" "$log_file" "$npx_count_file"

  # ROOT_DIR is computed by the script from its own location, so it points
  # at the real repo root regardless of SANCTUARY_SERVER_DIR override.
  local root_dir
  root_dir="$(cd "$(dirname "$SCRIPT")/../.." && pwd)"

  PATH="$bin_dir:$PATH" \
    SANCTUARY_SERVER_DIR="$server_dir" \
    SANCTUARY_SERVER_SETUP_NO_LOCK=1 \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    bash "$SCRIPT"

  # Phase B: install at root for workspace hoisting; build shared after.
  # Phase H: ensure-shared-module-resolution.mjs invocation removed.
  assert_contains "$log_file" "npm:$root_dir:ci --ignore-scripts"
  assert_contains "$log_file" "npm:$root_dir:--workspace shared run build"
  assert_contains "$log_file" "npx:$server_dir:prisma generate"
  if grep -Fq "ensure-shared-module-resolution" "$log_file"; then
    fail 'ensure-shared-module-resolution.mjs invocation should be removed (Phase H)'
  fi
  [ "$(cat "$npx_count_file")" = '2' ] || fail 'expected prisma generate to retry once'

  # Cache-hit scenario: both env vars set to 'true' should skip npm ci AND
  # prisma generate but still run the shared-schema link AND the shared build
  # (build is unconditional because the cache may not capture shared/dist).
  local hit_log="$TEST_TEMP_DIR/commands-hit.log"
  : >"$hit_log"
  printf '0' >"$npx_count_file"
  write_mock_commands "$bin_dir" "$hit_log" "$npx_count_file"

  PATH="$bin_dir:$PATH" \
    SANCTUARY_SERVER_DIR="$server_dir" \
    SANCTUARY_SERVER_SETUP_NO_LOCK=1 \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    SERVER_NODE_MODULES_CACHE_HIT=true \
    SERVER_PRISMA_CACHE_HIT=true \
    bash "$SCRIPT"

  if grep -Fq "npm:$root_dir:ci --ignore-scripts" "$hit_log"; then
    fail 'expected npm ci to be skipped when SERVER_NODE_MODULES_CACHE_HIT=true'
  fi
  if grep -Fq "npx:$server_dir:prisma generate" "$hit_log"; then
    fail 'expected prisma generate to be skipped when SERVER_PRISMA_CACHE_HIT=true'
  fi
  assert_contains "$hit_log" "npm:$root_dir:--workspace shared run build"

  # Partial-hit scenario: only Prisma cache hit; npm ci still runs.
  local partial_log="$TEST_TEMP_DIR/commands-partial.log"
  : >"$partial_log"
  printf '0' >"$npx_count_file"
  write_mock_commands "$bin_dir" "$partial_log" "$npx_count_file"

  PATH="$bin_dir:$PATH" \
    SANCTUARY_SERVER_DIR="$server_dir" \
    SANCTUARY_SERVER_SETUP_NO_LOCK=1 \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    SERVER_NODE_MODULES_CACHE_HIT=false \
    SERVER_PRISMA_CACHE_HIT=true \
    bash "$SCRIPT"

  assert_contains "$partial_log" "npm:$root_dir:ci --ignore-scripts"
  assert_contains "$partial_log" "npm:$root_dir:--workspace shared run build"
  if grep -Fq "npx:$server_dir:prisma generate" "$partial_log"; then
    fail 'expected prisma generate to be skipped when SERVER_PRISMA_CACHE_HIT=true even on partial node_modules miss'
  fi

  echo 'setup-server-dependencies regression checks passed'
}

main "$@"
