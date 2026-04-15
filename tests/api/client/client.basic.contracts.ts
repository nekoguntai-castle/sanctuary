import { describe, expect, it } from 'vitest';

import { ApiError, apiClient, mockFetch } from './clientTestHarness';

export const registerApiClientBasicContracts = () => {
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
        expect((error as InstanceType<typeof ApiError>).status).toBe(400);
        expect((error as InstanceType<typeof ApiError>).message).toBe('Validation failed');
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
        expect((error as InstanceType<typeof ApiError>).message).toContain('403');
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
        expect((error as InstanceType<typeof ApiError>).message).toBe('Too many requests');
        expect((error as InstanceType<typeof ApiError>).status).toBe(429);
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
        expect((error as InstanceType<typeof ApiError>).message).toBe('HTTP 502: Unknown error');
      }
    });
  });

  // ========================================
  // Retry Behavior
  // ========================================
};
