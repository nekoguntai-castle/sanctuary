import { describe, expect, it } from 'vitest';
import {
  isDockerProxyAvailable,
  mockFetch,
} from './dockerTestHarness';

export function registerDockerStatusContracts(): void {
  describe('isDockerProxyAvailable', () => {
    it('should return true when Docker proxy responds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const available = await isDockerProxyAvailable();

      expect(available).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/containers/json?limit=1'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false when Docker proxy is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const available = await isDockerProxyAvailable();

      expect(available).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const available = await isDockerProxyAvailable();

      expect(available).toBe(false);
    });
  });

}
