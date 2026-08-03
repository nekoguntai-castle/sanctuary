#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local fake_bin="$TEST_TEMP_DIR/bin"
  local counter="$TEST_TEMP_DIR/venv-counter"
  local pip_counter="$TEST_TEMP_DIR/pip-counter"
  local args_log="$TEST_TEMP_DIR/lizard-args"
  mkdir -p "$fake_bin"
  printf '0' >"$counter"
  printf '0' >"$pip_counter"

  cat >"$fake_bin/python3" <<'PYEOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  shift 2
  if [ "${1:-}" = "--clear" ]; then
    shift
  fi

  venv_dir="${1:?venv directory is required}"
  count="$(cat "${LIZARD_VENV_COUNTER:?}" 2>/dev/null || echo 0)"
  count="$((count + 1))"
  printf '%s' "$count" >"$LIZARD_VENV_COUNTER"

  rm -rf "$venv_dir"
  mkdir -p "$venv_dir/bin"
  cat >"$venv_dir/bin/python" <<'VENVEOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
  count="$(cat "${LIZARD_PIP_COUNTER:?}" 2>/dev/null || echo 0)"
  count="$((count + 1))"
  printf '%s' "$count" >"$LIZARD_PIP_COUNTER"
  if [ "$count" -eq 1 ]; then
    echo 'simulated corrupted pip import' >&2
    exit 1
  fi
  exit 0
fi

echo "unexpected venv python invocation: $*" >&2
exit 1
VENVEOF
  chmod +x "$venv_dir/bin/python"

  cat >"$venv_dir/bin/lizard" <<'LIZARDEOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "--version" ]; then
  echo 'lizard 1.21.2'
  exit 0
fi

printf '%s\n' "$@" >"${LIZARD_ARGS_LOG:?}"
echo 'stub lizard scan'
exit 0
LIZARDEOF
  chmod +x "$venv_dir/bin/lizard"
  exit 0
fi

echo "unexpected python3 invocation: $*" >&2
exit 1
PYEOF
  chmod +x "$fake_bin/python3"

  local output="$TEST_TEMP_DIR/output.log"
  if ! (
    cd "$ROOT_DIR"
    PATH="$fake_bin:$PATH" \
      LIZARD_VENV_COUNTER="$counter" \
      LIZARD_PIP_COUNTER="$pip_counter" \
      LIZARD_ARGS_LOG="$args_log" \
      QUALITY_TOOLS_DIR="$TEST_TEMP_DIR/quality-tools" \
      SANCTUARY_RETRY_DELAY_SECONDS=0 \
      bash scripts/quality/lizard-only.sh
  ) >"$output" 2>&1; then
    cat "$output" >&2
    fail 'expected lizard-only quality gate to recover after a pip bootstrap failure'
  fi

  [ "$(cat "$counter")" = "2" ] || fail 'expected lizard bootstrap to recreate the venv once'
  [ "$(cat "$pip_counter")" = "3" ] || fail 'expected pip upgrade failure followed by full retry'
  grep -Fq 'lizard bootstrap, attempt 2' "$output" ||
    fail 'expected retry helper to report the second lizard bootstrap attempt'
  grep -Fq 'Quality gate passed.' "$output" ||
    fail 'expected lizard-only quality gate to pass after retry'
  grep -Fxq './docs/site/node_modules/*' "$args_log" ||
    fail 'expected lizard to exclude nested docs-site dependencies'
  grep -Fxq './docs/site/build/*' "$args_log" ||
    fail 'expected lizard to exclude generated docs-site output'
  grep -Fxq './docs/site/.docusaurus/*' "$args_log" ||
    fail 'expected lizard to exclude Docusaurus intermediate output'

  echo 'quality lizard bootstrap regression checks passed'
}

main "$@"
