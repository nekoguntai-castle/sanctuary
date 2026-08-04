#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
OUTPUT_ROOT="${1:-$REPO_ROOT/.github/actions/vendor/forgejo-artifact-v4}"
BUILD_ROOT="/tmp/sanctuary-forgejo-artifact-v4-node24-build-v1"

UPLOAD_SHA="16871d9e8cfcf27ff31822cac382bbb5450f1e1e"
UPLOAD_ARCHIVE_SHA256="6383687c4832a4f77bb28dea05b3b0d8fc636b3d572416fad630d436cf125df1"
DOWNLOAD_SHA="d8d0a99033603453ad2255e58720b460a0555e1e"
DOWNLOAD_ARCHIVE_SHA256="85011bcbcd2bfac17da6c593a40600ee7e66fce6b69264e7f392ad7319779f02"

if [[ "$(node -p 'process.versions.node.split(`.`)[0]')" != "24" ]]; then
  echo "forgejo-artifact-v4 vendor build requires Node 24" >&2
  exit 1
fi

mkdir -p "$BUILD_ROOT"
exec 9>"$BUILD_ROOT/.build.lock"
flock 9

fetch_and_extract() {
  local repository="$1"
  local commit="$2"
  local expected_hash="$3"
  local archive="$BUILD_ROOT/$repository.tar.gz"
  local source="$BUILD_ROOT/$repository"

  curl --fail --silent --show-error --location \
    "https://data.forgejo.org/api/v1/repos/forgejo/$repository/archive/$commit.tar.gz" \
    --output "$archive"
  printf '%s  %s\n' "$expected_hash" "$archive" | sha256sum --check --status
  mkdir -p "$source"
  tar -xzf "$archive" --overwrite --strip-components=1 -C "$source"
}

build_action() {
  local repository="$1"
  local action_kind="$2"
  local source="$BUILD_ROOT/$repository"
  local destination="$OUTPUT_ROOT/$action_kind"

  npm --prefix "$source" ci --ignore-scripts --no-audit --no-fund
  node "$SCRIPT_DIR/patch-dependencies.mjs" "$source" "$action_kind"
  NODE_OPTIONS=--throw-deprecation \
    node "$SCRIPT_DIR/validate-patched-dependencies.mjs" "$source" "$action_kind"

  if [[ "$action_kind" == "upload" ]]; then
    node "$source/node_modules/@vercel/ncc/dist/ncc/cli.js" \
      build "$source/src/upload/index.ts" -o "$source/dist/upload" \
      --license licenses.txt
  else
    node "$source/node_modules/@vercel/ncc/dist/ncc/cli.js" \
      build "$source/src/download-artifact.ts" -o "$source/dist" \
      --license licenses.txt
  fi

  mkdir -p "$destination"
  cp "$source/action.yml" "$destination/action.yml"
  cp "$source/LICENSE" "$destination/LICENSE"
  if [[ "$action_kind" == "upload" ]]; then
    mkdir -p "$destination/dist/upload"
    cp "$source/dist/upload/index.js" "$destination/dist/upload/index.js"
    cp "$source/dist/upload/licenses.txt" "$destination/dist/upload/licenses.txt"
  else
    mkdir -p "$destination/dist"
    cp "$source/dist/index.js" "$destination/dist/index.js"
    cp "$source/dist/licenses.txt" "$destination/dist/licenses.txt"
  fi
}

fetch_and_extract upload-artifact "$UPLOAD_SHA" "$UPLOAD_ARCHIVE_SHA256"
fetch_and_extract download-artifact "$DOWNLOAD_SHA" "$DOWNLOAD_ARCHIVE_SHA256"
build_action upload-artifact upload
build_action download-artifact download

cp "$SCRIPT_DIR/vendor-package.json" "$OUTPUT_ROOT/package.json"
node "$SCRIPT_DIR/write-provenance.mjs" "$OUTPUT_ROOT"
node "$SCRIPT_DIR/verify-vendor.mjs" "$OUTPUT_ROOT"

printf 'vendored Forgejo artifact actions written to %s\n' "$OUTPUT_ROOT"
printf 'deterministic locked build retained at %s\n' "$BUILD_ROOT"
