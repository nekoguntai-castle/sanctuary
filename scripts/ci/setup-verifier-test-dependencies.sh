#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERIFIER_DIR="$ROOT_DIR/scripts/verify-addresses"

if [ ! -f "$VERIFIER_DIR/package.json" ] || [ ! -f "$VERIFIER_DIR/package-lock.json" ]; then
  echo 'setup-verifier-test-dependencies: verifier package manifest or lockfile is missing' >&2
  exit 1
fi

npm ci --prefix "$VERIFIER_DIR" --strict-allow-scripts --audit=false --fund=false \
  --cache "$ROOT_DIR/.tmp/npm-cache"
