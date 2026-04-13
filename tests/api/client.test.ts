/**
 * API Client Tests
 *
 * Tests for the base HTTP client: request/response handling,
 * retry with exponential backoff, auth token management, and error handling.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Mock logger before importing
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockDownloadBlob = vi.fn();

vi.mock('../../utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

// Mock the refresh module. ADR 0001 / 0002 Phase 4 — client.ts imports
// scheduleRefreshFromHeader and refreshAccessToken from refresh.ts. We
// mock both so client tests can assert the client calls them correctly
// without exercising the real Web Lock / BroadcastChannel paths
// (those have their own tests in tests/api/refresh.test.ts).
const mockScheduleRefreshFromHeader = vi.fn();
const mockRefreshAccessToken = vi.fn();

vi.mock('../../src/api/refresh', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/refresh')>(
    '../../src/api/refresh',
  );
  return {
    ...actual,
    scheduleRefreshFromHeader: (iso: string) => mockScheduleRefreshFromHeader(iso),
    refreshAccessToken: () => mockRefreshAccessToken(),
  };
});

// Mock import.meta.env
vi.stubGlobal('import', { meta: { env: {} } });

// We need to test the module's internals, so we import after mocks
// but the module uses import.meta.env at top level. We'll test via the default export.
import apiClient,{ ApiError } from '../../src/api/client';

describe('API Client', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    mockScheduleRefreshFromHeader.mockReset();
    mockRefreshAccessToken.mockReset();
    // Clear document.cookie so CSRF header reads from a known state.
    if (typeof document !== 'undefined') {
      document.cookie.split(';').forEach((c) => {
        const name = c.split('=')[0]?.trim();
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // ApiError
  // ========================================
  describe('ApiError', () => {
    it('should create an error with status and response', () => {
      const error = new ApiError('Not Found', 404, { detail: 'missing' });
      expect(error.message).toBe('Not Found');
      expect(error.status).toBe(404);
      expect(error.response).toEqual({ detail: 'missing' });
      expect(error.name).toBe('ApiError');
      expect(error).toBeInstanceOf(Error);
    });

    it('should work without response data', () => {
      const error = new ApiError('Server Error', 500);
      expect(error.status).toBe(500);
      expect(error.response).toBeUndefined();
    });
  });

  // ========================================
  // GET Requests
  // ========================================
  describe('GET Requests', () => {
    it('should make a successful GET request', async () => {
      const mockData = { users: [{ id: 1 }] };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData),
      });

      const result = await apiClient.get('/users');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockData);
    });

    it('should build query string from params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await apiClient.get('/users', { limit: 10, offset: 0, active: true });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('limit=10');
      expect(calledUrl).toContain('offset=0');
      expect(calledUrl).toContain('active=true');
    });

    it('should skip undefined and null params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await apiClient.get('/users', { limit: 10, filter: undefined, sort: null });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('limit=10');
      expect(calledUrl).not.toContain('filter');
      expect(calledUrl).not.toContain('sort');
    });

    it('should not append query string when params serialize to empty', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      await apiClient.get('/users', { filter: undefined, sort: null });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toBe('/api/v1/users');
      expect(calledUrl).not.toContain('?');
    });

    // ADR 0001 / 0002 Phase 4: the Authorization header is no longer
    // set by the browser client. See the "Phase 4 — cookie auth + CSRF"
    // describe block at the end of this file for cookie-path assertions.
  });

  // ========================================
  // POST Requests
  // ========================================
  describe('POST Requests', () => {
    it('should send JSON body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1 }),
      });

      const body = { username: 'test', password: 'pass' };
      await apiClient.post('/auth/login', body);

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.method).toBe('POST');
      expect(calledOptions.body).toBe(JSON.stringify(body));
      expect(calledOptions.headers['Content-Type']).toBe('application/json');
    });

    it('should handle POST without body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await apiClient.post('/action');

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.body).toBeUndefined();
    });
  });

  // ========================================
  // PUT / PATCH / DELETE
  // ========================================
  describe('PUT/PATCH/DELETE Requests', () => {
    it('should make PUT request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated: true }),
      });

      await apiClient.put('/resource/1', { name: 'updated' });

      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    });

    it('should make PUT request without body when no data is provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated: true }),
      });

      await apiClient.put('/resource/1');

      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it('should make PATCH request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ patched: true }),
      });

      await apiClient.patch('/resource/1', { field: 'value' });

      expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
    });

    it('should make PATCH request without body when no data is provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ patched: true }),
      });

      await apiClient.patch('/resource/1');

      expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it('should make DELETE request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ deleted: true }),
      });

      await apiClient.delete('/resource/1');

      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('should handle DELETE with body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await apiClient.delete('/resource/batch', { ids: ['1', '2'] });

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.body).toBe(JSON.stringify({ ids: ['1', '2'] }));
    });
  });

  // ========================================
  // 204 No Content
  // ========================================
  describe('204 No Content', () => {
    it('should handle 204 response without parsing body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error('No body')),
      });

      const result = await apiClient.delete('/resource/1');
      expect(result).toEqual({});
    });
  });

  // ========================================
  // Error Handling
  // ========================================
  describe('Error Handling', () => {
    it('should throw ApiError for 4xx responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Validation failed' }),
      });

      await expect(apiClient.get('/bad-request')).rejects.toThrow(ApiError);
      try {
        await apiClient.get('/bad-request');
      } catch (error) {
        expect((error as ApiError).status).toBe(400);
        expect((error as ApiError).message).toBe('Validation failed');
      }
    });

    it('should throw ApiError for 401 Unauthorized', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ message: 'Invalid token' }),
      });

      await expect(apiClient.get('/protected')).rejects.toThrow(ApiError);
    });

    it('should throw ApiError for 404 Not Found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'Resource not found' }),
      });

      await expect(apiClient.get('/missing')).rejects.toThrow('Resource not found');
    });

    it('should use statusText as fallback message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({}),
      });

      try {
        await apiClient.get('/forbidden');
      } catch (error) {
        expect((error as ApiError).message).toContain('403');
      }
    });

    it('should extract message from nested error object when top-level message is absent', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: '',
        json: () => Promise.resolve({
          success: false,
          error: { type: 'RateLimitError', message: 'Too many requests' },
        }),
      });

      try {
        await apiClient.get('/rate-limited', undefined, { enabled: false });
      } catch (error) {
        expect((error as ApiError).message).toBe('Too many requests');
        expect((error as ApiError).status).toBe(429);
      }
    });

    it('should fall back to Unknown error when both message fields and statusText are empty', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: '',
        json: () => Promise.resolve({}),
      });

      try {
        await apiClient.get('/empty-error', undefined, { enabled: false });
      } catch (error) {
        expect((error as ApiError).message).toBe('HTTP 502: Unknown error');
      }
    });
  });

  // ========================================
  // Retry Behavior
  // ========================================
  describe('Retry Behavior', () => {
    it('should retry on 500 server error', async () => {
      // First call: 500, second call: success
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ message: 'Server error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });

      const result = await apiClient.get('/flaky', undefined, {
        maxRetries: 2,
        initialDelayMs: 1, // Fast for testing
      });

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 502 Bad Gateway', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          json: () => Promise.resolve({ message: 'Bad Gateway' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: 'ok' }),
        });

      const result = await apiClient.get('/endpoint', undefined, {
        maxRetries: 1,
        initialDelayMs: 1,
      });

      expect(result).toEqual({ data: 'ok' });
    });

    it('should retry on 429 Too Many Requests', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: () => Promise.resolve({ message: 'Rate limited' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });

      const result = await apiClient.get('/rate-limited', undefined, {
        maxRetries: 1,
        initialDelayMs: 1,
      });

      expect(result).toEqual({ success: true });
    });

    it('should NOT retry on 400 client error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Bad input' }),
      });

      await expect(
        apiClient.get('/bad', undefined, { maxRetries: 3, initialDelayMs: 1 })
      ).rejects.toThrow('Bad input');

      // Should NOT have retried
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on 401 Unauthorized via the exponential-backoff path', async () => {
      // Phase 4: 401 now triggers the refresh interceptor instead of
      // the exponential-backoff retry loop. This test asserts the
      // *backoff* loop does not fire — it should run zero retries and
      // surface the 401 cleanly. Mock the refresh to fail so the
      // interceptor bails out and returns the original 401 without
      // the retry-once Phase 4 path kicking in. The Phase 4 describe
      // block below has dedicated tests for the refresh-then-retry flow.
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ message: 'Invalid token' }),
      });
      mockRefreshAccessToken.mockRejectedValueOnce(new Error('refresh suppressed for backoff test'));

      await expect(
        apiClient.get('/protected', undefined, { maxRetries: 3, initialDelayMs: 1 })
      ).rejects.toThrow('Invalid token');

      // The exponential-backoff retry loop should NOT have fired, and
      // the refresh interceptor's one-shot retry should have been
      // aborted when refresh threw. Net: exactly one fetch call.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on network errors (TypeError)', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ recovered: true }),
        });

      const result = await apiClient.get('/network-flaky', undefined, {
        maxRetries: 1,
        initialDelayMs: 1,
      });

      expect(result).toEqual({ recovered: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry when an ApiError is also a TypeError instance', async () => {
      const originalProtoParent = Object.getPrototypeOf(ApiError.prototype);
      Object.setPrototypeOf(ApiError.prototype, TypeError.prototype);

      try {
        mockFetch
          .mockResolvedValueOnce({
            ok: false,
            status: 418,
            statusText: "I'm a teapot",
            json: () => Promise.resolve({ message: 'teapot' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ recovered: true }),
          });

        const result = await apiClient.get('/teapot', undefined, {
          maxRetries: 1,
          initialDelayMs: 1,
        });

        expect(result).toEqual({ recovered: true });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        Object.setPrototypeOf(ApiError.prototype, originalProtoParent);
      }
    });

    it('should map non-Error thrown values to Unknown error', async () => {
      mockFetch.mockRejectedValue('boom');

      await expect(
        apiClient.get('/unknown-error', undefined, { enabled: false })
      ).rejects.toMatchObject({
        status: 0,
        message: 'Unknown error',
      });
    });

    it('should throw after exhausting all retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ message: 'Down for maintenance' }),
      });

      await expect(
        apiClient.get('/always-down', undefined, {
          maxRetries: 2,
          initialDelayMs: 1,
        })
      ).rejects.toThrow();

      // Initial attempt + 2 retries = 3 calls total
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry when retry is disabled', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Error' }),
      });

      await expect(
        apiClient.get('/no-retry', undefined, { enabled: false })
      ).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw fallback retries-exhausted message when maxRetries is negative', async () => {
      await expect(
        apiClient.get('/no-attempt', undefined, { maxRetries: -1 })
      ).rejects.toMatchObject({
        status: 0,
        message: 'Request failed after all retries',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Upload
  // ========================================
  describe('Upload', () => {
    it('should send FormData without Content-Type header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ uploaded: true }),
      });

      const formData = new FormData();
      formData.append('file', new Blob(['test']), 'test.txt');

      await apiClient.upload('/upload', formData);

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.method).toBe('POST');
      expect(calledOptions.body).toBe(formData);
      // Should NOT set Content-Type (browser sets it with boundary)
      expect(calledOptions.headers['Content-Type']).toBeUndefined();
      // Phase 4: credentials: 'include' replaces the Bearer header for
      // browser callers. See the "Phase 4" describe block.
      expect(calledOptions.credentials).toBe('include');
    });

    it('should throw ApiError for failed upload responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });

      const formData = new FormData();
      formData.append('file', new Blob(['test']), 'test.txt');

      await expect(
        apiClient.upload('/upload', formData, { enabled: false })
      ).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  // ========================================
  // Blob / Download
  // ========================================
  describe('Blob / Download', () => {
    it('should fetch blob with params, method, and credentials:include', async () => {
      const blob = new Blob(['file-bytes'], { type: 'application/octet-stream' });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(blob),
      });

      const result = await apiClient.fetchBlob('/exports/archive', {
        method: 'POST',
        params: { from: '2026-01-01', to: '2026-01-31' },
      });

      expect(result).toBe(blob);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('/exports/archive?');
      expect(mockFetch.mock.calls[0][0]).toContain('from=2026-01-01');
      expect(mockFetch.mock.calls[0][0]).toContain('to=2026-01-31');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      // Phase 4: browser auth is via HttpOnly cookies, not Bearer header.
      expect(mockFetch.mock.calls[0][1].credentials).toBe('include');
    });

    it('should throw ApiError with HTTP fallback when fetchBlob error body is not JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: () => Promise.reject(new Error('not-json')),
      });

      await expect(apiClient.fetchBlob('/exports/archive')).rejects.toMatchObject({
        status: 502,
        message: 'HTTP 502',
      });
    });

    it('should use status fallback when fetchBlob error JSON has no message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });

      await expect(apiClient.fetchBlob('/exports/archive')).rejects.toMatchObject({
        status: 500,
        message: 'HTTP 500: Internal Server Error',
      });
    });

    it('should resolve filename from Content-Disposition when downloading', async () => {
      const blob = new Blob(['backup-bytes'], { type: 'application/gzip' });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) =>
            header === 'Content-Disposition' ? 'attachment; filename=\"backup-2026.tar.gz\"' : null,
        },
        blob: () => Promise.resolve(blob),
      });

      await apiClient.download('/admin/backup', 'fallback.tar.gz', {
        params: { walletId: 'w1' },
      });

      expect(mockFetch.mock.calls[0][0]).toContain('/admin/backup?walletId=w1');
      // Phase 4: cookie-based auth via credentials:'include'.
      expect(mockFetch.mock.calls[0][1].credentials).toBe('include');
      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, 'backup-2026.tar.gz');
    });

    it('should use default download filename when none is provided', async () => {
      const blob = new Blob(['raw-bytes']);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: () => Promise.resolve(blob),
      });

      await apiClient.download('/reports/daily');

      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, 'download');
    });

    it('should keep provided filename when content disposition has no filename', async () => {
      const blob = new Blob(['raw-bytes']);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) => (header === 'Content-Disposition' ? 'attachment' : null),
        },
        blob: () => Promise.resolve(blob),
      });

      await apiClient.download('/reports/daily', 'fallback.csv');

      expect(mockDownloadBlob).toHaveBeenCalledWith(blob, 'fallback.csv');
    });

    it('should throw ApiError on download failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'File not found' }),
      });

      await expect(apiClient.download('/admin/backup/missing')).rejects.toMatchObject({
        status: 404,
        message: 'File not found',
      });
    });

    it('should throw HTTP fallback when download error body is not JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.reject(new Error('not-json')),
      });

      await expect(apiClient.download('/admin/backup/missing')).rejects.toMatchObject({
        status: 503,
        message: 'HTTP 503',
      });
    });

    it('should use status fallback when download error JSON has no message', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({}),
      });

      await expect(apiClient.download('/admin/backup/missing')).rejects.toMatchObject({
        status: 400,
        message: 'HTTP 400: Bad Request',
      });
    });
  });

  describe('Module initialization', () => {
    it('should honor VITE_API_URL when set at import time', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_API_URL', 'https://api.example.test/v1');

      const mod = await import('../../src/api/client');

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
      const { RefreshFailedError } = await import('../../src/api/refresh');
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
});
