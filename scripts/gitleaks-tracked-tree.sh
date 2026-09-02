#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
REGISTERED_STAGING="$ROOT/scripts/ci/create-registered-staging.sh"
CLEANUP_COORDINATOR="$ROOT/scripts/ci/cleanup-ci-callsite.sh"
if [[ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]]; then
  exec "$CLEANUP_COORDINATOR" auto-run --lane gitleaks-tracked --engine host \
    --checkout-root "$ROOT" -- bash "$0" "$@"
fi
cd "$ROOT"

GITLEAKS_BIN="${GITLEAKS_BIN:-gitleaks}"
SCAN_DIR="$($REGISTERED_STAGING gitleaks-tracked)"

while IFS= read -r -d '' path; do
  if [[ -f "$path" ]]; then
    mkdir -p "$SCAN_DIR/$(dirname "$path")"
    cp -p "$path" "$SCAN_DIR/$path"
  fi
done < <(git ls-files -z)

"$GITLEAKS_BIN" detect \
  --no-git \
  --source "$SCAN_DIR" \
  --config "$ROOT/config/tooling/gitleaks.toml" \
  --gitleaks-ignore-path "$ROOT/config/tooling/gitleaksignore" \
  --redact \
  --no-banner
