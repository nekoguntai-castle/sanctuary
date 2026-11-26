import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.unmock('../../../src/utils/logger');

describe('P2-11 config/loadEnv & dynamic docker proxy config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('syncs logger level from config.logging.level when config loads', async () => {
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters-0000';
    process.env.LOG_LEVEL = 'info';
    const logger = await import('../../../src/utils/logger');
    expect(logger.getConfiguredLogLevel()).toBe('info');

    // Simulate LOG_LEVEL becoming 'warn' after logger was already imported (e.g. via dotenv)
    process.env.LOG_LEVEL = 'warn';
    await import('../../../src/config');

    expect(logger.getConfiguredLogLevel()).toBe('warn');
  });

  it('reads docker proxy URL from getConfig().docker.proxyUrl dynamically', async () => {
    vi.doMock('../../../src/config', () => ({
      getConfig: () => ({
        docker: { proxyUrl: 'http://custom-docker-proxy:2375' },
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const dockerCommon = await import('../../../src/utils/docker/common');
      const available = await dockerCommon.isDockerProxyAvailable();

      expect(available).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://custom-docker-proxy:2375/containers/json?limit=1',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
