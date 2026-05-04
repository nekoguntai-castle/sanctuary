#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/install-semgrep.sh"
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

write_python_stub() {
  local bin_dir="$TEST_TEMP_DIR/bin"

  mkdir -p "$bin_dir"
  cat > "$bin_dir/python3" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" != "-m" ]; then
  exit 2
fi

case "$2" in
  venv)
    venv_dir="$3"
    mkdir -p "$venv_dir/bin"
    cat > "$venv_dir/bin/python" <<'PYEOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  exit 0
fi
exit 2
PYEOF
    chmod +x "$venv_dir/bin/python"
    cat > "$venv_dir/bin/semgrep" <<'SEMGREPEOF'
#!/usr/bin/env bash
set -euo pipefail

counter_file="${SANCTUARY_STUB_SEMGREP_COUNTER:?}"
failures="${SANCTUARY_STUB_SEMGREP_VERSION_FAILS:-0}"
count="$(cat "$counter_file" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" > "$counter_file"

if [ "$count" -le "$failures" ]; then
  exit 139
fi

echo '1.161.0'
SEMGREPEOF
    chmod +x "$venv_dir/bin/semgrep"
    ;;
  *)
    exit 2
    ;;
esac
EOF
  chmod +x "$bin_dir/python3"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SCRIPT"
  write_python_stub

  : > "$TEST_TEMP_DIR/semgrep-counter"
  : > "$TEST_TEMP_DIR/github-env"
  PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR" \
    GITHUB_ENV="$TEST_TEMP_DIR/github-env" \
    SEMGREP_VERSION=1.161.0 \
    SEMGREP_REPORT_DIR="$TEST_TEMP_DIR/report" \
    SANCTUARY_STUB_SEMGREP_COUNTER="$TEST_TEMP_DIR/semgrep-counter" \
    SANCTUARY_STUB_SEMGREP_VERSION_FAILS=1 \
    SANCTUARY_SEMGREP_INSTALL_ATTEMPTS=2 \
    SANCTUARY_SEMGREP_INSTALL_DELAY_SECONDS=1 \
    bash "$SCRIPT" >/dev/null

  [ "$(cat "$TEST_TEMP_DIR/semgrep-counter")" = "2" ] ||
    fail 'expected Semgrep validation retry'
  grep -E '^SEMGREP_WORKDIR=.+' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected SEMGREP_WORKDIR export'
  grep -E '^SEMGREP_BIN=.+/venv/bin/semgrep$' "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected SEMGREP_BIN export'
  grep -Fx "SEMGREP_REPORT_DIR=$TEST_TEMP_DIR/report" "$TEST_TEMP_DIR/github-env" >/dev/null ||
    fail 'expected SEMGREP_REPORT_DIR export'

  : > "$TEST_TEMP_DIR/semgrep-counter"
  if PATH="$TEST_TEMP_DIR/bin:$PATH" \
    RUNNER_TEMP="$TEST_TEMP_DIR" \
    SEMGREP_VERSION=1.161.0 \
    SANCTUARY_STUB_SEMGREP_COUNTER="$TEST_TEMP_DIR/semgrep-counter" \
    SANCTUARY_STUB_SEMGREP_VERSION_FAILS=2 \
    SANCTUARY_SEMGREP_INSTALL_ATTEMPTS=1 \
    SANCTUARY_SEMGREP_INSTALL_DELAY_SECONDS=1 \
    bash "$SCRIPT" >/dev/null 2>&1; then
    fail 'expected persistent Semgrep validation failure'
  fi

  echo 'semgrep install helper checks passed'
}

main "$@"
