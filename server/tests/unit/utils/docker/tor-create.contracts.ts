import { describe, expect, it } from 'vitest';
import {
  createTorContainer,
  mockFetch,
} from './dockerTestHarness';

export function registerDockerTorCreateContracts(): void {
    describe('createTorContainer', () => {
      it('should return success if already running', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'running',
            },
          ],
        });

        const result = await createTorContainer();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already running');
      });

      it('should start existing tor container when it exists but is stopped', async () => {
        // Initial status check (exists but not running)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor-existing',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });
        // startTor() internal status check (exists but not running)
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor-existing',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });
        // start call
        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await createTorContainer();

        expect(result.success).toBe(true);
        expect(result.message).toContain('started successfully');
      });

      it('should create new container', async () => {
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
          json: async () => ({ Id: 'newtor123' }),
        });

        // Start container
        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await createTorContainer();

        expect(result.success).toBe(true);
        expect(result.message).toContain('created and started');
      });

      it('should handle tor image pull failure', async () => {
        // Status check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

        // Pull image fails
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'cannot pull tor image',
        });

        const result = await createTorContainer();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to pull Tor image');
      });

    it('should use project name from existing frontend container', async () => {
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

        // Existing frontend container
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'frontend1',
              Names: ['/myproj-frontend-1'],
              State: 'running',
            },
          ],
        });

        // Create
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Id: 'tor-new' }),
        });

        // Start
        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await createTorContainer();

        expect(result.success).toBe(true);
        const createCall = mockFetch.mock.calls.find(
          call => typeof call[0] === 'string' && call[0].includes('containers/create')
      );
      expect(createCall[0]).toContain('myproj-tor');
    });

    it('should fall back to default project when backend/frontend name cannot be parsed for tor', async () => {
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

      // Name matches includes check but fails extraction regex
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

      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'tor-fallback' }),
      });

      // Start
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createTorContainer();

      expect(result.success).toBe(true);
      const createCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('containers/create')
      );
      expect(createCall[0]).toContain('sanctuary-tor');
    });

    it('should handle tor container create failure', async () => {
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

        // Create fails
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'create tor failed',
        });

        const result = await createTorContainer();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to create Tor container');
      });

      it('should handle tor container start failure after creation', async () => {
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

        // Create
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Id: 'tor-created' }),
        });

        // Start fails
        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => 'tor start failed',
        });

        const result = await createTorContainer();

        expect(result.success).toBe(false);
        expect(result.message).toContain('failed to start');
      });
    });
}
