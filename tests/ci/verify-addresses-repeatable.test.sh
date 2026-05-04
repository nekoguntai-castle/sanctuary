#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/verify-addresses/verify-repeatable.sh"
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

write_stubs() {
  local bin_dir="$TEST_TEMP_DIR/bin"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/python3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "-m" ] && [ "$2" = "venv" ] && [ "$3" = "--clear" ]; then
  counter_file="${VERIFY_STUB_VENV_COUNTER:?}"
  count="$(cat "$counter_file" 2>/dev/null || echo 0)"
  count=$((count + 1))
  echo "$count" > "$counter_file"
  if [ "$count" -le "${VERIFY_STUB_VENV_FAILS:-0}" ]; then
    exit 1
  fi

  venv_dir="$4"
  rm -rf "$venv_dir"
  mkdir -p "$venv_dir/bin"
  cat > "$venv_dir/bin/python" <<'PYEOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "-m" ] && [ "${2:-}" = "pip" ] && [ "${3:-}" = "install" ]; then
  counter_file="${VERIFY_STUB_PIP_COUNTER:?}"
  count="$(cat "$counter_file" 2>/dev/null || echo 0)"
  count=$((count + 1))
  echo "$count" > "$counter_file"
  printf '%s\n' "$*" >> "${VERIFY_STUB_PIP_LOG:?}"
  if [ "$count" -le "${VERIFY_STUB_PIP_FAILS:-0}" ]; then
    exit 1
  fi
  exit 0
fi

if [ "${1:-}" = "-c" ]; then
  echo '2.12.1'
  exit 0
fi

exit 2
PYEOF
  chmod +x "$venv_dir/bin/python"
  exit 0
fi

if [ "$1" = "-m" ] && [ "$2" = "venv" ] && [ "$3" = "--help" ]; then
  exit 0
fi

exit 2
EOF
  chmod +x "$bin_dir/python3"

  cat > "$bin_dir/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--prefix" ] && [ "${3:-}" = "ci" ]; then
  exit 0
fi

if [ "${1:-}" = "run" ] && { [ "${2:-}" = "verify" ] || [ "${2:-}" = "generate" ]; }; then
  [ -x "${VERIFY_ADDRESSES_PYTHON:?}" ] || exit 1
  printf '%s\n' "$VERIFY_ADDRESSES_PYTHON" > "${VERIFY_STUB_USED_PYTHON:?}"
  exit 0
fi

exit 2
EOF
  chmod +x "$bin_dir/npm"

  cat > "$bin_dir/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$bin_dir/curl"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SCRIPT"
  write_stubs
  mkdir -p "$TEST_TEMP_DIR/runner"

  : > "$TEST_TEMP_DIR/venv-counter"
  : > "$TEST_TEMP_DIR/pip-counter"
  : > "$TEST_TEMP_DIR/pip-log"
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR/runner" \
    VERIFY_ADDRESSES_SKIP_DOCKER=1 \
    VERIFY_STUB_VENV_COUNTER="$TEST_TEMP_DIR/venv-counter" \
    VERIFY_STUB_VENV_FAILS=1 \
    VERIFY_STUB_PIP_COUNTER="$TEST_TEMP_DIR/pip-counter" \
    VERIFY_STUB_PIP_LOG="$TEST_TEMP_DIR/pip-log" \
    VERIFY_STUB_PIP_FAILS=0 \
    VERIFY_STUB_USED_PYTHON="$TEST_TEMP_DIR/used-python" \
    VERIFY_ADDRESSES_PYTHON_INSTALL_ATTEMPTS=2 \
    bash "$SCRIPT" verify >/dev/null

  [ "$(cat "$TEST_TEMP_DIR/venv-counter")" = "2" ] ||
    fail 'expected venv creation retry after first failure'
  [ "$(cat "$TEST_TEMP_DIR/pip-counter")" = "2" ] ||
    fail 'expected pip installs after retry'
  grep -F -- '--no-cache-dir' "$TEST_TEMP_DIR/pip-log" >/dev/null ||
    fail 'expected pip cache to be disabled on retry'

  used_python="$(cat "$TEST_TEMP_DIR/used-python")"
  case "$used_python" in
    "$TEST_TEMP_DIR"/runner/verify-addresses-python.*/bin/python) ;;
    *) fail "expected generated verifier venv path, got $used_python" ;;
  esac

  if [ -d "$(dirname "$(dirname "$used_python")")" ]; then
    fail 'expected generated verifier venv cleanup'
  fi

  echo 'verify-addresses repeatable helper checks passed'
}

main "$@"
