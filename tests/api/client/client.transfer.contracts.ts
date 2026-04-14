import { describe, expect, it } from 'vitest';

import { apiClient, mockDownloadBlob, mockFetch } from './clientTestHarness';

export const registerApiClientTransferContracts = () => {
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
};
