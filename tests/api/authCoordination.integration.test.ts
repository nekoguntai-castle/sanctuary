import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_CSRF_SESSION_STALE_CODE } from '@sanctuary/shared/types/api';
import apiClient from '../../src/api/client';
import { runExclusiveAuthRefresh } from '../../src/api/authCoordination';
import { __resetRefreshModuleForTests } from '../../src/api/refresh';

const mockFetch = vi.fn<typeof fetch>();

const jsonResponse = (status: number, body: unknown, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });

const clearCsrfCookie = (): void => {
  document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
};

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  __resetRefreshModuleForTests();
  clearCsrfCookie();
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

afterEach(() => {
  __resetRefreshModuleForTests();
  clearCsrfCookie();
  vi.restoreAllMocks();
});

describe('auth request coordination integration', () => {
  it('releases shared before 401 refresh and reacquires shared for replay', async () => {
    document.cookie = 'sanctuary_csrf=csrf-before-refresh; path=/';
    const lockSpy = vi.spyOn(navigator.locks, 'request');
    const mutationHeaders: Array<Record<string, string>> = [];
    let mutationAttempts = 0;

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        document.cookie = 'sanctuary_csrf=csrf-after-refresh; path=/';
        return jsonResponse(200, {}, {
          'X-Access-Expires-At': new Date(Date.now() + 3_600_000).toISOString(),
        });
      }

      mutationAttempts += 1;
      mutationHeaders.push(init?.headers as Record<string, string>);
      return mutationAttempts === 1
        ? jsonResponse(401, { message: 'expired' })
        : jsonResponse(200, { ok: true });
    });

    await expect(apiClient.post('/wallets', { name: 'coordinated' }))
      .resolves.toEqual({ ok: true });

    expect(lockSpy.mock.calls.map(call => call[1]?.mode)).toEqual([
      'shared',
      'exclusive',
      'shared',
    ]);
    expect(mutationHeaders[0]['X-CSRF-Token']).toBe('csrf-before-refresh');
    expect(mutationHeaders[1]['X-CSRF-Token']).toBe('csrf-after-refresh');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('releases and reacquires shared around the one stale credential replay', async () => {
    document.cookie = 'sanctuary_csrf=stale-csrf; path=/';
    const lockSpy = vi.spyOn(navigator.locks, 'request');
    const body = { username: 'user', password: 'secret' };
    let attempts = 0;

    mockFetch.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) {
        clearCsrfCookie();
        return jsonResponse(403, {
          error: 'AuthCsrfSessionStale',
          code: AUTH_CSRF_SESSION_STALE_CODE,
        });
      }
      return jsonResponse(200, { ok: true });
    });

    await expect(apiClient.post('/auth/login', body)).resolves.toEqual({ ok: true });

    expect(lockSpy.mock.calls.map(call => call[1]?.mode)).toEqual(['shared', 'shared']);
    expect(mockFetch.mock.calls.map(call => call[1]?.body)).toEqual([
      JSON.stringify(body),
      JSON.stringify(body),
    ]);
  });

  it('builds headers after lock grant and releases the lock before response parsing', async () => {
    document.cookie = 'sanctuary_csrf=csrf-before-wait; path=/';
    const releaseInitialExclusive = deferred();
    const releaseParsing = deferred();
    const initialExclusive = runExclusiveAuthRefresh(async () => {
      await releaseInitialExclusive.promise;
    });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => {
        await releaseParsing.promise;
        return JSON.stringify({ ok: true });
      },
    } as Response);

    let mutationSettled = false;
    const mutation = apiClient.post('/wallets', { name: 'queued' })
      .finally(() => {
        mutationSettled = true;
      });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();

    document.cookie = 'sanctuary_csrf=csrf-after-wait; path=/';
    releaseInitialExclusive.resolve();
    await initialExclusive;
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect((mockFetch.mock.calls[0][1]?.headers as Record<string, string>)['X-CSRF-Token'])
      .toBe('csrf-after-wait');

    const laterExclusive = vi.fn(async () => undefined);
    await runExclusiveAuthRefresh(laterExclusive);
    expect(laterExclusive).toHaveBeenCalledTimes(1);
    expect(mutationSettled).toBe(false);

    releaseParsing.resolve();
    await expect(mutation).resolves.toEqual({ ok: true });
  });
});
