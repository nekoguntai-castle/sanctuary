#!/usr/bin/env bash
# Read-only compatibility facade for manifest inventory and planning.
#
# Docker mutation moved to the signed cleanup coordinator. This facade remains
# only so callers that need a non-mutating inventory or dry-run plan have one
# stable entry point; project, prefix, runner-name, and age-based mutation modes
# are deliberately unsupported.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/cleanup-docker-resources.sh MODE REQUEST.json

Modes:
  --manifest-inventory   Inspect exact manifest-registered resources; never mutate.
  --manifest-plan        Produce a signed dry-run plan; never mutate.
  --help, -h             Show this help.

Resource mutation requires scripts/ci/cleanup-ci-callsite.sh and the canonical
signed coordinator. Legacy --project, --prefix, and --runner-leftovers modes
have been removed because labels, names, prefixes, and age are not authority.
EOF
}

fail() {
  printf 'cleanup-docker-resources: %s\n' "$*" >&2
  exit 1
}

[ "$#" -gt 0 ] || { usage; fail 'a manifest mode is required'; }
case "$1" in
  --help|-h)
    [ "$#" -eq 1 ] || fail 'help does not accept additional arguments'
    usage
    exit 0
    ;;
  --manifest-inventory)
    command=inventory
    ;;
  --manifest-plan)
    command=plan
    ;;
  --project|--prefix|--exclude-project|--runner-leftovers|--verify-empty|--dry-run)
    fail "$1 was removed; use the signed cleanup coordinator"
    ;;
  *)
    usage
    fail "unknown mode: $1"
    ;;
esac

[ "$#" -eq 2 ] || fail "$1 requires exactly one request file"
request_path="$2"
[ -f "$request_path" ] || fail "request file does not exist: $request_path"

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec node "$script_root/scripts/ownership/cleanup-cli.mjs" "$command" "$request_path"
