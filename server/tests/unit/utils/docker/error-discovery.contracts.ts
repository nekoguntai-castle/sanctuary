import { describe, expect, it } from 'vitest';
import {
  createOllamaContainer,
  createTorContainer,
  discoverProjectName,
  mockFetch,
  startOllama,
  startTor,
  stopOllama,
} from './dockerTestHarness';

export function registerDockerErrorDiscoveryContracts(): void {
  describe('error handling', () => {
    it('should handle network errors in createOllamaContainer', async () => {
      // First call (getOllamaStatus -> findOllamaContainer) - returns not_created (error caught internally)
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));
      // Second call (pull image) - this one throws and is caught by outer try-catch
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

      const result = await createOllamaContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Network unreachable');
    });

    it('should handle network errors in stopOllama', async () => {
      // When findOllamaContainer catches network error, it returns null
      // getOllamaStatus returns { exists: false }, so stopOllama returns success
      // because "container doesn't exist" is considered successful for stop
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await stopOllama();

      // This is actually success: true because the code treats "can't find container" as "doesn't exist"
      expect(result.success).toBe(true);
      expect(result.message).toContain('does not exist');
    });

    it('should handle network errors in startTor', async () => {
      // When findTorContainer catches network error, it returns null
      // getTorStatus returns { exists: false }, so startTor calls createTorContainer
      // First call (getTorStatus -> findTorContainer) - error caught internally
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));
      // Second call in createTorContainer (getTorStatus again) - error caught internally
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));
      // Third call (pull image) - this one throws and is caught by outer try-catch
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const result = await startTor();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Timeout');
    });

    it('should handle network errors in createTorContainer', async () => {
      // First call (getTorStatus -> findTorContainer) - error caught internally
      mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));
      // Second call (pull image) - this one throws and is caught by outer try-catch
      mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('DNS lookup failed');
    });

    it('should handle network errors in startOllama start call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'ollama123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });
      mockFetch.mockRejectedValueOnce(new Error('start refused'));

      const result = await startOllama();

      expect(result.success).toBe(false);
      expect(result.message).toContain('start refused');
    });

    it('should handle network errors in stopOllama stop call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'ollama123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });
      mockFetch.mockRejectedValueOnce(new Error('stop refused'));

      const result = await stopOllama();

      expect(result.success).toBe(false);
      expect(result.message).toContain('stop refused');
    });
  });

  describe('discoverProjectName', () => {
    it('should return default project name when Docker API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connection refused'));

      const result = await discoverProjectName();

      expect(result).toBe('sanctuary');
    });
  });
}
