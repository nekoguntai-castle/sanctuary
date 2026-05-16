import { describe, expect, it, vi } from 'vitest';

export const registerApiClientInitializationContracts = () => {
  describe('Module initialization', () => {
    it('should honor VITE_API_URL when set at import time', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_API_URL', 'https://api.example.test/v1');

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const mod = await import('../../../src/api/client');
      await mod.default.get('/status', undefined, { enabled: false });

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/status');

      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
    });
  });

  // =========================================================================
  // Cookie auth + CSRF + X-Access-Expires-At + 401 interceptor
  // =========================================================================
  //
  // ADR 0001 / 0002 client behavior:
  //   - Every request carries `credentials: 'include'` so the browser
  //     attaches sanctuary_access / sanctuary_refresh / sanctuary_csrf
  //     cookies automatically.
  //   - State-changing requests (POST/PUT/PATCH/DELETE) read the
  //     sanctuary_csrf cookie and echo it in the X-CSRF-Token header.
  //   - The X-Access-Expires-At response header is parsed and forwarded
  //     to refresh.ts's scheduleRefreshFromHeader.
  //   - A 401 response on a non-exempt endpoint calls refreshAccessToken
  //     and retries the request once.
  //
  // The refresh module is mocked at the top of this file so these tests
  // can assert the client's behavior without exercising the real Web
  // Lock / BroadcastChannel machinery (those have their own tests).
};
