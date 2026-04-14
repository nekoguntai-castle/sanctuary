import { describe, expect, it } from 'vitest';

import { ApiError, apiClient, mockFetch, mockRefreshAccessToken } from './clientTestHarness';

export const registerApiClientRetryContracts = () => {
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
};
