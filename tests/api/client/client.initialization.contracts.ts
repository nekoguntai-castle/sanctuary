import { describe, expect, it, vi } from 'vitest';

export const registerApiClientInitializationContracts = () => {
  describe('Module initialization', () => {
    it('should honor VITE_API_URL when set at import time', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_API_URL', 'https://api.example.test/v1');

      const mod = await import('../../../src/api/client');

      expect(mod.API_BASE_URL).toBe('https://api.example.test/v1');

      vi.unstubAllEnvs();
      vi.resetModules();
    });
  });

  // =========================================================================
  // Phase 4 — cookie auth + CSRF + X-Access-Expires-At + 401 interceptor
  // =========================================================================
  //
  // ADR 0001 / 0002 Phase 4 changes to the client:
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
