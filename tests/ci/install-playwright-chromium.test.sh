#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/ci/install-playwright-chromium.sh"
TEST_TEMP_DIR=''

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TEST_TEMP_DIR" ]; then
    rm -rf "$TEST_TEMP_DIR"
  fi
}

assert_contains() {
  grep -Fq "$2" "$1" || fail "expected $1 to contain: $2"
}

assert_not_contains() {
  if grep -Fq "$2" "$1"; then
    fail "expected $1 not to contain: $2"
  fi
}

write_mock_npx() {
  local bin_dir="$1"
  local log_file="$2"
  cat >"$bin_dir/npx" <<MOCK
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$log_file"
MOCK
  chmod +x "$bin_dir/npx"
}

write_mock_playwright_registry() {
  local isolated_repo="$1" version="$2" revision="$3"
  mkdir -p "$isolated_repo/node_modules/playwright" "$isolated_repo/node_modules/playwright-core/lib"
  cat >"$isolated_repo/node_modules/playwright/package.json" <<JSON
{"name":"playwright","version":"$version","dependencies":{"playwright-core":"$version"},"exports":{"./package.json":"./package.json"}}
JSON
  cat >"$isolated_repo/node_modules/playwright-core/package.json" <<JSON
{"name":"playwright-core","version":"$version","exports":{"./package.json":"./package.json","./browsers.json":"./browsers.json","./lib/coreBundle":"./lib/coreBundle.js"}}
JSON
  cat >"$isolated_repo/node_modules/playwright-core/browsers.json" <<JSON
{"browsers":[{"name":"ffmpeg","revision":"$revision","installByDefault":true}]}
JSON
  cat >"$isolated_repo/node_modules/playwright-core/lib/coreBundle.js" <<'MOCK'
const path = require('node:path');
const { browsers } = require('playwright-core/browsers.json');
const registry = {
  findExecutable(name) {
    const descriptor = browsers.find(browser => browser.name === name);
    if (!descriptor) return undefined;
    const directory = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, `${name}-${descriptor.revision}`);
    return {
      revision: descriptor.revision,
      directory,
      executablePath: () => path.join(directory, 'ffmpeg-linux'),
    };
  },
};
module.exports = { registry: { registry } };
MOCK
}

write_mock_ffmpeg() {
  local executable="$1" mode="${2:-valid}"
  mkdir -p "$(dirname "$executable")"
  if [ "$mode" = valid ]; then
    cat >"$executable" <<'MOCK'
#!/usr/bin/env bash
[ "${1:-}" = -version ] || exit 2
printf '%s\n' "$*" >>"${FFMPEG_CALL_LOG:?}"
printf 'ffmpeg version 7.0 fixture\n'
MOCK
  else
    cat >"$executable" <<'MOCK'
#!/usr/bin/env bash
exit 1
MOCK
  fi
  chmod +x "$executable"
}

# Builds a probe command that returns success once the shared counter file
# reaches $1, so a test can control exactly which call to probe_chromium
# succeeds (1-indexed).
probe_cmd_succeeding_on_call() {
  local target="$1" counter="$2"
  printf 'count=$(cat "%s"); count=$((count + 1)); printf %%s "$count" > "%s"; [ "$count" -ge %s ]' \
    "$counter" "$counter" "$target"
}

main() {
  TEST_TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  bash -n "$SCRIPT"

  local bin_dir="$TEST_TEMP_DIR/bin"
  local log_file="$TEST_TEMP_DIR/npx.log"
  mkdir -p "$bin_dir"
  write_mock_npx "$bin_dir" "$log_file"
  local browser_executable="$TEST_TEMP_DIR/chrome"
  printf '#!/usr/bin/env bash\necho "Google Chrome 157.0.8103.38"\nexit 0\n' >"$browser_executable"
  chmod +x "$browser_executable"

  # Case 1: the image-provided pinned browser launches; only FFmpeg is
  # installed because Playwright no longer provisions its bundled browser.
  local probe_count="$TEST_TEMP_DIR/probe-count"
  printf '0' >"$probe_count"
  PATH="$bin_dir:$PATH" \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    SANCTUARY_PLAYWRIGHT_PROBE_CMD="$(probe_cmd_succeeding_on_call 1 "$probe_count")" \
    bash "$SCRIPT"
  assert_contains "$log_file" 'playwright install ffmpeg'
  assert_not_contains "$log_file" 'playwright install chromium'
  assert_not_contains "$log_file" 'install-deps'
  [ "$(cat "$probe_count")" = '1' ] || fail 'expected exactly one probe call when already present'

  # Case 2: the pinned browser launches initially; no install is needed.
  : >"$log_file"
  printf '0' >"$probe_count"
  PATH="$bin_dir:$PATH" \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    SANCTUARY_PLAYWRIGHT_PROBE_CMD="$(probe_cmd_succeeding_on_call 1 "$probe_count")" \
    bash "$SCRIPT"
  assert_contains "$log_file" 'playwright install ffmpeg'
  assert_not_contains "$log_file" 'playwright install chromium'
  assert_not_contains "$log_file" 'install-deps'
  [ "$(cat "$probe_count")" = '1' ] || fail 'expected exactly one probe call'

  # Case 3: a failed pinned-browser launch installs OS dependencies, then probes again.
  : >"$log_file"
  printf '0' >"$probe_count"
  PATH="$bin_dir:$PATH" \
    SANCTUARY_RETRY_DELAY_SECONDS=0 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    SANCTUARY_PLAYWRIGHT_PROBE_CMD="$(probe_cmd_succeeding_on_call 2 "$probe_count")" \
    bash "$SCRIPT"
  assert_contains "$log_file" 'playwright install-deps chromium'
  assert_contains "$log_file" 'playwright install ffmpeg'
  [ "$(cat "$probe_count")" = '2' ] || fail 'expected exactly two probe calls'

  # A checkout-only classifier has no npm dependencies. Sandbox mode must
  # reject that state before attempting to install or mutate FFmpeg.
  local isolated_repo="$TEST_TEMP_DIR/checkout"
  local wrong_browser="$TEST_TEMP_DIR/wrong-chrome"
  printf '#!/usr/bin/env bash\necho "Google Chrome 1.2.3.4"\n' >"$wrong_browser"
  chmod +x "$wrong_browser"
  mkdir -p "$isolated_repo/scripts/ci" "$isolated_repo/config/tooling"
  cp "$SCRIPT" "$ROOT_DIR/scripts/ci/retry-command.sh" "$isolated_repo/scripts/ci/"
  cp "$ROOT_DIR/config/browser-toolchain.json" "$isolated_repo/config/"
  cp "$ROOT_DIR/config/tooling/playwright-browser.ts" "$isolated_repo/config/tooling/"
  if (cd "$isolated_repo" && node --input-type=module -e "await import('@playwright/test')") >"$TEST_TEMP_DIR/absent-package.log" 2>&1; then
    fail 'isolated fixture unexpectedly resolves Playwright'
  fi
  assert_contains "$TEST_TEMP_DIR/absent-package.log" 'ERR_MODULE_NOT_FOUND'
  : >"$log_file"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$TEST_TEMP_DIR/browsers" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/no-registry.log" 2>&1; then
    fail 'sandbox mode accepted missing locked Playwright registry'
  fi
  assert_contains "$TEST_TEMP_DIR/no-registry.log" 'sandbox mode requires usable FFmpeg'
  [ ! -s "$log_file" ] || fail 'sandbox mode attempted npx without the locked registry'

  : >"$log_file"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD -u PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_BROWSERS_PATH="$TEST_TEMP_DIR/browsers" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/no-baked-chrome.log" 2>&1; then
    fail 'sandbox mode attempted to provision Chromium when image executable was missing'
  fi
  assert_contains "$TEST_TEMP_DIR/no-baked-chrome.log" 'image-provided Chromium executable'
  [ ! -s "$log_file" ] || fail 'sandbox mode attempted npx with missing image Chromium'

  # The minimal fixture follows Playwright's registry API and pinned browsers.json
  # descriptor; it proves the exact registry-selected executable, not a glob.
  write_mock_playwright_registry "$isolated_repo" 1.64.1 1013
  local browsers_path="$TEST_TEMP_DIR/browsers"
  local ffmpeg_path="$browsers_path/ffmpeg-1013/ffmpeg-linux"
  local ffmpeg_call_log="$TEST_TEMP_DIR/ffmpeg-calls"
  write_mock_ffmpeg "$ffmpeg_path"
  : >"$log_file"
  (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" FFMPEG_CALL_LOG="$ffmpeg_call_log" \
    bash scripts/ci/install-playwright-chromium.sh)
  grep -Fq -- '-version' "$ffmpeg_call_log" || fail 'sandbox mode did not smoke-check the registry-selected FFmpeg'
  [ ! -s "$log_file" ] || fail 'sandbox mode invoked npx instead of verifying baked FFmpeg'
  assert_not_contains "$TEST_TEMP_DIR/no-registry.log" 'install-deps'

  # Sandbox mode never falls back to mutating package/OS dependencies if its
  # pinned browser version check fails.
  : >"$log_file"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$wrong_browser" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" FFMPEG_CALL_LOG="$ffmpeg_call_log" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/wrong-browser-version.log" 2>&1; then
    fail 'sandbox mode accepted a Chromium version that differs from the pinned toolchain'
  fi
  assert_contains "$TEST_TEMP_DIR/wrong-browser-version.log" 'does not match pinned'
  assert_not_contains "$TEST_TEMP_DIR/wrong-browser-version.log" 'installing OS dependencies'
  [ ! -s "$log_file" ] || fail 'sandbox mode attempted installer fallback after a failed pinned browser probe'

  # Missing and unusable registry entries fail closed without invoking npx.
  : >"$log_file"
  mv "$ffmpeg_path" "$ffmpeg_path.saved"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/missing-ffmpeg.log" 2>&1; then
    fail 'sandbox mode accepted a missing baked FFmpeg executable'
  fi
  assert_contains "$TEST_TEMP_DIR/missing-ffmpeg.log" 'sandbox mode requires usable FFmpeg'
  [ ! -s "$log_file" ] || fail 'missing FFmpeg triggered an installer mutation'
  mv "$ffmpeg_path.saved" "$ffmpeg_path"

  # A registry-provided path that resolves outside the locked revision folder
  # is not accepted, even when the linked target itself is executable.
  local external_ffmpeg="$browsers_path/ffmpeg-outside-registry"
  mv "$ffmpeg_path" "$external_ffmpeg"
  ln -s "$external_ffmpeg" "$ffmpeg_path"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/escaped-ffmpeg.log" 2>&1; then
    fail 'sandbox mode accepted an FFmpeg symlink outside its registry revision directory'
  fi
  assert_contains "$TEST_TEMP_DIR/escaped-ffmpeg.log" 'sandbox mode requires usable FFmpeg'
  [ ! -s "$log_file" ] || fail 'escaped FFmpeg path triggered an installer mutation'
  rm "$ffmpeg_path"
  mv "$external_ffmpeg" "$ffmpeg_path"

  # Registry revisions must be valid identifiers before they determine a path.
  sed -i 's|"revision":"1013"|"revision":"../bad"|' \
    "$isolated_repo/node_modules/playwright-core/browsers.json"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/malformed-revision.log" 2>&1; then
    fail 'sandbox mode accepted a malformed Playwright FFmpeg revision'
  fi
  assert_contains "$TEST_TEMP_DIR/malformed-revision.log" 'sandbox mode requires usable FFmpeg'
  [ ! -s "$log_file" ] || fail 'malformed FFmpeg revision triggered an installer mutation'
  sed -i 's|"revision":"../bad"|"revision":"1013"|' \
    "$isolated_repo/node_modules/playwright-core/browsers.json"

  write_mock_ffmpeg "$ffmpeg_path" unusable
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/unusable-ffmpeg.log" 2>&1; then
    fail 'sandbox mode accepted an unusable baked FFmpeg executable'
  fi
  [ ! -s "$log_file" ] || fail 'unusable FFmpeg triggered an installer mutation'
  write_mock_ffmpeg "$ffmpeg_path"

  # A mismatched Playwright package is not allowed to authorize this image's
  # FFmpeg revision, even if the candidate executable runs.
  sed -i 's/1\.64\.1/1.63.0/g' "$isolated_repo/node_modules/playwright/package.json" \
    "$isolated_repo/node_modules/playwright-core/package.json"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/wrong-playwright.log" 2>&1; then
    fail 'sandbox mode accepted a mismatched Playwright package'
  fi
  assert_contains "$TEST_TEMP_DIR/wrong-playwright.log" 'installed Playwright version differs'
  [ ! -s "$log_file" ] || fail 'mismatched Playwright invoked an installer'

  # Restore the package version before local-mode tests: local mode retains its
  # existing installer and canonical chromium launch behavior.
  sed -i 's/1\.63\.0/1.64.1/g' "$isolated_repo/node_modules/playwright/package.json" \
    "$isolated_repo/node_modules/playwright-core/package.json"
  sed -i 's/"version":"1\.64\.1"/"version":"1.63.0"/' \
    "$isolated_repo/node_modules/playwright-core/package.json"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PLAYWRIGHT_BROWSERS_PATH="$browsers_path" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/wrong-core.log" 2>&1; then
    fail 'sandbox mode accepted a mismatched Playwright Core package'
  fi
  assert_contains "$TEST_TEMP_DIR/wrong-core.log" 'installed Playwright Core version differs'
  [ ! -s "$log_file" ] || fail 'mismatched Playwright Core invoked an installer'
  sed -i 's/"version":"1\.63\.0"/"version":"1.64.1"/' \
    "$isolated_repo/node_modules/playwright-core/package.json"
  assert_not_contains "$log_file" 'install-deps'

  # Invalid modes fail before attempting setup or launch.
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_RETRY_DELAY_SECONDS=0 SANCTUARY_SANDBOXED_BROWSER=invalid \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/wrong-mode.log" 2>&1; then
    fail 'invalid sandbox mode was accepted'
  fi
  assert_contains "$TEST_TEMP_DIR/wrong-mode.log" 'Invalid sandboxed browser mode'
  assert_not_contains "$TEST_TEMP_DIR/wrong-mode.log" 'ERR_MODULE_NOT_FOUND'
  : >"$log_file"
  if (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD SANCTUARY_SANDBOXED_BROWSER= \
    PATH="$bin_dir:$PATH" SANCTUARY_RETRY_DELAY_SECONDS=0 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    bash scripts/ci/install-playwright-chromium.sh) >"$TEST_TEMP_DIR/empty-mode.log" 2>&1; then
    fail 'explicitly empty sandbox mode was accepted'
  fi
  assert_contains "$TEST_TEMP_DIR/empty-mode.log" 'Invalid sandboxed browser mode'
  [ ! -s "$log_file" ] || fail 'explicitly empty mode invoked an installer'

  # Local mode still imports the canonical policy and launches/closes with its
  # exact options. This package is an inert recorder, never a real browser.
  mkdir -p "$isolated_repo/node_modules/@playwright/test"
  printf '{"type":"module","exports":"./index.js"}\n' >"$isolated_repo/node_modules/@playwright/test/package.json"
  cat >"$isolated_repo/node_modules/@playwright/test/index.js" <<'MOCK'
import { writeFileSync, appendFileSync } from 'node:fs';
export const chromium = {
  async launch(options) {
    writeFileSync(process.env.PROBE_OPTIONS_LOG, JSON.stringify(options));
    return { async close() { appendFileSync(process.env.PROBE_CLOSE_LOG, 'closed\n'); } };
  },
};
MOCK
  : >"$log_file"
  (cd "$isolated_repo" && env -u SANCTUARY_PLAYWRIGHT_PROBE_CMD \
    PATH="$bin_dir:$PATH" SANCTUARY_SANDBOXED_BROWSER=0 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_executable" \
    PROBE_OPTIONS_LOG="$TEST_TEMP_DIR/options.json" PROBE_CLOSE_LOG="$TEST_TEMP_DIR/close.log" \
    bash scripts/ci/install-playwright-chromium.sh)
  node - "$TEST_TEMP_DIR/options.json" "$browser_executable" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.deepEqual(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), {
  headless: true, executablePath: process.argv[3], chromiumSandbox: true, args: ['--enable-automation'],
});
NODE
  [ "$(cat "$TEST_TEMP_DIR/close.log")" = 'closed' ] || fail 'local probe did not close exactly once'
  assert_not_contains "$log_file" 'install-deps'

  echo 'install-playwright-chromium regression checks passed'
}

main "$@"
