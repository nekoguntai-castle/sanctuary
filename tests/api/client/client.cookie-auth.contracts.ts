import { afterEach, describe, expect, it } from 'vitest';

import {
  apiClient,
  mockFetch,
  mockRefreshAccessToken,
  mockScheduleRefreshFromHeader,
} from './clientTestHarness';

export const registerApiClientCookieAuthContracts = () => {
  describe('Phase 4 — cookie auth + CSRF + X-Access-Expires-At + 401 interceptor', () => {
    function okResponse(body: unknown = {}, headers?: Record<string, string>) {
      const headersMap = new Map<string, string>(Object.entries(headers ?? {}));
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        headers: { get: (name: string) => headersMap.get(name) ?? null },
      };
    }

    function errorResponse(status: number, body: unknown = { message: 'error' }, headers?: Record<string, string>) {
      const headersMap = new Map<string, string>(Object.entries(headers ?? {}));
      return {
        ok: false,
        status,
        statusText: 'Error',
        json: () => Promise.resolve(body),
        headers: { get: (name: string) => headersMap.get(name) ?? null },
      };
    }

    afterEach(() => {
      // Belt-and-suspenders: clear any cookies a test set so the next
      // test starts with an empty cookie jar.
      if (typeof document !== 'undefined') {
        document.cookie.split(';').forEach((c) => {
          const name = c.split('=')[0]?.trim();
          if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        });
      }
    });

    // -- credentials: 'include' -----------------------------------------
    it('sends credentials: "include" on GET requests', async () => {
      mockFetch.mockResolvedValue(okResponse({}));
      await apiClient.get('/public');
      expect(mockFetch.mock.calls[0][1].credentials).toBe('include');
    });

    it('sends credentials: "include" on POST requests', async () => {
      mockFetch.mockResolvedValue(okResponse({}));
      await apiClient.post('/endpoint', { x: 1 });
      expect(mockFetch.mock.calls[0][1].credentials).toBe('include');
    });

    // -- CSRF header ----------------------------------------------------
    it('does NOT include X-CSRF-Token on GET requests', async () => {
      document.cookie = 'sanctuary_csrf=csrf-value; path=/';
      mockFetch.mockResolvedValue(okResponse({}));

      await apiClient.get('/public');

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBeUndefined();
    });

    it('reads sanctuary_csrf cookie and injects X-CSRF-Token on POST', async () => {
      document.cookie = 'sanctuary_csrf=csrf-value-123; path=/';
      mockFetch.mockResolvedValue(okResponse({}));

      await apiClient.post('/endpoint', { x: 1 });

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('csrf-value-123');
    });

    it('injects X-CSRF-Token on PUT/PATCH/DELETE', async () => {
      document.cookie = 'sanctuary_csrf=csrf-value-abc; path=/';
      mockFetch.mockResolvedValue(okResponse({}));

      await apiClient.put('/endpoint', {});
      expect((mockFetch.mock.calls[0][1].headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-value-abc');

      mockFetch.mockClear();
      await apiClient.patch('/endpoint', {});
      expect((mockFetch.mock.calls[0][1].headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-value-abc');

      mockFetch.mockClear();
      await apiClient.delete('/endpoint');
      expect((mockFetch.mock.calls[0][1].headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-value-abc');
    });

    it('omits X-CSRF-Token when no sanctuary_csrf cookie is set', async () => {
      // Fresh pre-login session: no cookie yet. The backend's
      // skipCsrfProtection lets the request through because there is
      // also no sanctuary_access cookie, so this is still a valid path.
      mockFetch.mockResolvedValue(okResponse({}));

      await apiClient.post('/auth/login', { username: 'u', password: 'p' });

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBeUndefined();
    });

    // -- X-Access-Expires-At forwarding ---------------------------------
    it('forwards X-Access-Expires-At to refresh.scheduleRefreshFromHeader on any response that carries it', async () => {
      const iso = new Date(Date.now() + 3600_000).toISOString();
      mockFetch.mockResolvedValue(okResponse({ user: { id: 'u1' } }, { 'X-Access-Expires-At': iso }));

      await apiClient.get('/auth/me');

      expect(mockScheduleRefreshFromHeader).toHaveBeenCalledWith(iso);
    });

    it('does not call scheduleRefreshFromHeader when the header is absent', async () => {
      mockFetch.mockResolvedValue(okResponse({}));
      await apiClient.get('/wallets');
      expect(mockScheduleRefreshFromHeader).not.toHaveBeenCalled();
    });

    // -- 401 refresh interceptor ----------------------------------------
    it('triggers refreshAccessToken + retry on 401 for a non-exempt endpoint', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(401, { message: 'Unauthorized' }))
        .mockResolvedValueOnce(okResponse({ ok: true }));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      const result = await apiClient.get('/wallets', undefined, { enabled: false });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
    });

    it('surfaces the second 401 without a third refresh attempt when the retry also fails', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(401, { message: 'Unauthorized' }))
        .mockResolvedValueOnce(errorResponse(401, { message: 'Still unauthorized' }));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      await expect(apiClient.get('/wallets', undefined, { enabled: false }))
        .rejects.toMatchObject({ status: 401 });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does NOT trigger refresh on 401 from exempt auth identity-credential endpoints', async () => {
      // Only the credential-presentation endpoints are exempt — a 401
      // from these means the credential being presented is the problem
      // itself (wrong password, wrong 2FA code, refresh token revoked),
      // not "the access token expired and should be refreshed". /auth/me,
      // /auth/logout, and /auth/logout-all are intentionally NOT in
      // the exempt list — see client.ts comments.
      const exemptEndpoints = [
        '/auth/login',
        '/auth/register',
        '/auth/2fa/verify',
        '/auth/refresh',
      ];

      for (const endpoint of exemptEndpoints) {
        mockFetch.mockClear();
        mockRefreshAccessToken.mockClear();
        mockFetch.mockResolvedValue(errorResponse(401, { message: 'Unauthorized' }));

        await expect(
          apiClient.post(endpoint, {}, { retry: { enabled: false } }),
        ).rejects.toMatchObject({ status: 401 });

        expect(mockRefreshAccessToken).not.toHaveBeenCalled();
      }
    });

    it('DOES trigger refresh on 401 from /auth/me (valid-session recovery on boot)', async () => {
      // ADR 0001/0002: a 401 from /auth/me with a still-valid refresh
      // cookie should refresh + retry, hydrating the user. Excluding
      // /auth/me from the interceptor would force-logout users on
      // every reload after their access token expired.
      mockFetch
        .mockResolvedValueOnce(errorResponse(401, { message: 'Unauthorized' }))
        .mockResolvedValueOnce(okResponse({ id: 'user-1', username: 'restored' }));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      const result = await apiClient.get<{ username: string }>('/auth/me', undefined, { enabled: false });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.username).toBe('restored');
    });

    it('DOES trigger refresh on 401 from /auth/logout (revoke session even when access expired)', async () => {
      // The interceptor refreshes + retries the logout call so the
      // server-side session is actually revoked even when the access
      // token has already expired client-side. authApi.logout() also
      // catches errors so local cleanup runs regardless.
      mockFetch
        .mockResolvedValueOnce(errorResponse(401, { message: 'Unauthorized' }))
        .mockResolvedValueOnce(okResponse({ success: true }));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      const result = await apiClient.post<{ success: boolean }>('/auth/logout', {}, { retry: { enabled: false } });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('does not trigger refresh on non-401 errors', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, { message: 'server error' }));

      await expect(apiClient.get('/wallets', undefined, { enabled: false }))
        .rejects.toMatchObject({ status: 500 });

      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('surfaces the original 401 when the refresh itself fails', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, { message: 'Unauthorized' }));
      mockRefreshAccessToken.mockRejectedValue(new Error('refresh broke'));

      await expect(apiClient.get('/wallets', undefined, { enabled: false }))
        .rejects.toMatchObject({ status: 401 });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      // fetch only called once — the retry was aborted because refresh
      // failed, so the original 401 is surfaced.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('strips the query string before checking the exempt list', async () => {
      // /auth/refresh?foo=bar must be treated the same as /auth/refresh
      // — a 401 from the refresh endpoint must NOT recursively call
      // refresh again (infinite loop) even when query params are present.
      mockFetch.mockResolvedValue(errorResponse(401));

      await expect(apiClient.post('/auth/refresh?foo=bar', {}, { retry: { enabled: false } }))
        .rejects.toMatchObject({ status: 401 });

      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('omits X-CSRF-Token when the cookie jar has other cookies but no sanctuary_csrf', async () => {
      // Exercises the readCsrfCookieValue end-of-loop "no match" branch
      // — the cookie jar is non-empty but does not contain sanctuary_csrf.
      document.cookie = 'unrelated=value; path=/';
      document.cookie = 'another=foo; path=/';
      mockFetch.mockResolvedValue(okResponse({}));

      await apiClient.post('/endpoint', { x: 1 });

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBeUndefined();

      document.cookie = 'unrelated=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = 'another=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    it('surfaces the original 401 when refresh.refreshAccessToken throws a RefreshFailedError', async () => {
      // Exercises the `refreshErr instanceof RefreshFailedError` true
      // branch in the 401 interceptor. refresh.ts has already broadcast
      // the terminal logout; the client just needs to bubble up the
      // original 401 so the caller knows the retry was not attempted.
      const { RefreshFailedError } = await import('../../../src/api/refresh');
      mockFetch.mockResolvedValueOnce(errorResponse(401, { message: 'Unauthorized' }));
      mockRefreshAccessToken.mockRejectedValueOnce(new RefreshFailedError('rejected', 401));

      await expect(apiClient.get('/wallets', undefined, { enabled: false }))
        .rejects.toMatchObject({ status: 401 });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fetchBlob with state-changing method injects X-CSRF-Token from the cookie', async () => {
      document.cookie = 'sanctuary_csrf=blob-csrf; path=/';
      const blob = new Blob(['x']);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
      });

      await apiClient.fetchBlob('/exports/archive', { method: 'POST' });

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['X-CSRF-Token']).toBe('blob-csrf');

      document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    it('download with state-changing method injects X-CSRF-Token from the cookie', async () => {
      document.cookie = 'sanctuary_csrf=download-csrf; path=/';
      const blob = new Blob(['x']);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: () => Promise.resolve(blob),
      });

      await apiClient.download('/admin/something', 'file.bin', { method: 'POST' });

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['X-CSRF-Token']).toBe('download-csrf');

      document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    it('upload always injects X-CSRF-Token because POST is implicit', async () => {
      document.cookie = 'sanctuary_csrf=upload-csrf; path=/';
      mockFetch.mockResolvedValueOnce(okResponse({ uploaded: true }));

      const formData = new FormData();
      formData.append('file', new Blob(['x']), 'file.bin');
      await apiClient.upload('/upload', formData);

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['X-CSRF-Token']).toBe('upload-csrf');

      document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });

    it('fetchBlob with state-changing method omits X-CSRF-Token when no cookie is set', async () => {
      // Exercises the falsy `if (csrf)` branch in fetchBlob.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['x'])),
      });

      await apiClient.fetchBlob('/exports/archive', { method: 'POST' });

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['X-CSRF-Token']).toBeUndefined();
    });

    it('download with state-changing method omits X-CSRF-Token when no cookie is set', async () => {
      // Exercises the falsy `if (csrf)` branch in download.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: () => Promise.resolve(new Blob(['x'])),
      });

      await apiClient.download('/admin/something', 'file.bin', { method: 'POST' });

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['X-CSRF-Token']).toBeUndefined();
    });
  });
};
