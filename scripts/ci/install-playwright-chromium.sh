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
