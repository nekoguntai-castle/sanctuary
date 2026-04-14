#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

missing=0

require_tool() {
  local tool="$1"
  local install_hint="$2"

  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing required quality tool: %s\nInstall: %s\n\n' "$tool" "$install_hint" >&2
    missing=1
  fi
}

require_tool gitleaks "brew install gitleaks, or download a release from https://github.com/gitleaks/gitleaks"
require_tool lizard "python -m pip install --user lizard"
require_tool npx "install Node.js/npm for npx, then rerun npm run quality"

if [[ "$missing" -ne 0 ]]; then
  printf 'Install the missing tools above, then rerun npm run quality.\n' >&2
  exit 127
fi

GITLEAKS_LOG_OPTS="${GITLEAKS_LOG_OPTS:--1}"
LIZARD_WARNING_BASELINE="${LIZARD_WARNING_BASELINE:-77}"

echo "==> gitleaks"
gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts "$GITLEAKS_LOG_OPTS"

echo "==> lizard"
lizard \
  -w \
  -i "$LIZARD_WARNING_BASELINE" \
  -l javascript \
  -l typescript \
  -C 15 \
  -T nloc=200 \
  -x './node_modules/*' \
  -x './*/node_modules/*' \
  -x './dist/*' \
  -x './*/dist/*' \
  -x './build/*' \
  -x './coverage/*' \
  -x './*/coverage/*' \
  -x './server/src/generated/*' \
  -x './server/tests/fixtures/*' \
  -x './scripts/verify-addresses/output/*' \
  -x './*.min.js' \
  -x './reports/*' \
  -x './playwright-report/*' \
  -x './test-results/*' \
  -x './.tmp/*' \
  -x './.tmp-gh/*' \
  .

echo "==> jscpd"
npx --yes jscpd@4 .
