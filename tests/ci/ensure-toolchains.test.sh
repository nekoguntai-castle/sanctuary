#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_SCRIPT="$ROOT_DIR/scripts/ci/ensure-node.sh"
PYTHON_SCRIPT="$ROOT_DIR/scripts/ci/ensure-python.sh"
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

assert_fails_with() {
  local expected="$1"
  shift

  local output_file="$TEST_TEMP_DIR/output"
  if "$@" >"$output_file" 2>&1; then
    fail "expected command to fail: $*"
  fi

  grep -Fq "$expected" "$output_file" || fail "expected output to contain: ${expected}"
}

write_toolchain_stubs() {
  local bin_dir="$TEST_TEMP_DIR/bin"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  echo "v${SANCTUARY_STUB_NODE_VERSION:-24.14.1}"
  exit 0
fi
exit 2
EOF
  chmod +x "$bin_dir/node"

  cat > "$bin_dir/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  echo "${SANCTUARY_STUB_NPM_VERSION:-11.6.2}"
  exit 0
fi
exit 2
EOF
  chmod +x "$bin_dir/npm"

  cat > "$bin_dir/python3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-c" ]; then
  echo "${SANCTUARY_STUB_PYTHON_VERSION:-3.12.11}"
  exit 0
fi
exit 2
EOF
  chmod +x "$bin_dir/python3"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$NODE_SCRIPT"
  bash -n "$PYTHON_SCRIPT"
  write_toolchain_stubs

  PATH="$TEST_TEMP_DIR/bin:$PATH" NODE_VERSION=24.14.1 bash "$NODE_SCRIPT" >/dev/null
  PATH="$TEST_TEMP_DIR/bin:$PATH" NODE_VERSION=24.14 bash "$NODE_SCRIPT" >/dev/null
  PATH="$TEST_TEMP_DIR/bin:$PATH" NODE_VERSION=24 bash "$NODE_SCRIPT" >/dev/null
  assert_fails_with 'expected Node.js 24.14.2, got 24.14.1' \
    env PATH="$TEST_TEMP_DIR/bin:$PATH" NODE_VERSION=24.14.2 bash "$NODE_SCRIPT"
  assert_fails_with 'NODE_VERSION is required' \
    env -u NODE_VERSION -u SANCTUARY_NODE_VERSION PATH="$TEST_TEMP_DIR/bin:$PATH" bash "$NODE_SCRIPT"
  assert_fails_with 'unexpected arguments' \
    env PATH="$TEST_TEMP_DIR/bin:$PATH" NODE_VERSION=24 bash "$NODE_SCRIPT" extra

  : > "$TEST_TEMP_DIR/github-env"
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    PYTHON_VERSION=3.12 \
    GITHUB_ENV="$TEST_TEMP_DIR/github-env" \
    bash "$PYTHON_SCRIPT" >/dev/null
  grep -E '^SANCTUARY_PYTHON_BIN=.+/python3$' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected SANCTUARY_PYTHON_BIN export'

  assert_fails_with 'expected Python 3.11, got 3.12.11' \
    env PATH="$TEST_TEMP_DIR/bin:$PATH" PYTHON_VERSION=3.11 bash "$PYTHON_SCRIPT"
  assert_fails_with 'PYTHON_VERSION is required' \
    env -u PYTHON_VERSION -u SANCTUARY_PYTHON_VERSION PATH="$TEST_TEMP_DIR/bin:$PATH" bash "$PYTHON_SCRIPT"
  assert_fails_with 'unexpected arguments' \
    env PATH="$TEST_TEMP_DIR/bin:$PATH" PYTHON_VERSION=3 bash "$PYTHON_SCRIPT" extra

  echo 'toolchain gate checks passed'
}

main "$@"
