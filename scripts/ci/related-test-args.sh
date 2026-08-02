#!/usr/bin/env bash
set -euo pipefail

# Translate the repo-relative changed-file list emitted by detect-changes into
# arguments for `vitest related`, for lanes that run inside a workspace
# subdirectory.
#
# scripts/ci/classify-test-changes.sh emits paths relative to the REPO ROOT
# (is_backend_file / is_gateway_file in classify-files-lib.sh match `server/*`
# and `gateway/*`, so every entry carries its workspace prefix). The quick
# backend and gateway lanes set `working-directory:` to that same workspace, so
# passing the paths through unchanged makes vitest resolve `server/server/...`
# or `gateway/gateway/...`. Those never exist, vitest reports "No test files
# found", and `--passWithNoTests` exits 0 — turning two REQUIRED PR checks into
# permanent green no-ops.
#
# The frontend lane does not need this: it runs from the repo root, where the
# emitted paths are already correct.
#
# Emits one argument per line so callers can read it back with `mapfile` rather
# than re-splitting a string.

usage() {
  echo 'Usage: RELATED_FILES="server/src/a.ts" scripts/ci/related-test-args.sh WORKSPACE' >&2
  echo '       scripts/ci/related-test-args.sh WORKSPACE FILE...' >&2
}

fail() {
  echo "related-test-args: $*" >&2
  exit 1
}

main() {
  if [ "$#" -lt 1 ]; then
    usage
    fail 'expected a workspace name'
  fi

  local workspace="$1"
  shift

  # Guard against an empty or slash-bearing workspace, which would strip the
  # wrong amount and silently mangle every path.
  case "$workspace" in
    ''|*/*)
      fail 'workspace must be a single path segment (e.g. server, gateway)'
      ;;
  esac

  local files=()
  if [ "$#" -gt 0 ]; then
    files=("$@")
  elif [ -n "${RELATED_FILES:-}" ]; then
    # Split on any whitespace. `read -r -a` alone stops at the first newline and
    # would silently drop the rest of the list while still exiting 0 — the same
    # class of quiet data loss this script exists to prevent. Upstream
    # append_file joins with spaces and the value crosses GITHUB_OUTPUT as a
    # single line, so newlines should never appear; handling them anyway costs
    # nothing and removes the footgun.
    #
    # Word-splitting here is intentional (IFS default), which is also why a
    # filename containing a space cannot survive — but such a path is already
    # split by the classifier before it reaches this script.
    # shellcheck disable=SC2206 -- deliberate word-splitting of a space-separated list
    files=(${RELATED_FILES})
  fi

  local file rooted
  for file in "${files[@]+"${files[@]}"}"; do
    [ -n "$file" ] || continue

    # Strip the LEADING workspace segment only (`#`, not `//`). A global
    # substitution would also eat a nested directory of the same name, turning
    # server/src/server/index.ts into src/index.ts. A path that is already
    # workspace-relative passes through untouched, so this is idempotent.
    rooted="${file#"$workspace"/}"

    [ -n "$rooted" ] || continue
    printf '%s\n' "$rooted"
  done
}

main "$@"
