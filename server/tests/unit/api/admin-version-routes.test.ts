import { afterEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';

interface SetupOptions {
  fetchImpl?: () => Promise<unknown>;
  joinImpl?: (...parts: string[]) => string;
  readFileSyncImpl?: () => string;
}

async function setupVersionRoute(options: SetupOptions = {}) {
  vi.resetModules();

  const warn = vi.fn();
  const error = vi.fn();
  const readFileSync = vi.fn(
    options.readFileSyncImpl ?? (() => JSON.stringify({ version: '1.2.3' }))
  );
  const fetchMock = vi.fn(
    options.fetchImpl ??
      (() =>
        Promise.resolve({
          ok: false,
        }))
  );

  const actualPath = await vi.importActual<typeof import('path')>('path');
  const join = vi.fn(options.joinImpl ?? actualPath.join);

  vi.doMock('../../../src/utils/logger', () => ({
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error,
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

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  const app: Express = express();
  const versionRouter = (await import('../../../src/api/admin/version')).default;
  app.use('/api/v1/admin/version', versionRouter);
  app.use(errorHandler);

  return { app, error, fetchMock, join, readFileSync, warn };
}

describe('Admin Version Routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('logs warning when package version cannot be read from all candidate paths', async () => {
    const { app, readFileSync, warn } = await setupVersionRoute({
      readFileSyncImpl: () => {
        throw new Error('package missing');
      },
    });

    expect(readFileSync).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('Could not read version from package.json');

    const response = await request(app).get('/api/v1/admin/version');
    expect(response.status).toBe(200);
    expect(response.body.currentVersion).toBe('0.0.0');
  });

  it('logs warning when startup initialization throws unexpectedly', async () => {
    const { app, join, warn } = await setupVersionRoute({
      joinImpl: () => {
        throw new Error('join failed');
      },
    });

    expect(join).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Could not read version from package.json');

    const response = await request(app).get('/api/v1/admin/version');
    expect(response.status).toBe(200);
  });

  it('returns release info and uses cache for repeated checks', async () => {
    const releaseJson = {
      tag_name: 'v1.4.0',
      html_url: 'https://github.com/nekoguntai-castle/sanctuary/releases/tag/v1.4.0',
      name: 'v1.4.0',
      published_at: '2026-01-01T00:00:00.000Z',
      body: 'Release notes',
    };

    const { app, fetchMock } = await setupVersionRoute({
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue(releaseJson),
        }),
    });

    const firstResponse = await request(app).get('/api/v1/admin/version');
    const secondResponse = await request(app).get('/api/v1/admin/version');

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toMatchObject({
      currentVersion: '1.2.3',
      latestVersion: '1.4.0',
      updateAvailable: true,
      releaseUrl: releaseJson.html_url,
      releaseName: releaseJson.name,
      publishedAt: releaseJson.published_at,
      releaseNotes: releaseJson.body,
    });
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.latestVersion).toBe('1.4.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back release fields when GitHub payload is incomplete and marks downgrade as no update', async () => {
    const { app } = await setupVersionRoute({
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({}),
        }),
    });

    const response = await request(app).get('/api/v1/admin/version');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      currentVersion: '1.2.3',
      latestVersion: '0.0.0',
      updateAvailable: false,
      releaseUrl: 'https://github.com/nekoguntai-castle/sanctuary/releases',
      releaseName: '',
      publishedAt: '',
      releaseNotes: '',
    });
  });

  it('logs warning and falls back when GitHub release fetch fails', async () => {
    const { app, warn } = await setupVersionRoute({
      fetchImpl: () => Promise.reject(new Error('network down')),
    });

    const response = await request(app).get('/api/v1/admin/version');

    expect(response.status).toBe(200);
    expect(response.body.latestVersion).toBe('1.2.3');
    expect(response.body.updateAvailable).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Failed to fetch latest release from GitHub',
      expect.objectContaining({
        error: expect.stringContaining('network down'),
      })
    );
  });

  it('returns 500 when version comparison encounters invalid package version data', async () => {
    const { app } = await setupVersionRoute({
      readFileSyncImpl: () => JSON.stringify({ version: 123 }),
    });

    const response = await request(app).get('/api/v1/admin/version');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
