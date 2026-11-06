import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type BrowserToolchain = {
  playwrightVersion: string;
  browserVersion: string;
  minimumBrowserVersion: string;
  browserSha256: string;
};

export function resolvePlaywrightBrowser(repoRoot: string): string {
  const toolchain = JSON.parse(
    readFileSync(path.join(repoRoot, 'config/browser-toolchain.json'), 'utf8'),
  ) as BrowserToolchain;
  const cacheRoot = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  const browserCache = path.join(
    cacheRoot,
    `sanctuary/chrome-for-testing/${toolchain.browserVersion}`,
  );
  const cachedExecutable = path.join(browserCache, 'chrome-linux64/chrome');
  const verifiedCache = existsSync(cachedExecutable)
    && existsSync(path.join(browserCache, '.archive-sha256'))
    && readFileSync(path.join(browserCache, '.archive-sha256'), 'utf8').trim() === toolchain.browserSha256;
  const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (existsSync('/opt/chrome/chrome-linux64/chrome')
      ? '/opt/chrome/chrome-linux64/chrome'
      : verifiedCache ? cachedExecutable : undefined);

  if (!executable) {
    throw new Error(
      `Pinned Chrome for Testing ${toolchain.browserVersion} is unavailable; run scripts/ci/install-playwright-chromium.sh`,
    );
  }
  try {
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(`Pinned Chromium executable is not executable: ${executable}`);
  }
  const versionOutput = execFileSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+\.\d+)/);
  if (versionMatch?.[1] !== toolchain.browserVersion) {
    throw new Error(
      `Pinned Chromium version ${versionMatch?.[1] ?? 'unknown'} does not match ${toolchain.browserVersion}`,
    );
  }

  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = executable;
  process.env.MINIMUM_BROWSER_VERSION = toolchain.minimumBrowserVersion;
  return executable;
}

/** Chromium sandboxing is mandatory: unsupported/root launches fail closed.
 * Containers must supply a reviewed host policy; never disable the sandbox to
 * work around launch failures. Firefox and WebKit retain their own options.
 */
export function chromiumLaunchOptions(executablePath: string) {
  return { executablePath, chromiumSandbox: true, args: ['--enable-automation'] };
}

/** Only explicitly selected isolated CI runs accept a loopback/token endpoint.
 * This validates endpoint shape, not authentication: the transport wrapper owns
 * container identity, process policy and sandbox-readiness verification.
 */
export function chromiumConnectionOptions(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.SANCTUARY_SANDBOXED_BROWSER ?? '0';
  const endpoint = env.SANCTUARY_PLAYWRIGHT_WS_ENDPOINT;
  if (mode !== '0' && mode !== '1') throw new Error('Invalid sandboxed browser mode');
  if (mode === '0') {
    if (endpoint) throw new Error('Unexpected remote Chromium endpoint');
    return {};
  }
  const match = endpoint?.match(/^ws:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/[A-Za-z0-9_-]+$/);
  if (!endpoint || !match || Number(match[1]) > 65535) {
    throw new Error('Sandboxed Chromium requires a valid loopback browser-server endpoint');
  }
  return { connectOptions: { wsEndpoint: endpoint } };
}
