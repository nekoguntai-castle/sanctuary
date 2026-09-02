#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"
REGISTERED_STAGING="$SCRIPT_DIR/create-registered-staging.sh"
CLEANUP_COORDINATOR="$SCRIPT_DIR/cleanup-ci-callsite.sh"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/install-semgrep.sh

Installs Semgrep into a temporary virtualenv and validates the executable.
Writes SEMGREP_WORKDIR, SEMGREP_BIN, and SEMGREP_REPORT_DIR via the
provider-context CI env channel when one is set (see
scripts/ci/provider-context.sh).
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
  if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
    exec "$CLEANUP_COORDINATOR" auto-run --lane install-semgrep --engine host \
      --checkout-root "$PROJECT_ROOT" -- bash "$0" "$@"
  fi

  local attempts="${SANCTUARY_SEMGREP_INSTALL_ATTEMPTS:-3}"
  local delay_seconds="${SANCTUARY_SEMGREP_INSTALL_DELAY_SECONDS:-10}"
  require_positive_integer SANCTUARY_SEMGREP_INSTALL_ATTEMPTS "$attempts"
  require_positive_integer SANCTUARY_SEMGREP_INSTALL_DELAY_SECONDS "$delay_seconds"

  local python_bin
  python_bin="$(find_python)" || fail 'python3 or python is required'

  local run_id
  run_id="$(ci_run_id)"
  local report_dir="${SEMGREP_REPORT_DIR:-/tmp/sanctuary-semgrep-${run_id}}"
  local attempt status workdir

  for attempt in $(seq 1 "$attempts"); do
    workdir="$($REGISTERED_STAGING "semgrep-$attempt")"
    echo "semgrep install+validate, attempt ${attempt}"

    set +e
    install_attempt "$python_bin" "$workdir" "$attempt"
    status="$?"
    set -e

    if [ "$status" -eq 0 ]; then
      ci_emit_env \
        "SEMGREP_WORKDIR=$workdir" \
        "SEMGREP_BIN=$workdir/venv/bin/semgrep" \
        "SEMGREP_REPORT_DIR=$report_dir"
      return 0
    fi

    if [ "$attempt" -eq "$attempts" ]; then
      return "$status"
    fi
    sleep $((attempt * delay_seconds))
  done
}

main "$@"
