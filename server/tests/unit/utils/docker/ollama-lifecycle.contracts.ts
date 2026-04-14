import { describe, expect, it } from 'vitest';
import {
  createOllamaContainer,
  mockFetch,
  startOllama,
  stopOllama,
} from './dockerTestHarness';

export function registerDockerOllamaLifecycleContracts(): void {
  describe('startOllama', () => {
    it('should return success when already running', async () => {
      // Mock getOllamaStatus -> running
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      const result = await startOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('already running');
    });

    it('should start stopped container', async () => {
      // Mock getOllamaStatus -> stopped
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      // Mock start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await startOllama();

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should create container if does not exist', async () => {
      // Mock getOllamaStatus -> not exists
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // createOllamaContainer will be called next
      // Mock its status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Pulling...',
      });

      // Mock list containers for project name
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'newcontainer123' }),
      });

      // Mock start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await startOllama();

      expect(result.success).toBe(true);
    });

    it('should handle start failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => 'Container start failed',
      });

      const result = await startOllama();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed');
    });
  });

  describe('stopOllama', () => {
    it('should stop running container', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await stopOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('stopped successfully');
    });

    it('should return success if already stopped', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      const result = await stopOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('already stopped');
    });

    it('should return success if container does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await stopOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('does not exist');
    });

    it('should handle stop failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => 'Cannot stop container',
      });

      const result = await stopOllama();

      expect(result.success).toBe(false);
    });
  });

  describe('createOllamaContainer', () => {
    it('should return success if already running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
      expect(result.message).toContain('already running');
    });

    it('should start existing stopped container', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      // startOllama will be called
      // getOllamaStatus again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      // Start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
    });

    it('should handle image pull failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Cannot pull image',
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('pull');
    });

    it('should use project name from existing containers', async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Done',
      });

      // List containers - includes existing sanctuary containers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'backend123',
            Names: ['/myapp-backend-1'],
            State: 'running',
          },
        ],
      });

      // Create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'newollama123' }),
      });

      // Start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
      // Verify create was called with project name
      const createCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('containers/create')
      );
      expect(createCall[0]).toContain('myapp-ollama-1');
    });

    it('should detect project name from frontend container when creating ollama', async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Done',
      });

      // List containers - frontend name path
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'frontend-123',
            Names: ['/frontproj-frontend-1'],
            State: 'running',
          },
        ],
      });

      // Create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'newollama-frontend' }),
      });

      // Start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
      const createCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('containers/create')
      );
      expect(createCall[0]).toContain('frontproj-ollama-1');
    });

    it('should fall back to default project when backend/frontend name cannot be parsed for ollama', async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Done',
      });

      // Name matches backend/frontend includes check but fails extraction regex
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'invalid-name',
            Names: ['/-backend-1'],
            State: 'running',
          },
        ],
      });

      // Create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'newollama-fallback' }),
      });

      // Start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
      const createCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('containers/create')
      );
      expect(createCall[0]).toContain('sanctuary-ollama-1');
    });

    it('should handle container creation failure', async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Done',
      });

      // List containers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Create container fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'create failed',
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to create Ollama container');
    });

    it('should handle container start failure after creation', async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Done',
      });

      // List containers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'ollama-new' }),
      });

      // Start fails
      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => 'start failed',
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('failed to start');
    });
  });
}
