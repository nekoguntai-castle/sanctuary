import { expect, it, vi } from 'vitest';
import {
  getSyncServiceInstanceForTest,
  mockAcquireLock,
  mockPrismaClient,
  mockReleaseLock,
  type SyncServiceTestContext,
} from './syncServiceTestHarness';

export function registerSyncServiceLifecycleQueueTests(context: SyncServiceTestContext): void {
  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getSyncServiceInstanceForTest();
      const instance2 = getSyncServiceInstanceForTest();

      expect(instance1).toBe(instance2);
    });
  });

  describe('state getters', () => {
    it('should expose subscriptionsEnabled via getter', () => {
      expect(context.syncService.subscriptionsEnabled).toBe(false);
      context.syncService.subscriptionsEnabled = true;
      expect(context.syncService.subscriptionsEnabled).toBe(true);
      context.syncService.subscriptionsEnabled = false;
    });
  });

  describe('start/stop', () => {
    it('should start the service', async () => {
      await context.syncService.start();

      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should not start twice', async () => {
      await context.syncService.start();
      await context.syncService.start();

      // Should still be running, no errors
      expect(context.syncService['isRunning']).toBe(true);
    });

    it('should stop the service', async () => {
      await context.syncService.start();
      await context.syncService.stop();

      expect(context.syncService['isRunning']).toBe(false);
    });

    it('clears pending retry timers on stop without touching distributed locks', async () => {
      await context.syncService.start();
      mockReleaseLock.mockClear();
      const retryTimer = setTimeout(() => undefined, 60_000);
      context.syncService['state'].pendingRetries.set('wallet-retry', retryTimer);

      await context.syncService.stop();

      expect(context.syncService['state'].pendingRetries.size).toBe(0);
      expect(mockReleaseLock).not.toHaveBeenCalled();
    });

    it('does not report the retired in-process queue as sync activity', () => {
      // Sync runs in the worker. A local queue length or active count would
      // always read 0 here and look like evidence that nothing is syncing.
      const metrics = context.syncService.getHealthMetrics();

      expect(metrics).not.toHaveProperty('queueLength');
      expect(metrics).not.toHaveProperty('activeSyncs');
      expect(context.syncService['state']).not.toHaveProperty('syncQueue');
      expect(context.syncService['state']).not.toHaveProperty('activeSyncs');
      expect(context.syncService['state']).not.toHaveProperty('activeLocks');
    });

    it('should reset stuck syncs on start', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 2 });

      await context.syncService.start();

      expect(mockPrismaClient.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          syncInProgress: true,
          OR: [{ syncExecutionOwner: null }, { syncExecutionOwner: 'inline' }],
        },
        data: {
          syncInProgress: false,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        },
      });
    });

    it('invokes only compatibility polling callbacks after start', async () => {
      const staleSpy = vi.spyOn(context.syncService as any, 'checkAndQueueStaleSyncs').mockResolvedValue(undefined);
      const confirmationsSpy = vi.spyOn(context.syncService as any, 'updateAllConfirmations').mockResolvedValue(undefined);

      await context.syncService.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(staleSpy).toHaveBeenCalled();
      expect(confirmationsSpy).toHaveBeenCalled();
    });

    it('leaves subscription ownership external without acquiring API authority', async () => {
      await context.syncService.start();

      expect(context.syncService['isRunning']).toBe(true);
      expect(context.syncService['subscriptionOwnership']).toBe('external');
      expect(mockAcquireLock).not.toHaveBeenCalled();
    });
  });

  describe('retired inline compatibility entry points', () => {
    it('fails closed when legacy callers try to queue or execute inline sync', async () => {
      expect(() => context.syncService.queueSync('wallet-1', 'high')).toThrow(
        'Inline wallet sync queue is retired; use durable sync intent admission',
      );
      await expect(context.syncService.syncNow('wallet-1')).rejects.toThrow(
        'Immediate wallet sync is retired; use durable sync intent admission',
      );
    });

    it('keeps inline execution locks retired', async () => {
      await expect(context.syncService.acquireSyncLock('wallet-1')).resolves.toBe(false);
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status for wallet', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        syncInProgress: false,
      });

      const status = await context.syncService.getSyncStatus('wallet-1');

      expect(status.syncStatus).toBe('success');
      expect(status.syncInProgress).toBe(false);
    });

    it('reports worker-owned progress from authoritative persisted state', async () => {
      const startedAt = new Date('2026-08-20T12:00:00.000Z');
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: null,
        lastSyncStatus: 'syncing',
        syncInProgress: true,
        syncExecutionOwner: 'worker',
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: startedAt,
        syncStateVersion: 7,
      });

      const status = await context.syncService.getSyncStatus('wallet-worker');

      expect(status).toMatchObject({
        syncInProgress: true,
        executionOwner: 'worker',
        retryCount: 0,
        nextRetryAt: null,
        startedAt,
        stateVersion: 7,
      });
    });

    // ADR 0004: elapsed time is not a wallet-history trigger, so an old
    // lastSyncedAt on a quiet wallet is current, not stale.
    it('does not report a quiet wallet as stale because lastSyncedAt is old', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        lastSyncStatus: 'success',
        syncInProgress: false,
        requestedIncrementalSyncGeneration: 3,
        processedIncrementalSyncGeneration: 3,
        requestedFullResyncGeneration: 1,
        processedFullResyncGeneration: 1,
      });

      const status = await context.syncService.getSyncStatus('wallet-1');

      expect(status.isStale).toBe(false);
    });

    // Blocked is not behind: action-required is reported by its own field.
    it('does not fold action-required into isStale', async () => {
      const actionRequiredAt = new Date('2026-11-01T00:00:00.000Z');
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: new Date(),
        lastSyncStatus: 'failed',
        syncInProgress: false,
        syncActionRequiredAt: actionRequiredAt,
        requestedIncrementalSyncGeneration: 3,
        processedIncrementalSyncGeneration: 3,
        requestedFullResyncGeneration: 1,
        processedFullResyncGeneration: 1,
      });

      const status = await context.syncService.getSyncStatus('wallet-1');

      expect(status).toMatchObject({ isStale: false, syncActionRequiredAt: actionRequiredAt });
    });

    it.each([
      ['never synced', { lastSyncedAt: null }],
      ['incremental intent unprocessed', { requestedIncrementalSyncGeneration: 4 }],
      ['full resync unprocessed', { requestedFullResyncGeneration: 2 }],
    ])('reports stale when %s', async (_label, override) => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        syncInProgress: false,
        requestedIncrementalSyncGeneration: 3,
        processedIncrementalSyncGeneration: 3,
        requestedFullResyncGeneration: 1,
        processedFullResyncGeneration: 1,
        ...override,
      });

      const status = await context.syncService.getSyncStatus('wallet-1');

      expect(status.isStale).toBe(true);
    });

    it('reports durable intent state and never invents a retired local queue position', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
        requestedIncrementalSyncGeneration: 9,
        claimedIncrementalSyncGeneration: 8,
        processedIncrementalSyncGeneration: 7,
        incrementalSyncClaimedAt: new Date('2026-08-20T12:00:00.000Z'),
        incrementalSyncLeaseExpiresAt: new Date('2026-08-20T12:05:00.000Z'),
        syncActionRequiredAt: null,
        requestedFullResyncGeneration: 4,
        preparedFullResyncGeneration: 3,
        processedFullResyncGeneration: 2,
      });

      const status = await context.syncService.getSyncStatus('wallet-2');

      expect(status).toMatchObject({
        queuePosition: null,
        requestedIncrementalSyncGeneration: 9,
        claimedIncrementalSyncGeneration: 8,
        processedIncrementalSyncGeneration: 7,
        requestedFullResyncGeneration: 4,
        preparedFullResyncGeneration: 3,
        processedFullResyncGeneration: 2,
      });
    });

    it('should throw for non-existent wallet', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(context.syncService.getSyncStatus('nonexistent')).rejects.toThrow('Wallet not found');
    });
  });

}
