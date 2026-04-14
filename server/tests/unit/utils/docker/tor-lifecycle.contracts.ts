import { describe, expect, it } from 'vitest';
import {
  getTorStatus,
  mockFetch,
  startTor,
  stopTor,
} from './dockerTestHarness';
import { registerDockerTorCreateContracts } from './tor-create.contracts';

export function registerDockerTorLifecycleContracts(): void {
  describe('Tor Container Management', () => {
    describe('getTorStatus', () => {
      it('should return running status for tor container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor-1'],
              State: 'running',
            },
          ],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(true);
        expect(status.running).toBe(true);
      });

      it('should match tor container without number suffix', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor456',
              Names: ['/sanctuary-tor'],
              State: 'running',
            },
          ],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(true);
      });

      it('should return not_created when tor container missing', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(false);
        expect(status.status).toBe('not_created');
      });

      it('should return not_created when containers exist but none match tor pattern', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'backend123',
              Names: ['/sanctuary-backend-1'],
              State: 'running',
            },
          ],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(false);
        expect(status.running).toBe(false);
        expect(status.status).toBe('not_created');
      });

      it('should return not_created when list API fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(false);
        expect(status.status).toBe('not_created');
      });

      it('should return error status when tor state access throws unexpectedly', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor-error',
              Names: ['/sanctuary-tor-1'],
              get State() {
                throw new Error('Tor state getter failed');
              },
            },
          ],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(false);
        expect(status.running).toBe(false);
        expect(status.status).toBe('error');
      });
    });

    describe('startTor', () => {
      it('should return success when already running', async () => {
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

        const result = await startTor();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already running');
      });

      it('should start stopped container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });

        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await startTor();

        expect(result.success).toBe(true);
      });

      it('should handle start endpoint failure', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });

        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => 'cannot start',
        });

        const result = await startTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to start Tor');
      });

      it('should handle start network errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });

        mockFetch.mockRejectedValueOnce(new Error('start timeout'));

        const result = await startTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('start timeout');
      });
    });

    describe('stopTor', () => {
      it('should stop running container', async () => {
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

        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await stopTor();

        expect(result.success).toBe(true);
      });

      it('should return success if already stopped', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });

        const result = await stopTor();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already stopped');
      });

      it('should return success if tor container does not exist', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

        const result = await stopTor();

        expect(result.success).toBe(true);
        expect(result.message).toContain('does not exist');
      });

      it('should handle stop endpoint failure', async () => {
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

        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => 'cannot stop',
        });

        const result = await stopTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to stop Tor');
      });

      it('should handle stop network errors', async () => {
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

        mockFetch.mockRejectedValueOnce(new Error('stop timeout'));

        const result = await stopTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('stop timeout');
      });
    });

    registerDockerTorCreateContracts();
  });
}
