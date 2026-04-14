import { describe, expect, it } from 'vitest';
import {
  getOllamaStatus,
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

  describe('getOllamaStatus', () => {
    it('should return running status when ollama container is running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
            Status: 'Up 5 minutes',
          },
        ],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(true);
      expect(status.running).toBe(true);
      expect(status.status).toBe('running');
      expect(status.containerId).toBe('abc123');
    });

    it('should return stopped status when ollama container exists but stopped', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'def456',
            Names: ['/myproject-ollama-1'],
            State: 'exited',
            Status: 'Exited (0) 10 minutes ago',
          },
        ],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(true);
      expect(status.running).toBe(false);
      expect(status.status).toBe('exited');
    });

    it('should return not_created when ollama container does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'other123',
            Names: ['/sanctuary-backend-1'],
            State: 'running',
          },
        ],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(false);
      expect(status.running).toBe(false);
      expect(status.status).toBe('not_created');
    });

    it('should handle empty container list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(false);
      expect(status.status).toBe('not_created');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(false);
      expect(status.status).toBe('not_created');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const status = await getOllamaStatus();

      // findOllamaContainer catches its own errors and returns null
      // getOllamaStatus then returns 'not_created' for null container
      expect(status.exists).toBe(false);
      expect(status.status).toBe('not_created');
    });

    it('should return error status when state access throws unexpectedly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'bad123',
            Names: ['/sanctuary-ollama-1'],
            get State() {
              throw new Error('State getter failed');
            },
          },
        ],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(false);
      expect(status.running).toBe(false);
      expect(status.status).toBe('error');
    });
  });
}
