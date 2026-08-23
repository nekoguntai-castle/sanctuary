import { expect, it, vi } from 'vitest';
import {
  mockNotificationService,
  mockPopulateMissingTransactionFields,
  mockPrismaClient,
  mockSyncIntentRequest,
  mockSyncIntentReset,
  mockUpdateTransactionConfirmations,
  type SyncServiceTestContext,
} from './syncServiceTestHarness';

export function registerSyncServiceAddressMaintenanceTests(context: SyncServiceTestContext): void {

  describe('stale sync checks', () => {
    it('repairs authorized stuck flags without requesting wallets based on elapsed age', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('wallet-active');

      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([
          {
            id: 'wallet-stuck',
            name: 'Stuck Wallet',
            syncExecutionOwner: 'inline',
            syncStartedAt: null,
            syncStateVersion: 1,
          },
          { id: 'wallet-active', name: 'Active Wallet', syncStateVersion: 1 },
        ]);
      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockSyncIntentReset).toHaveBeenCalledWith('wallet-stuck', {
        syncStateVersion: 1,
        syncExecutionOwner: 'inline',
        syncStartedAt: null,
      });
      expect(mockPrismaClient.wallet.findMany).toHaveBeenCalledOnce();
      expect(mockSyncIntentRequest).not.toHaveBeenCalled();
    });

    it('returns early when service is not running', async () => {
      context.syncService['isRunning'] = false;

      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.findMany).not.toHaveBeenCalled();
    });

    it('does not clear worker-owned progress absent from the API-local active set', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([{
          id: 'wallet-worker',
          name: 'Worker Wallet',
          syncExecutionOwner: 'worker',
          syncStartedAt: new Date(),
          syncStateVersion: 1,
        }]);

      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockSyncIntentReset).not.toHaveBeenCalled();
    });

    it('handles stale-check query errors without throwing', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.findMany.mockRejectedValueOnce(new Error('db down'));

      await expect(context.syncService['checkAndQueueStaleSyncs']()).resolves.toBeUndefined();
    });

    it('auto-unstucks using wallet id when wallet name is missing', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([
        {
          id: 'wallet-unnamed',
          name: '',
          syncExecutionOwner: null,
          syncStartedAt: null,
          syncStateVersion: 1,
        },
      ]);
      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockSyncIntentReset).toHaveBeenCalledWith('wallet-unnamed', {
        syncStateVersion: 1,
        syncExecutionOwner: null,
        syncStartedAt: null,
      });
    });

    it('skips unstuck and stale queue summary paths when there is no work', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('wallet-active');
      mockPrismaClient.wallet.findMany.mockResolvedValueOnce([
        { id: 'wallet-active', name: 'Active Wallet', syncStateVersion: 1 },
      ]);
      const queueSpy = vi.spyOn(context.syncService as any, 'queueSync');

      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockSyncIntentReset).not.toHaveBeenCalled();
      expect(queueSpy).not.toHaveBeenCalled();
    });

    it('handles resetStuckSyncs errors without throwing', async () => {
      mockPrismaClient.wallet.updateMany.mockRejectedValueOnce(new Error('updateMany failed'));

      await expect(context.syncService['resetStuckSyncs']()).resolves.toBeUndefined();
    });

    it('contains stranded inline retry demotion failures during startup repair', async () => {
      mockPrismaClient.wallet.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockRejectedValueOnce(new Error('demotion failed'));

      await expect(context.syncService['resetStuckSyncs']()).resolves.toBeUndefined();
    });

  });

  describe('confirmation update flows', () => {
    it('delegates confirmation updates to the single event-service publisher', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([{ walletId: 'wallet-1' }]);
      mockPopulateMissingTransactionFields.mockResolvedValueOnce({
        updated: 1,
        confirmationUpdates: [{ txid: 'tx-a', oldConfirmations: 0, newConfirmations: 1 }],
      });
      mockUpdateTransactionConfirmations.mockResolvedValueOnce([
        { txid: 'tx-b', oldConfirmations: 1, newConfirmations: 2 },
      ]);

      const { eventService } = await import('../../../../src/services/eventService');

      await context.syncService['updateAllConfirmations']();

      expect(mockNotificationService.broadcastConfirmationUpdate).not.toHaveBeenCalled();
      expect(eventService.emitTransactionConfirmed).toHaveBeenCalledTimes(2);
    });

    it('continues updating other wallets when one wallet update fails', async () => {
      context.syncService['isRunning'] = true;

      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([
        { walletId: 'wallet-fail' },
        { walletId: 'wallet-ok' },
      ]);
      mockPopulateMissingTransactionFields
        .mockRejectedValueOnce(new Error('populate failed'))
        .mockResolvedValueOnce({ updated: 0, confirmationUpdates: [] });
      mockUpdateTransactionConfirmations.mockResolvedValueOnce([]);

      await context.syncService['updateAllConfirmations']();

      expect(mockUpdateTransactionConfirmations).toHaveBeenCalledTimes(1);
      expect(mockUpdateTransactionConfirmations).toHaveBeenCalledWith(
        'wallet-ok',
        expect.any(AbortSignal),
        expect.any(Function),
      );
    });

    it('contains and reports confirmation publication failures', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([{ walletId: 'wallet-1' }]);
      mockUpdateTransactionConfirmations.mockResolvedValueOnce([
        { txid: 'tx-publish-fail', oldConfirmations: 0, newConfirmations: 1 },
      ]);
      const { eventService } = await import('../../../../src/services/eventService');
      vi.mocked(eventService.emitTransactionConfirmed).mockImplementationOnce(() => {
        throw new Error('publisher unavailable');
      });

      await expect(context.syncService['updateAllConfirmations']()).resolves.toBeUndefined();

      expect(mockUpdateTransactionConfirmations).toHaveBeenCalledOnce();
      expect(eventService.emitTransactionConfirmed).toHaveBeenCalledOnce();
    });

    it('returns early when not running', async () => {
      context.syncService['isRunning'] = false;

      await context.syncService['updateAllConfirmations']();

      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
    });

    it('handles top-level confirmation update query failures', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.transaction.findMany.mockRejectedValueOnce(new Error('confirmations query failed'));

      await expect(context.syncService['updateAllConfirmations']()).resolves.toBeUndefined();
    });
  });

}
