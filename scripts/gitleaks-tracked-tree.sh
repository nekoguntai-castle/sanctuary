#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GITLEAKS_BIN="${GITLEAKS_BIN:-gitleaks}"
SCAN_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$SCAN_DIR"
}
trap cleanup EXIT

while IFS= read -r -d '' path; do
  if [[ -f "$path" ]]; then
    mkdir -p "$SCAN_DIR/$(dirname "$path")"
    cp -p "$path" "$SCAN_DIR/$path"
  fi
done < <(git ls-files -z)

"$GITLEAKS_BIN" detect \
  --no-git \
  --source "$SCAN_DIR" \
  --config "$ROOT/.gitleaks.toml" \
  --redact \
  --no-banner
