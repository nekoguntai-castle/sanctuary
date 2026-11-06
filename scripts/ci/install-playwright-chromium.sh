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

verify_baked_ffmpeg() {
  node - "$repo_root" "$toolchain_file" <<'NODE'
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { realpathSync, statSync, readFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = process.argv[2];
const toolchain = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const expectedVersion = toolchain.playwrightVersion;
if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? '')) {
  throw new Error('browser toolchain does not pin a valid Playwright version');
}
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (!path.isAbsolute(browsersPath ?? '')) {
  throw new Error('sandbox mode requires an absolute PLAYWRIGHT_BROWSERS_PATH');
}
const rootRequire = createRequire(path.join(repoRoot, 'package.json'));
const playwrightPackagePath = rootRequire.resolve('playwright/package.json');
const playwrightPackage = JSON.parse(readFileSync(playwrightPackagePath, 'utf8'));
if (playwrightPackage.version !== expectedVersion) {
  throw new Error('installed Playwright version differs from browser toolchain');
}
const playwrightRequire = createRequire(playwrightPackagePath);
const corePackagePath = playwrightRequire.resolve('playwright-core/package.json');
const corePackage = JSON.parse(readFileSync(corePackagePath, 'utf8'));
if (corePackage.version !== expectedVersion || playwrightPackage.dependencies?.['playwright-core'] !== expectedVersion) {
  throw new Error('installed Playwright Core version differs from browser toolchain');
}
const coreRequire = createRequire(corePackagePath);
const { registry } = coreRequire('playwright-core/lib/coreBundle');
const ffmpeg = registry?.registry?.findExecutable('ffmpeg');
if (!ffmpeg || !/^\d+$/.test(ffmpeg.revision ?? '') || typeof ffmpeg.executablePath !== 'function') {
  throw new Error('locked Playwright registry has no valid FFmpeg descriptor');
}
const browsersRoot = realpathSync(browsersPath);
const registryDirectory = realpathSync(ffmpeg.directory);
const expectedDirectory = path.join(browsersRoot, `ffmpeg-${ffmpeg.revision}`);
if (registryDirectory !== expectedDirectory) {
  throw new Error('Playwright FFmpeg registry directory is outside the configured baked browser path');
}
const executable = realpathSync(ffmpeg.executablePath());
const relativeExecutable = path.relative(expectedDirectory, executable);
if (!relativeExecutable || relativeExecutable.startsWith(`..${path.sep}`) || path.isAbsolute(relativeExecutable)) {
  throw new Error('Playwright FFmpeg executable is outside its locked registry directory');
}
const metadata = statSync(executable);
if (!metadata.isFile() || (metadata.mode & 0o111) === 0) {
  throw new Error('baked Playwright FFmpeg is missing or not executable');
}
const version = execFileSync(executable, ['-version'], { encoding: 'utf8', timeout: 10_000 });
if (!/^ffmpeg version\s/m.test(version)) {
  throw new Error('baked Playwright FFmpeg did not report a usable version');
}
process.stdout.write(`Verified baked Playwright FFmpeg revision ${ffmpeg.revision}\n`);
NODE
}

probe_chromium() {
  if [ -n "${SANCTUARY_PLAYWRIGHT_PROBE_CMD:-}" ]; then
    bash -c "$SANCTUARY_PLAYWRIGHT_PROBE_CMD"
    return
  fi

  node --input-type=module <<'NODE'
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

const mode = process.env.SANCTUARY_SANDBOXED_BROWSER ?? '0';
if (!['0', '1'].includes(mode)) throw new Error('Invalid sandboxed browser mode');
// CI launches inside the isolated sibling; setup verifies only the pinned binary.
if (mode === '1') process.exit(0);
// Only local mode imports the browser client and its launch policy.
const { chromium } = await import('@playwright/test');
const { chromiumLaunchOptions } = await import('./config/tooling/playwright-browser.ts');
const browser = await chromium.launch({
  headless: true,
  ...chromiumLaunchOptions(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH),
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
  local sandbox_mode="${SANCTUARY_SANDBOXED_BROWSER-0}"
  case "$sandbox_mode" in
    0|1) ;;
    *) fail 'Invalid sandboxed browser mode' ;;
  esac
  local chromium_executable
  if [ "$sandbox_mode" = 1 ]; then
    [ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ] \
      || fail 'sandbox mode requires the image-provided Chromium executable'
    [ -x "$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" ] \
      || fail 'sandbox mode Chromium executable is missing or not executable'
    chromium_executable="$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"
  else
    chromium_executable="$(install_chrome_for_testing "$browser_version" "$browser_sha256")" \
      || fail "could not provision pinned Chrome for Testing $browser_version"
  fi
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$chromium_executable"
  if [ "$sandbox_mode" = 1 ]; then
    verify_baked_ffmpeg || fail 'sandbox mode requires usable FFmpeg baked for the locked Playwright version'
  else
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$retry_command" "playwright ffmpeg install" npx playwright install ffmpeg
  fi

  # The image bakes a verified Chrome for Testing executable. This fallback
  # provisions the same archive in a versioned user cache when run elsewhere.
  if probe_chromium; then
    echo "Playwright Chromium already present; skipping install"
    return 0
  fi
  if [ "$sandbox_mode" = 1 ]; then
    fail 'sandbox mode requires the pinned Chromium probe to pass without installing packages or dependencies'
  fi

  echo "::warning::Playwright Chromium launch failed; installing OS dependencies"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$retry_command" "playwright chromium dependency install" npx playwright install-deps chromium
  probe_chromium
  echo "Playwright Chromium launch verified after dependency install"
}

main "$@"
