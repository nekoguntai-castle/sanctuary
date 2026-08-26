import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, apiClient, mockFetch, mockRefreshAccessToken } from './clientTestHarness';

const errorResponse = (status: number, message = 'request failed') => ({
  ok: false,
  status,
  statusText: message,
  json: () => Promise.resolve({ message }),
});

const successResponse = (body: unknown = { success: true }) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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
      // 401 triggers the refresh interceptor instead of the
      // exponential-backoff retry loop. This test asserts the
      // *backoff* loop does not fire — it should run zero retries and
      // surface the 401 cleanly. Mock the refresh to fail so the
      // interceptor bails out and returns the original 401 without
      // the retry-once refresh path kicking in. The cookie-auth contract
      // block has dedicated tests for the refresh-then-retry flow.
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

    it('should reject an already-aborted GET before fetching', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        apiClient.get('/transaction', undefined, undefined, {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should abort during GET backoff without another fetch', async () => {
      const controller = new AbortController();
      vi.spyOn(controller.signal, 'reason', 'get').mockReturnValue(undefined);
      const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      mockFetch.mockReturnValueOnce(
        Promise.reject(new TypeError('temporary network failure')),
      );

      const request = apiClient.get(
        '/transaction',
        undefined,
        { initialDelayMs: 1_000 },
        { signal: controller.signal },
      );
      await vi.waitFor(() => expect(timeoutSpy).toHaveBeenCalled());
      controller.abort();

      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should compose caller cancellation with the GET request timeout', async () => {
      const caller = new AbortController();
      const timeout = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
      let requestSignal: AbortSignal | null | undefined;
      mockFetch.mockImplementationOnce((_url, init) => {
        requestSignal = init?.signal;
        return new Promise((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => {
            reject(requestSignal?.reason);
          });
        });
      });

      const request = apiClient.get(
        '/transaction',
        undefined,
        { maxRetries: 0 },
        { signal: caller.signal, timeoutMs: 25 },
      );
      await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
      expect(requestSignal).not.toBe(caller.signal);
      timeout.abort(new DOMException('request timed out', 'TimeoutError'));

      await expect(request).rejects.toThrow('request timed out');
      expect(requestSignal?.aborted).toBe(true);
      expect(caller.signal.aborted).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should propagate caller cancellation through the composed fetch signal', async () => {
      const caller = new AbortController();
      let requestSignal: AbortSignal | null | undefined;
      mockFetch.mockImplementationOnce((_url, init) => {
        requestSignal = init?.signal;
        return new Promise((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => {
            reject(requestSignal?.reason);
          });
        });
      });

      const request = apiClient.get(
        '/transaction',
        undefined,
        { maxRetries: 0 },
        { signal: caller.signal },
      );
      await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
      caller.abort();

      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      expect(requestSignal?.aborted).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
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

    it('should retry a GET whose deferred transport result becomes ambiguous', async () => {
      const firstAttempt = createDeferred<Response>();
      mockFetch
        .mockReturnValueOnce(firstAttempt.promise)
        .mockResolvedValueOnce(successResponse({ recovered: true }));

      const request = apiClient.get<{ recovered: boolean }>(
        '/deferred-read',
        undefined,
        { maxRetries: 1, initialDelayMs: 1 },
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);

      firstAttempt.reject(new TypeError('connection closed after response'));

      await expect(request).resolves.toEqual({ recovered: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['POST', () => apiClient.post('/mutation', { value: 1 })],
      ['PUT', () => apiClient.put('/mutation', { value: 1 })],
      ['PATCH', () => apiClient.patch('/mutation', { value: 1 })],
      ['DELETE', () => apiClient.delete('/mutation', { value: 1 })],
    ])('should send %s only once after an ambiguous network failure', async (_method, request) => {
      const firstAttempt = createDeferred<Response>();
      mockFetch.mockReturnValue(firstAttempt.promise);
      const result = request();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      firstAttempt.reject(new TypeError('connection closed after commit'));

      await expect(result).rejects.toMatchObject({
        status: 0,
        message: 'connection closed after commit',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['POST', () => apiClient.post('/mutation', { value: 1 })],
      ['PUT', () => apiClient.put('/mutation', { value: 1 })],
      ['PATCH', () => apiClient.patch('/mutation', { value: 1 })],
      ['DELETE', () => apiClient.delete('/mutation', { value: 1 })],
    ])('should send %s only once after a retryable HTTP failure', async (_method, request) => {
      mockFetch.mockResolvedValue(errorResponse(503, 'committed but response lost'));

      await expect(request()).rejects.toMatchObject({
        status: 503,
        message: 'committed but response lost',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should share the GET transport retry budget across auth refresh', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(401, 'Unauthorized'))
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(successResponse({ recovered: true }));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      const result = await apiClient.get<{ recovered: boolean }>(
        '/budgeted-read',
        undefined,
        { maxRetries: 3, initialDelayMs: 1 },
      );

      expect(result).toEqual({ recovered: true });
      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should not reset an exhausted GET retry budget after auth refresh', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(401, 'Unauthorized'))
        .mockResolvedValueOnce(errorResponse(503, 'replay unavailable'));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      await expect(
        apiClient.get('/budget-boundary', undefined, {
          maxRetries: 3,
          initialDelayMs: 1,
        }),
      ).rejects.toMatchObject({
        status: 503,
        message: 'replay unavailable',
      });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('should keep mutation auth replay separate from transport retry', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(401, 'Unauthorized'))
        .mockResolvedValueOnce(errorResponse(503, 'replay unavailable'));
      mockRefreshAccessToken.mockResolvedValue(undefined);

      await expect(
        apiClient.post('/mutation', { value: 1 }),
      ).rejects.toMatchObject({
        status: 503,
        message: 'replay unavailable',
      });

      expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should have no API wrapper using the retired mutation retry option', () => {
      const apiDirectory = join(process.cwd(), 'src/api');
      const apiSource = readdirSync(apiDirectory, { recursive: true })
        .filter((entry): entry is string =>
          typeof entry === 'string' && entry.endsWith('.ts')
        )
        .map((entry) => readFileSync(join(apiDirectory, entry), 'utf8'))
        .join('\n');

      expect(apiSource).not.toMatch(/\bretry\s*:/);
    });
  });

  // ========================================
  // Upload
  // ========================================
};
