#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/install-semgrep.sh

Installs Semgrep into a temporary virtualenv and validates the executable.
Writes SEMGREP_WORKDIR, SEMGREP_BIN, and SEMGREP_REPORT_DIR to GITHUB_ENV
when running under Actions.
EOF
}

fail() {
  echo "install-semgrep: $*" >&2
  exit 1
}

require_positive_integer() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    fail "${name} must be a positive integer"
  fi
}

write_github_env() {
  local name="$1"
  local value="$2"

  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "${name}=${value}" >> "$GITHUB_ENV"
  fi
}

find_python() {
  command -v python3 || command -v python || return 1
}

install_attempt() {
  local python_bin="$1"
  local workdir="$2"
  local attempt="$3"
  local pip_flags=(--disable-pip-version-check)

  if [ "$attempt" -gt 1 ]; then
    pip_flags+=(--no-cache-dir)
  fi

  "$python_bin" -m venv "$workdir/venv"
  "$workdir/venv/bin/python" -m pip install "${pip_flags[@]}" --upgrade pip
  "$workdir/venv/bin/python" -m pip install "${pip_flags[@]}" "semgrep==${SEMGREP_VERSION}"
  "$workdir/venv/bin/semgrep" --version
}

main() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    usage
    exit 0
  fi
  if [ "$#" -gt 0 ]; then
    usage
    fail "unknown option: $1"
  fi
  if [ -z "${SEMGREP_VERSION:-}" ]; then
    fail 'SEMGREP_VERSION is required'
  fi

  local attempts="${SANCTUARY_SEMGREP_INSTALL_ATTEMPTS:-3}"
  local delay_seconds="${SANCTUARY_SEMGREP_INSTALL_DELAY_SECONDS:-10}"
  require_positive_integer SANCTUARY_SEMGREP_INSTALL_ATTEMPTS "$attempts"
  require_positive_integer SANCTUARY_SEMGREP_INSTALL_DELAY_SECONDS "$delay_seconds"

  local python_bin
  python_bin="$(find_python)" || fail 'python3 or python is required'

  local temp_parent="${RUNNER_TEMP:-/tmp}"
  mkdir -p "$temp_parent"

  local report_dir="${SEMGREP_REPORT_DIR:-/tmp/sanctuary-semgrep-${GITHUB_RUN_ID:-local}}"
  local attempt status workdir

  for attempt in $(seq 1 "$attempts"); do
    workdir="$(mktemp -d "$temp_parent/sanctuary-semgrep.XXXXXX")"
    echo "semgrep install+validate, attempt ${attempt}"

    set +e
    install_attempt "$python_bin" "$workdir" "$attempt"
    status="$?"
    set -e

    if [ "$status" -eq 0 ]; then
      write_github_env SEMGREP_WORKDIR "$workdir"
      write_github_env SEMGREP_BIN "$workdir/venv/bin/semgrep"
      write_github_env SEMGREP_REPORT_DIR "$report_dir"
      return 0
    fi

    rm -rf "$workdir" || true
    if [ "$attempt" -eq "$attempts" ]; then
      return "$status"
    fi
    sleep $((attempt * delay_seconds))
  done
}

main "$@"
