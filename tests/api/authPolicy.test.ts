import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CSRF_HEADER_NAME,
  REFRESH_ON_401_EXEMPT_ENDPOINTS,
  attachCsrfHeader,
  isRefreshOn401ExemptEndpoint,
  normalizeAuthEndpoint,
  readCookieValue,
  readCsrfCookieValue,
  requiresCsrfHeader,
  shouldAttemptRefreshAfterUnauthorized,
} from '../../src/api/authPolicy';

describe('browser auth policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('CSRF cookie and header rules', () => {
    it('reads and decodes the sanctuary_csrf cookie from a raw cookie header', () => {
      expect(readCsrfCookieValue('other=value; sanctuary_csrf=encoded%20value; x=1'))
        .toBe('encoded value');
    });

    it('preserves equals signs inside cookie values', () => {
      expect(readCookieValue('sanctuary_csrf=abc=def%3Dghi', 'sanctuary_csrf'))
        .toBe('abc=def=ghi');
    });

    it('returns the raw cookie value when percent decoding fails', () => {
      expect(readCsrfCookieValue('sanctuary_csrf=bad%ZZvalue'))
        .toBe('bad%ZZvalue');
    });

    it('treats missing document cookies as an empty cookie header', () => {
      vi.stubGlobal('document', undefined);

      expect(readCsrfCookieValue()).toBeNull();
    });

    it('requires CSRF only for state-changing methods', () => {
      expect(requiresCsrfHeader('GET')).toBe(false);
      expect(requiresCsrfHeader('head')).toBe(false);
      expect(requiresCsrfHeader('OPTIONS')).toBe(false);
      expect(requiresCsrfHeader('post')).toBe(true);
      expect(requiresCsrfHeader('PUT')).toBe(true);
      expect(requiresCsrfHeader('PATCH')).toBe(true);
      expect(requiresCsrfHeader('DELETE')).toBe(true);
    });

    it('injects the CSRF header for state-changing requests without overriding caller headers', () => {
      const headers: Record<string, string> = {};
      attachCsrfHeader(headers, 'POST', 'sanctuary_csrf=csrf-token');
      expect(headers[CSRF_HEADER_NAME]).toBe('csrf-token');

      attachCsrfHeader(headers, 'POST', 'sanctuary_csrf=different-token');
      expect(headers[CSRF_HEADER_NAME]).toBe('csrf-token');
    });

    it('does not inject CSRF for safe methods or missing cookies', () => {
      const getHeaders: Record<string, string> = {};
      attachCsrfHeader(getHeaders, 'GET', 'sanctuary_csrf=csrf-token');
      expect(getHeaders[CSRF_HEADER_NAME]).toBeUndefined();

      const postHeaders: Record<string, string> = {};
      attachCsrfHeader(postHeaders, 'POST', 'other=value');
      expect(postHeaders[CSRF_HEADER_NAME]).toBeUndefined();
    });
  });

  describe('401 refresh eligibility', () => {
    it('strips query strings and hashes before matching auth endpoints', () => {
      expect(normalizeAuthEndpoint('/auth/refresh?next=/wallets')).toBe('/auth/refresh');
      expect(normalizeAuthEndpoint('/auth/login#form')).toBe('/auth/login');
      expect(normalizeAuthEndpoint('/wallets?limit=10#top')).toBe('/wallets');
    });

    it('keeps credential-presentation endpoints exempt from refresh-on-401', () => {
      for (const endpoint of REFRESH_ON_401_EXEMPT_ENDPOINTS) {
        expect(isRefreshOn401ExemptEndpoint(endpoint)).toBe(true);
        expect(isRefreshOn401ExemptEndpoint(`${endpoint}?query=1`)).toBe(true);
      }
    });

    it('keeps session-continuity endpoints eligible for refresh-on-401', () => {
      expect(isRefreshOn401ExemptEndpoint('/auth/me')).toBe(false);
      expect(isRefreshOn401ExemptEndpoint('/auth/logout')).toBe(false);
      expect(isRefreshOn401ExemptEndpoint('/auth/logout-all')).toBe(false);
      expect(isRefreshOn401ExemptEndpoint('/wallets')).toBe(false);
    });

    it('attempts refresh only for first-pass 401 responses on eligible endpoints', () => {
      expect(shouldAttemptRefreshAfterUnauthorized({
        endpoint: '/wallets',
        status: 401,
        isRefreshRetry: false,
      })).toBe(true);

      expect(shouldAttemptRefreshAfterUnauthorized({
        endpoint: '/auth/me',
        status: 401,
        isRefreshRetry: false,
      })).toBe(true);

      expect(shouldAttemptRefreshAfterUnauthorized({
        endpoint: '/wallets',
        status: 500,
        isRefreshRetry: false,
      })).toBe(false);

      expect(shouldAttemptRefreshAfterUnauthorized({
        endpoint: '/wallets',
        status: 401,
        isRefreshRetry: true,
      })).toBe(false);

      expect(shouldAttemptRefreshAfterUnauthorized({
        endpoint: '/auth/refresh',
        status: 401,
        isRefreshRetry: false,
      })).toBe(false);
    });
  });
});
