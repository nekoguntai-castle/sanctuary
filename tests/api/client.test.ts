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

// Mock import.meta.env
vi.stubGlobal('import', { meta: { env: {} } });

// We need to test the module's internals, so we import after mocks
// but the module uses import.meta.env at top level. We'll test via the default export.
import apiClient,{ ApiClient, ApiError } from '../../src/api/client';

describe('API Client', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
    // Reset token
    apiClient.setToken(null);
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
  // Token Management
  // ========================================
  describe('Token Management', () => {
    it('should set and get token', () => {
      apiClient.setToken('test-token');
      expect(apiClient.getToken()).toBe('test-token');
      expect(apiClient.isAuthenticated()).toBe(true);
    });

    it('should report authenticated when token is set', () => {
      apiClient.setToken('some-token');
      expect(apiClient.isAuthenticated()).toBe(true);
    });

    it('should clear token on null', () => {
      apiClient.setToken('temp');
      apiClient.setToken(null);
      expect(apiClient.getToken()).toBeNull();
      expect(apiClient.isAuthenticated()).toBe(false);
    });

    it('should store tokens in sessionStorage by default and clear legacy localStorage', () => {
      const removeItemMock = vi.mocked(globalThis.localStorage.removeItem);
      removeItemMock.mockClear();

      apiClient.setToken('round-trip');

      expect(apiClient.getToken()).toBe('round-trip');
      expect(globalThis.sessionStorage.getItem('sanctuary_token')).toBe('round-trip');
      expect(removeItemMock).toHaveBeenCalledWith('sanctuary_token');

      apiClient.setToken(null);
      expect(apiClient.getToken()).toBeNull();
      expect(globalThis.sessionStorage.getItem('sanctuary_token')).toBeNull();
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

    it('should include auth token in headers', async () => {
      apiClient.setToken('my-token');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await apiClient.get('/protected');

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['Authorization']).toBe('Bearer my-token');
    });

    it('should not include auth header when no token', async () => {
      apiClient.setToken(null);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await apiClient.get('/public');

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.headers['Authorization']).toBeUndefined();
    });
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

    it('should NOT retry on 401 Unauthorized', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ message: 'Invalid token' }),
      });

      await expect(
        apiClient.get('/protected', undefined, { maxRetries: 3, initialDelayMs: 1 })
      ).rejects.toThrow('Invalid token');

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

      apiClient.setToken('upload-token');
      await apiClient.upload('/upload', formData);

      const calledOptions = mockFetch.mock.calls[0][1];
      expect(calledOptions.method).toBe('POST');
      expect(calledOptions.body).toBe(formData);
      // Should NOT set Content-Type (browser sets it with boundary)
      expect(calledOptions.headers['Content-Type']).toBeUndefined();
      expect(calledOptions.headers['Authorization']).toBe('Bearer upload-token');
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
    it('should fetch blob with params, method, and auth header', async () => {
      const blob = new Blob(['file-bytes'], { type: 'application/octet-stream' });
      apiClient.setToken('blob-token');

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
      expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer blob-token');
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
      apiClient.setToken('download-token');

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
      expect(mockFetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer download-token');
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

    it('should migrate a legacy localStorage token into sessionStorage by default', async () => {
      vi.mocked(globalThis.localStorage.getItem).mockReturnValueOnce('legacy-token');
      const removeItemMock = vi.mocked(globalThis.localStorage.removeItem);
      removeItemMock.mockClear();

      const client = new ApiClient();

      expect(client.getToken()).toBe('legacy-token');
      expect(globalThis.sessionStorage.getItem('sanctuary_token')).toBe('legacy-token');
      expect(removeItemMock).toHaveBeenCalledWith('sanctuary_token');
    });

    it('should initialize from the default sessionStorage token when present', () => {
      globalThis.sessionStorage.setItem('sanctuary_token', 'stored-session-token');

      const client = new ApiClient();

      expect(client.getToken()).toBe('stored-session-token');
    });

    it('should support memory-only token storage when configured', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_AUTH_TOKEN_STORAGE', 'memory');

      const mod = await import('../../src/api/client');
      mod.default.setToken('memory-token');

      expect(mod.default.getToken()).toBe('memory-token');
      expect(globalThis.sessionStorage.getItem('sanctuary_token')).toBeNull();
      expect(globalThis.localStorage.getItem('sanctuary_token')).toBeNull();

      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('should use localStorage only when legacy local mode is configured', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_AUTH_TOKEN_STORAGE', 'local');
      globalThis.sessionStorage.setItem('sanctuary_token', 'stale-session-token');
      const setItemMock = vi.mocked(globalThis.localStorage.setItem);
      setItemMock.mockClear();

      const mod = await import('../../src/api/client');
      mod.default.setToken('local-token');

      expect(mod.default.getToken()).toBe('local-token');
      expect(setItemMock).toHaveBeenCalledWith('sanctuary_token', 'local-token');
      expect(globalThis.sessionStorage.getItem('sanctuary_token')).toBeNull();

      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('should default unknown storage mode values to sessionStorage', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_AUTH_TOKEN_STORAGE', 'bogus');

      const mod = await import('../../src/api/client');
      mod.default.setToken('session-token');

      expect(mod.default.getToken()).toBe('session-token');
      expect(globalThis.sessionStorage.getItem('sanctuary_token')).toBe('session-token');
      expect(globalThis.localStorage.removeItem).toHaveBeenCalledWith('sanctuary_token');

      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('should fall back to memory when sessionStorage is unavailable', () => {
      const originalSessionStorage = globalThis.sessionStorage;
      const blockedSessionStorage = {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {
          throw new DOMException('storage blocked');
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(() => null),
        length: 0,
      } as Storage;
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: blockedSessionStorage,
      });

      try {
        const client = new ApiClient();
        client.setToken('fallback-token');

        const secondClient = new ApiClient();
        expect(secondClient.getToken()).toBe('fallback-token');
      } finally {
        Object.defineProperty(globalThis, 'sessionStorage', {
          configurable: true,
          value: originalSessionStorage,
        });
      }
    });
  });
});
