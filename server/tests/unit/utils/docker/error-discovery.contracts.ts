import { describe, expect, it } from 'vitest';
import {
  createTorContainer,
  discoverProjectName,
  mockFetch,
  startTor,
} from './dockerTestHarness';

function mockContainerList(containers: unknown[]): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => containers,
  });
}

function composeLabels(project: string, service?: string): Record<string, string> {
  return {
    'com.docker.compose.project': project,
    ...(service ? { 'com.docker.compose.service': service } : {}),
  };
}

function container(
  name: string | string[],
  labels?: Record<string, string>
): Record<string, unknown> {
  const names = Array.isArray(name) ? name : [name];
  return {
    Id: names.join(':'),
    Names: names,
    Labels: labels,
    State: 'running',
    Status: 'Up',
  };
}

export function registerDockerErrorDiscoveryContracts(): void {
  describe('error handling', () => {
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

  });

  describe('discoverProjectName', () => {
    it('should prefer Docker Compose project labels over legacy container names', async () => {
      mockContainerList([
        container('/legacy-backend-1', composeLabels('labeledsanctuary', 'backend')),
      ]);

      const result = await discoverProjectName();

      expect(result).toBe('labeledsanctuary');
    });

    it('should use frontend Compose service labels for project discovery', async () => {
      mockContainerList([
        container('/ignored-frontend-1', composeLabels('frontendproject', 'frontend')),
      ]);

      const result = await discoverProjectName();

      expect(result).toBe('frontendproject');
    });

    it('should ignore non-application Compose service labels and fall back to legacy names', async () => {
      mockContainerList([
        container('/unrelated-db-1', composeLabels('databaseproject', 'db')),
        container('/legacyproject-backend-1'),
      ]);

      const result = await discoverProjectName();

      expect(result).toBe('legacyproject');
    });

    it('should fall back to frontend container names when Compose labels are missing', async () => {
      mockContainerList([
        container('/nameproject-frontend-1'),
      ]);

      const result = await discoverProjectName();

      expect(result).toBe('nameproject');
    });

    it('should return default project name when labels and names are not usable', async () => {
      mockContainerList([
        container('/worker-1', composeLabels('   ', 'backend')),
        container([], composeLabels('emptyproject')),
      ]);

      const result = await discoverProjectName();

      expect(result).toBe('sanctuary');
    });

    it('should return default project name when Docker API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connection refused'));

      const result = await discoverProjectName();

      expect(result).toBe('sanctuary');
    });
  });
}
