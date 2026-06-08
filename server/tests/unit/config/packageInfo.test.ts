import { afterEach, describe, expect, it, vi } from 'vitest';

interface SetupOptions {
  readFileSyncImpl?: () => string;
  joinImpl?: (...parts: string[]) => string;
}

async function setupPackageInfo(options: SetupOptions = {}) {
  vi.resetModules();

  const warn = vi.fn();
  const debug = vi.fn();
  const readFileSync = vi.fn(
    options.readFileSyncImpl ?? (() => JSON.stringify({ version: '9.9.9' })),
  );

  const actualPath = await vi.importActual<typeof import('path')>('path');
  const join = vi.fn(options.joinImpl ?? actualPath.join);

  vi.doMock('../../../src/utils/logger', () => ({
    createLogger: () => ({
      debug,
      info: vi.fn(),
      warn,
      error: vi.fn(),
    }),
  }));

  vi.doMock('fs', async () => {
    const actualFs = await vi.importActual<typeof import('fs')>('fs');
    return {
      ...actualFs,
      readFileSync,
    };
  });

  vi.doMock('path', () => ({
    ...actualPath,
    join,
  }));

  const mod = await import('../../../src/config/packageInfo');
  return { PACKAGE_VERSION: mod.PACKAGE_VERSION, readFileSync, join, warn, debug };
}

describe('packageInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns the version from the first resolvable candidate path', async () => {
    const { PACKAGE_VERSION, readFileSync } = await setupPackageInfo();

    expect(PACKAGE_VERSION).toBe('9.9.9');
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next candidate when an earlier read throws', async () => {
    let call = 0;
    const { PACKAGE_VERSION, readFileSync, debug } = await setupPackageInfo({
      readFileSyncImpl: () => {
        call += 1;
        if (call === 1) {
          throw new Error('first path missing');
        }
        return JSON.stringify({ version: '2.0.0' });
      },
    });

    expect(PACKAGE_VERSION).toBe('2.0.0');
    expect(readFileSync).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenCalledWith(
      'Package version path did not resolve',
      expect.objectContaining({ error: expect.stringContaining('first path missing') }),
    );
  });

  it('skips candidates whose package.json has no version field', async () => {
    let call = 0;
    const { PACKAGE_VERSION, readFileSync } = await setupPackageInfo({
      readFileSyncImpl: () => {
        call += 1;
        if (call === 1) {
          return JSON.stringify({ name: 'no-version-here' });
        }
        return JSON.stringify({ version: '3.0.0' });
      },
    });

    expect(PACKAGE_VERSION).toBe('3.0.0');
    expect(readFileSync).toHaveBeenCalledTimes(2);
  });

  it('warns and falls back to 0.0.0 when every candidate fails', async () => {
    const { PACKAGE_VERSION, readFileSync, warn } = await setupPackageInfo({
      readFileSyncImpl: () => {
        throw new Error('not found');
      },
    });

    expect(PACKAGE_VERSION).toBe('0.0.0');
    expect(readFileSync).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('Could not read version from package.json');
  });

  it('falls through the outer catch when path construction throws', async () => {
    const { PACKAGE_VERSION, warn, debug } = await setupPackageInfo({
      joinImpl: () => {
        throw new Error('join blew up');
      },
    });

    expect(PACKAGE_VERSION).toBe('0.0.0');
    expect(warn).toHaveBeenCalledWith('Could not read version from package.json');
    expect(debug).toHaveBeenCalledWith(
      'Unexpected error resolving package version',
      expect.objectContaining({ error: expect.stringContaining('join blew up') }),
    );
  });
});
