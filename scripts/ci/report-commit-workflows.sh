#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

fail() {
  echo "report-commit-workflows: $*" >&2
  exit 1
}

if [ "$#" -ne 2 ]; then
  fail 'usage: report-commit-workflows.sh SHA MANIFEST.json'
fi

sha="$1"
manifest="$2"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || fail 'SHA must be exactly 40 lowercase hexadecimal characters'
[ -f "$manifest" ] && [ ! -L "$manifest" ] || fail 'manifest must be a regular nonsymlink file'
manifest_bytes="$(wc -c < "$manifest")"
[[ "$manifest_bytes" =~ ^[0-9]+$ ]] && [ "$manifest_bytes" -le 65536 ] \
  || fail 'manifest exceeds 65536-byte limit'
command -v node >/dev/null 2>&1 || fail 'required command not found: node'
command -v curl >/dev/null 2>&1 || fail 'required command not found: curl'
command -v python3 >/dev/null 2>&1 || fail 'required command not found: python3'

staging="$($SCRIPT_DIR/create-registered-staging.sh report-commit-workflows)" \
  || fail 'could not create registered report staging'
node "$SCRIPT_DIR/report-commit-workflows.mjs" "$sha" "$manifest" "$staging"
