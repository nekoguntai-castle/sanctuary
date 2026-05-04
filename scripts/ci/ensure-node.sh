#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "ensure-node: $*" >&2
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

main() {
  if [ "$#" -ne 0 ]; then
    fail 'unexpected arguments'
  fi

  local expected="${SANCTUARY_NODE_VERSION:-${NODE_VERSION:-}}"
  if [ -z "$expected" ]; then
    fail 'NODE_VERSION is required'
  fi
  if [[ ! "$expected" =~ ^[0-9]+([.][0-9]+){0,2}$ ]]; then
    fail "NODE_VERSION must be a numeric major, major.minor, or major.minor.patch version"
  fi

  local node_bin="${NODE_BINARY:-node}"
  command -v "$node_bin" >/dev/null 2>&1 || fail "node executable not found: $node_bin"

  local actual
  actual="$("$node_bin" --version)"
  actual="${actual#v}"

  if ! version_matches "$expected" "$actual"; then
    fail "expected Node.js ${expected}, got ${actual}"
  fi

  local npm_bin="${NPM_BINARY:-npm}"
  command -v "$npm_bin" >/dev/null 2>&1 || fail "npm executable not found: $npm_bin"

  echo "Node.js ${actual}"
  echo "npm $("$npm_bin" --version)"
}

main "$@"
