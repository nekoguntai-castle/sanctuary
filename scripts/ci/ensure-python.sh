#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$SCRIPT_DIR/provider-context.sh"

fail() {
  echo "ensure-python: $*" >&2
  exit 1
}

version_matches() {
  local expected="$1"
  local actual="$2"

  if [ "$actual" = "$expected" ]; then
    return 0
  fi
  if [[ "$expected" = *.*.* ]]; then
    return 1
  fi

  [[ "$actual" = "$expected".* ]]
}


find_python() {
  if [ -n "${PYTHON_BINARY:-}" ]; then
    command -v "$PYTHON_BINARY" || return 1
    return 0
  fi

  command -v python3 || command -v python || return 1
}

main() {
  if [ "$#" -ne 0 ]; then
    fail 'unexpected arguments'
  fi

  local expected="${SANCTUARY_PYTHON_VERSION:-${PYTHON_VERSION:-}}"
  if [ -z "$expected" ]; then
    fail 'PYTHON_VERSION is required'
  fi
  if [[ ! "$expected" =~ ^[0-9]+([.][0-9]+){0,2}$ ]]; then
    fail "PYTHON_VERSION must be a numeric major, major.minor, or major.minor.patch version"
  fi

  local python_bin
  python_bin="$(find_python)" || fail 'python3 or python executable not found'

  local actual
  actual="$("$python_bin" -c 'import platform; print(platform.python_version())')"

  if ! version_matches "$expected" "$actual"; then
    fail "expected Python ${expected}, got ${actual}"
  fi

  ci_emit_env "SANCTUARY_PYTHON_BIN=$python_bin"
  echo "Python ${actual} ($python_bin)"
}

main "$@"
