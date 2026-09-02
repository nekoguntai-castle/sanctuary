#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
UPLOADER="$ROOT/.github/actions/vendor/forgejo-artifact-v4/upload/dist/upload/index.js"

fail() { printf 'upload-artifact-from-subject: %s\n' "$*" >&2; return 1; }

main() {
  [[ $# == 2 && $1 =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] \
    || fail 'usage: upload-artifact-from-subject.sh NAME PATH' || return
  [[ ${SANCTUARY_CLEANUP_COORDINATED:-0} == 1 ]] \
    || fail 'upload must remain inside the cleanup authority span' || return
  local name=$1 source=$2 resolved
  [[ -e $source && ! -L $source ]] || fail 'artifact source must be a real existing path' || return
  resolved=$(realpath -- "$source") || return
  case "$resolved" in
    "$ROOT"/*) ;;
    *) fail 'artifact source must remain inside the coordinated checkout' ; return 1 ;;
  esac
  [[ -f $UPLOADER && ! -L $UPLOADER ]] || fail 'vendored uploader runtime is unavailable' || return
  env \
    "INPUT_NAME=$name" \
    "INPUT_PATH=$resolved" \
    'INPUT_IF-NO-FILES-FOUND=error' \
    'INPUT_OVERWRITE=false' \
    'INPUT_INCLUDE-HIDDEN-FILES=false' \
    node "$UPLOADER"
}

main "$@"
