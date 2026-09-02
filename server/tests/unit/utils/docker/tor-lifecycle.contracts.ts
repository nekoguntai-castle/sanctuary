import { describe, expect, it } from 'vitest';
import {
  getTorStatus,
  mockFetch,
  ownedTorInspect,
  ownedTorSummary,
  TOR_ID,
  TOR_OWNERSHIP_LABELS,
  startTor,
  stopTor,
} from './dockerTestHarness';
import { registerDockerTorCreateContracts } from './tor-create.contracts';

export function registerDockerTorLifecycleContracts(): void {
  describe('Tor Container Management', () => {
    describe('getTorStatus', () => {
      it('fails closed when Docker returns a non-array container inventory', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        await expect(getTorStatus()).resolves.toMatchObject({
          exists: false,
          status: 'error',
          error: 'Tor container listing returned an invalid response',
        });
      });

      it('should return running status for tor container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(true);
        expect(status.running).toBe(true);
      });

      it('should match tor container without number suffix', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
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

      it('should fail closed when the list API fails', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(false);
        expect(status.status).toBe('error');
      });

      it('should return error status when tor state access throws unexpectedly', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: TOR_ID,
              Names: ['/sanctuary-tor'],
              Labels: TOR_OWNERSHIP_LABELS,
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

      it('ignores another deployment with a tor-like suffix', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            ownedTorSummary('running', {
              Names: ['/other-deployment-tor'],
              Labels: {
                ...TOR_OWNERSHIP_LABELS,
                'io.sanctuary.project': 'other-deployment',
                'io.sanctuary.deployment-id': 'deploy-other',
              },
            }),
          ],
        });

        await expect(getTorStatus()).resolves.toMatchObject({
          exists: false,
          status: 'not_created',
        });
      });

      it('fails closed when the exact name has a foreign ownership tuple', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            ownedTorSummary('running', {
              Labels: {
                ...TOR_OWNERSHIP_LABELS,
                'io.sanctuary.deployment-id': 'deploy-foreign',
              },
            }),
          ],
        });

        await expect(getTorStatus()).resolves.toMatchObject({
          exists: false,
          status: 'error',
        });
      });
    });

    describe('startTor', () => {
      it('reports a missing ownership manifest field', async () => {
        delete process.env.SANCTUARY_PROJECT;

        await expect(startTor()).resolves.toEqual({
          success: false,
          message: 'SANCTUARY_PROJECT is required for Tor ownership',
        });
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('reports an invalid ownership project', async () => {
        process.env.SANCTUARY_PROJECT = '../foreign';

        await expect(startTor()).resolves.toEqual({
          success: false,
          message: 'SANCTUARY_PROJECT is invalid for Tor ownership',
        });
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('reports unavailable ownership without punctuation for an empty Docker error', async () => {
        mockFetch.mockResolvedValueOnce({
          get ok() {
            throw new Error('');
          },
        });

        await expect(startTor()).resolves.toEqual({
          success: false,
          message: 'Tor ownership status is unavailable',
        });
      });

      it('should return success when already running', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
        });

        const result = await startTor();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already running');
      });

      it('creates Tor when no owned container exists', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => 'Done' });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Id: TOR_ID }),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ownedTorInspect(),
        });
        mockFetch.mockResolvedValueOnce({ status: 204 });

        await expect(startTor()).resolves.toMatchObject({
          success: true,
          message: 'Tor container created and started successfully',
        });
      });

      it('should start stopped container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('exited')],
        });

        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await startTor();

        expect(result.success).toBe(true);
        expect(mockFetch.mock.calls.at(-1)?.[0]).toContain(
          `/containers/${TOR_ID}/start`,
        );
      });

      it('should handle start endpoint failure', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('exited')],
        });

        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => 'cannot start',
        });

        const result = await startTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to start Tor');
      });

      it('uses the fallback error after an empty failed start response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('exited')],
        });
        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => undefined,
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ownedTorInspect(),
        });

        await expect(startTor()).resolves.toEqual({
          success: false,
          message: 'Failed to start Tor: unknown Docker start failure',
        });
      });

      it('refuses a container ID that changes after exact inventory validation', async () => {
        let reads = 0;
        const mutableIdentity = ownedTorSummary('exited');
        Object.defineProperty(mutableIdentity, 'Id', {
          get: () => (++reads === 1 ? TOR_ID : 'mutable-id'),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [mutableIdentity],
        });

        const result = await startTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Tor container ID is not immutable');
      });

      it('should handle start network errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('exited')],
        });

        mockFetch.mockRejectedValueOnce(new Error('start timeout'));

        const result = await startTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('start timeout');
      });

      it('accepts a lost start response only after two exact running-state inspections', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('exited')],
        });
        mockFetch.mockRejectedValueOnce(new Error('start response lost'));
        const running = ownedTorInspect({
          State: { ...ownedTorInspect().State, Status: 'running', Running: true },
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => running });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => running });

        await expect(startTor()).resolves.toMatchObject({ success: true });
      });

      it('reconciles a non-success start response only after exact running-state inspections', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('exited')],
        });
        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => 'proxy lost the daemon response',
        });
        const running = ownedTorInspect({
          State: { ...ownedTorInspect().State, Status: 'running', Running: true },
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => running });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => running });

        await expect(startTor()).resolves.toMatchObject({ success: true });
      });
    });

    describe('stopTor', () => {
      it('reports invalid ownership before querying Docker', async () => {
        process.env.SANCTUARY_PROJECT = 'not/a/project';

        await expect(stopTor()).resolves.toEqual({
          success: false,
          message: 'SANCTUARY_PROJECT is invalid for Tor ownership',
        });
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should stop running container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
        });

        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await stopTor();

        expect(result.success).toBe(true);
        expect(mockFetch.mock.calls.at(-1)?.[0]).toContain(
          `/containers/${TOR_ID}/stop?t=10`,
        );
      });

      it('should return success if already stopped', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('exited')],
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
          json: async () => [ownedTorSummary('running')],
        });

        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => 'cannot stop',
        });

        const result = await stopTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to stop Tor');
      });

      it('uses the fallback error after an empty failed stop response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
        });
        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => undefined,
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ownedTorInspect({
            State: {
              ...ownedTorInspect().State,
              Status: 'running',
              Running: true,
            },
          }),
        });

        await expect(stopTor()).resolves.toEqual({
          success: false,
          message: 'Failed to stop Tor: unknown Docker stop failure',
        });
      });

      it('refuses a container ID that changes after exact inventory validation', async () => {
        let reads = 0;
        const mutableIdentity = ownedTorSummary('running');
        Object.defineProperty(mutableIdentity, 'Id', {
          get: () => (++reads === 1 ? TOR_ID : 'mutable-id'),
        });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [mutableIdentity],
        });

        await expect(stopTor()).resolves.toEqual({
          success: false,
          message: 'Tor container ID is not immutable',
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should handle stop network errors', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
        });

        mockFetch.mockRejectedValueOnce(new Error('stop timeout'));

        const result = await stopTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('stop timeout');
      });

      it('accepts a lost stop response only after two exact stopped-state inspections', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
        });
        mockFetch.mockRejectedValueOnce(new Error('stop response lost'));
        const stopped = ownedTorInspect({
          State: { ...ownedTorInspect().State, Status: 'exited', Running: false },
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => stopped });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => stopped });

        await expect(stopTor()).resolves.toMatchObject({ success: true });
      });

      it('reconciles a non-success stop response only after exact stopped-state inspections', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [ownedTorSummary('running')],
        });
        mockFetch.mockResolvedValueOnce({
          status: 500,
          text: async () => 'proxy lost the daemon response',
        });
        const stopped = ownedTorInspect({
          State: { ...ownedTorInspect().State, Status: 'exited', Running: false },
        });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => stopped });
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => stopped });

        await expect(stopTor()).resolves.toMatchObject({ success: true });
      });

      it('refuses to stop an exact-name container from another deployment', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            ownedTorSummary('running', {
              Labels: {
                ...TOR_OWNERSHIP_LABELS,
                'io.sanctuary.deployment-id': 'deploy-foreign',
              },
            }),
          ],
        });

        const result = await stopTor();

        expect(result.success).toBe(false);
        expect(result.message).toContain('ownership status is unavailable');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    registerDockerTorCreateContracts();
  });
}
