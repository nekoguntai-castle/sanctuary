import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromiumConnectionOptions, chromiumLaunchOptions, resolvePlaywrightBrowser } from '../../config/tooling/playwright-browser';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(), read: vi.fn(), access: vi.fn(), execute: vi.fn(),
}));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  const stub = { ...actual, existsSync: mocks.exists, readFileSync: mocks.read, accessSync: mocks.access };
  return { ...stub, default: stub };
});
vi.mock('node:child_process', () => ({
  execFileSync: mocks.execute, default: { execFileSync: mocks.execute },
}));

const toolchain = {
  playwrightVersion: '1.64.1', browserVersion: '157.0.8103.38',
  minimumBrowserVersion: '156.0.8078.73', browserSha256: 'a'.repeat(64),
};
const cached = '/cache/sanctuary/chrome-for-testing/157.0.8103.38/chrome-linux64/chrome';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('XDG_CACHE_HOME', '/cache');
  vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', undefined);
  vi.stubEnv('MINIMUM_BROWSER_VERSION', undefined);
  mocks.exists.mockReturnValue(false);
  mocks.read.mockImplementation((file: string) => file.endsWith('browser-toolchain.json')
    ? JSON.stringify(toolchain) : toolchain.browserSha256);
  mocks.execute.mockReturnValue('Google Chrome for Testing 157.0.8103.38\n');
});
afterEach(() => vi.unstubAllEnvs());

describe('pinned Chromium selection', () => {
  it('selects and validates the explicit executable before cache or image paths', () => {
    vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/explicit/chrome');
    mocks.exists.mockReturnValue(true);
    expect(resolvePlaywrightBrowser('/repo')).toBe('/explicit/chrome');
    expect(mocks.execute).toHaveBeenCalledWith('/explicit/chrome', ['--version'], {
      encoding: 'utf8', timeout: 10_000,
    });
    expect(process.env.MINIMUM_BROWSER_VERSION).toBe(toolchain.minimumBrowserVersion);
  });
  it('selects the image executable when present', () => {
    mocks.exists.mockImplementation((file: string) => file.startsWith('/opt/chrome/'));
    expect(resolvePlaywrightBrowser('/repo')).toBe('/opt/chrome/chrome-linux64/chrome');
  });
  it('uses the cache only with matching archive provenance', () => {
    mocks.exists.mockImplementation((file: string) => file.startsWith('/cache/'));
    expect(resolvePlaywrightBrowser('/repo')).toBe(cached);
  });
  it('treats an empty override as unset, matching the installer', () => {
    vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '');
    mocks.exists.mockImplementation((file: string) => file.startsWith('/cache/'));
    expect(resolvePlaywrightBrowser('/repo')).toBe(cached);
  });
  it('rejects an unverified cache without launching it', () => {
    mocks.exists.mockImplementation((file: string) => file.startsWith('/cache/'));
    mocks.read.mockImplementation((file: string) => file.endsWith('browser-toolchain.json')
      ? JSON.stringify(toolchain) : 'different');
    expect(() => resolvePlaywrightBrowser('/repo')).toThrow('is unavailable');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('fails closed when no browser is provisioned', () => {
    expect(() => resolvePlaywrightBrowser('/repo')).toThrow('is unavailable');
  });
  it('rejects a non-executable override', () => {
    vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/explicit/chrome');
    mocks.access.mockImplementation(() => { throw new Error('EACCES'); });
    expect(() => resolvePlaywrightBrowser('/repo')).toThrow('is not executable');
  });
  it.each(['Google Chrome 149.0.7827.55', 'unparseable'])('rejects version output %s', (output) => {
    vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/explicit/chrome');
    mocks.execute.mockReturnValue(output);
    expect(() => resolvePlaywrightBrowser('/repo')).toThrow('does not match');
  });
  it('propagates a failed version probe', () => {
    vi.stubEnv('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH', '/explicit/chrome');
    mocks.execute.mockImplementation(() => { throw new Error('probe failed'); });
    expect(() => resolvePlaywrightBrowser('/repo')).toThrow('probe failed');
  });
});

it('requires the Chromium sandbox and observable command-line evidence', () => {
  expect(chromiumLaunchOptions('/opt/chrome/chrome')).toEqual({
    executablePath: '/opt/chrome/chrome', chromiumSandbox: true, args: ['--enable-automation'],
  });
});

describe('isolated Chromium connection', () => {
  it('keeps local execution without an endpoint', () => {
    expect(chromiumConnectionOptions({})).toEqual({});
  });
  it('accepts an explicitly selected loopback server', () => {
    const endpoint = 'ws://127.0.0.1:32100/opaque-token';
    expect(chromiumConnectionOptions({ SANCTUARY_SANDBOXED_BROWSER: '1',
      SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: endpoint })).toEqual({ connectOptions: { wsEndpoint: endpoint } });
  });
  it.each([undefined, '', 'ws://remote:123/token', 'ws://127.0.0.1:99999/token',
    'ws://127.0.0.1:0/token', 'ws://127.0.0.1:123/token?secret=yes'])('rejects invalid endpoint %s', (endpoint) => {
    expect(() => chromiumConnectionOptions({ SANCTUARY_SANDBOXED_BROWSER: '1',
      SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: endpoint })).toThrow('valid loopback');
  });
  it('rejects unexpected endpoints and unknown modes', () => {
    expect(() => chromiumConnectionOptions({ SANCTUARY_PLAYWRIGHT_WS_ENDPOINT: 'secret' })).toThrow('Unexpected');
    expect(() => chromiumConnectionOptions({ SANCTUARY_SANDBOXED_BROWSER: 'true' })).toThrow('Invalid');
  });
});
