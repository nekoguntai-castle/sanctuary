#!/usr/bin/env bash
# Phase F3: ai-proxy network-isolation guard.
#
# ai-proxy MUST NOT import from shared/ — neither via the workspace
# specifier nor via relative paths. This script greps ai-proxy's source
# tree for any such reference and exits non-zero if found.
#
# The ESLint rule in eslint.config.js (Phase F2) catches this at lint
# time; this script is a belt-and-suspenders gate that fires even when
# eslint is not available (CI lanes that skip the lint job, fast smoke
# checks, etc.).
#
# Run: bash scripts/ci/check-ai-proxy-shared-isolation.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AI_PROXY_DIR="$REPO_ROOT/ai-proxy"

if [ ! -d "$AI_PROXY_DIR" ]; then
  echo "check-ai-proxy-shared-isolation: $AI_PROXY_DIR does not exist; skipping"
  exit 0
fi

# Match BOTH workspace and relative-path imports
PATTERN="from ['\"](@sanctuary/shared|(\\.\\./)+shared)/|import\\(['\"](@sanctuary/shared|(\\.\\./)+shared)/|require\\(['\"](@sanctuary/shared|(\\.\\./)+shared)/"

# `--include` limits to TS/TSX files; exclude node_modules and dist.
violations=$(grep -rEn \
  --include='*.ts' \
  --include='*.tsx' \
  --include='*.mts' \
  --include='*.cts' \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  "$PATTERN" \
  "$AI_PROXY_DIR" || true)

if [ -n "$violations" ]; then
  echo "::error::ai-proxy must not import from shared/ (network-isolation boundary):" >&2
  echo "$violations" | sed 's/^/  /' >&2
  echo "" >&2
  echo "Re-implement the needed utility in ai-proxy/src/, or factor the boundary" >&2
  echo "decision into its own ADR before allowing the import." >&2
  exit 1
fi

echo "check-ai-proxy-shared-isolation: OK (no shared/ imports in ai-proxy)"
