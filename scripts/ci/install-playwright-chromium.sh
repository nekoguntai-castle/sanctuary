#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "install-playwright-chromium: $*" >&2
  exit 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
retry_command="$script_dir/retry-command.sh"
repo_root="$(cd "$script_dir/../.." && pwd)"
toolchain_file="$repo_root/config/browser-toolchain.json"

read_toolchain() {
  node - "$toolchain_file" <<'NODE'
const fs = require('node:fs');
const toolchain = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const key of ['browserVersion', 'browserSha256']) {
  if (typeof toolchain[key] !== 'string' || !toolchain[key]) {
    throw new Error(`browser toolchain is missing ${key}`);
  }
  process.stdout.write(`${toolchain[key]}\n`);
}
NODE
}

install_chrome_for_testing() {
  (
    local browser_version="$1" browser_sha256="$2"
    local browser_root="${XDG_CACHE_HOME:-$HOME/.cache}/sanctuary/chrome-for-testing/$browser_version"
    local archive_url="https://storage.googleapis.com/chrome-for-testing-public/$browser_version/linux64/chrome-linux64.zip"
    local executable="$browser_root/chrome-linux64/chrome"
    local verified_marker="$browser_root/.archive-sha256"

    if [ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]; then
      [ -x "$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" ] \
        || fail "configured Chromium executable is not executable: $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"
      printf '%s\n' "$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"
      return
    fi

    if [ -x "$executable" ] && [ -f "$verified_marker" ] \
      && [ "$(cat "$verified_marker")" = "$browser_sha256" ]; then
      printf '%s\n' "$executable"
      return
    fi
    if [ -e "$browser_root" ]; then
      fail "versioned Chrome cache exists but is not verified; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to another verified executable: $browser_root"
    fi

    local cache_parent temp_dir staged_root
    cache_parent="$(dirname "$browser_root")"
    mkdir -p "$cache_parent"
    temp_dir="$(mktemp -d "$cache_parent/.chrome-$browser_version.XXXXXX")"
    trap 'rm -rf "$temp_dir"' EXIT
    staged_root="$temp_dir/verified"
    curl --fail --location --silent --show-error --connect-timeout 20 --max-time 300 \
      --retry 3 --retry-all-errors --retry-delay 2 "$archive_url" --output "$temp_dir/chrome.zip"
    echo "$browser_sha256  $temp_dir/chrome.zip" | sha256sum --check --status \
      || fail "Chrome for Testing $browser_version archive checksum mismatch"
    mkdir -p "$staged_root"
    unzip -q "$temp_dir/chrome.zip" -d "$staged_root"
    [ -x "$staged_root/chrome-linux64/chrome" ] \
      || fail "Chrome for Testing archive is missing its executable"
    printf '%s\n' "$browser_sha256" >"$staged_root/.archive-sha256"
    mv -T -n "$staged_root" "$browser_root"
    if [ ! -x "$executable" ] || [ ! -f "$verified_marker" ] \
      || [ "$(cat "$verified_marker")" != "$browser_sha256" ]; then
      fail "versioned Chrome cache appeared during installation but is not verified: $browser_root"
    fi
    printf '%s\n' "$executable"
  )
}

probe_chromium() {
  if [ -n "${SANCTUARY_PLAYWRIGHT_PROBE_CMD:-}" ]; then
    bash -c "$SANCTUARY_PLAYWRIGHT_PROBE_CMD"
    return
  fi

  node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const toolchain = JSON.parse(readFileSync(process.env.SANCTUARY_BROWSER_TOOLCHAIN_FILE, 'utf8'));
const versionOutput = execFileSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, ['--version'], {
  encoding: 'utf8',
  timeout: 10_000,
});
const match = versionOutput.match(/(\d+\.\d+\.\d+\.\d+)/);
if (!match) throw new Error(`Could not parse Chrome version: ${versionOutput.trim()}`);
if (match[1] !== toolchain.browserVersion) {
  throw new Error(`Chrome ${match[1]} does not match pinned ${toolchain.browserVersion}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
await browser.close();
NODE
}

main() {
  [ -x "$retry_command" ] || fail "retry helper is not executable: $retry_command"
  [ -f "$toolchain_file" ] || fail "browser toolchain file is missing: $toolchain_file"

  local toolchain browser_version browser_sha256
  toolchain="$(read_toolchain)" || fail "could not read $toolchain_file"
  browser_version="$(printf '%s\n' "$toolchain" | sed -n '1p')"
  browser_sha256="$(printf '%s\n' "$toolchain" | sed -n '2p')"
  export SANCTUARY_BROWSER_TOOLCHAIN_FILE="$toolchain_file"
  local chromium_executable
  chromium_executable="$(install_chrome_for_testing "$browser_version" "$browser_sha256")" \
    || fail "could not provision pinned Chrome for Testing $browser_version"
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$chromium_executable"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$retry_command" "playwright ffmpeg install" npx playwright install ffmpeg

  # The image bakes a verified Chrome for Testing executable. This fallback
  # provisions the same archive in a versioned user cache when run elsewhere.
  if probe_chromium; then
    echo "Playwright Chromium already present; skipping install"
    return 0
  fi

  echo "::warning::Playwright Chromium launch failed; installing OS dependencies"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$retry_command" "playwright chromium dependency install" npx playwright install-deps chromium
  probe_chromium
  echo "Playwright Chromium launch verified after dependency install"
}

main "$@"
