#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "install-playwright-chromium: $*" >&2
  exit 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
retry_command="$script_dir/retry-command.sh"

probe_chromium() {
  if [ -n "${SANCTUARY_PLAYWRIGHT_PROBE_CMD:-}" ]; then
    bash -c "$SANCTUARY_PLAYWRIGHT_PROBE_CMD"
    return
  fi

  node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
await browser.close();
NODE
}

main() {
  [ -x "$retry_command" ] || fail "retry helper is not executable: $retry_command"

  # The sanctuary-playwright-* runner image bakes Chromium in already (see
  # scripts/ci/images/playwright-runner.Dockerfile); on that image the probe
  # succeeds immediately and the install below is unnecessary work on every
  # run. This script stays as the fallback path for any runner that does not
  # carry the prebaked browser -- do not remove the install below.
  if probe_chromium; then
    echo "Playwright Chromium already present; skipping install"
    return 0
  fi

  "$retry_command" "playwright chromium browser install" npx playwright install chromium

  if probe_chromium; then
    echo "Playwright Chromium launch verified"
    return 0
  fi

  echo "::warning::Playwright Chromium launch failed; installing OS dependencies"
  "$retry_command" "playwright chromium dependency install" npx playwright install-deps chromium
  probe_chromium
  echo "Playwright Chromium launch verified after dependency install"
}

main "$@"
