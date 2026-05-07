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
  mkdir -p "$fake_bin"
  printf '0' >"$counter"

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

  if [ "$count" -eq 1 ]; then
    echo 'simulated venv bootstrap failure' >&2
    exit 1
  fi

  rm -rf "$venv_dir"
  mkdir -p "$venv_dir/bin"
  cat >"$venv_dir/bin/python" <<'VENVEOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "-m" ] && [ "$2" = "pip" ]; then
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
  (
    cd "$ROOT_DIR"
    PATH="$fake_bin:$PATH" \
      LIZARD_VENV_COUNTER="$counter" \
      QUALITY_TOOLS_DIR="$TEST_TEMP_DIR/quality-tools" \
      SANCTUARY_RETRY_DELAY_SECONDS=0 \
      bash scripts/quality/lizard-only.sh
  ) >"$output" 2>&1

  [ "$(cat "$counter")" = "2" ] || fail 'expected lizard venv creation to retry once'
  grep -Fq 'lizard venv creation, attempt 2' "$output" ||
    fail 'expected retry helper to report the second lizard venv attempt'
  grep -Fq 'Quality gate passed.' "$output" ||
    fail 'expected lizard-only quality gate to pass after retry'

  echo 'quality lizard bootstrap regression checks passed'
}

main "$@"
