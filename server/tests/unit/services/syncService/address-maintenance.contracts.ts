import { expect, it, vi } from 'vitest';
import {
  mockElectrumClient,
  mockGetNodeClient,
  mockNotificationService,
  mockPopulateMissingTransactionFields,
  mockPrismaClient,
  mockSyncIntentRequest,
  mockSyncIntentReset,
  mockUpdateTransactionConfirmations,
  type SyncServiceTestContext,
} from './syncServiceTestHarness';

export function registerSyncServiceAddressMaintenanceTests(context: SyncServiceTestContext): void {
  describe('address subscriptions', () => {
    it('should subscribe to wallet addresses', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: 'tb1qaddr1' },
        { address: 'tb1qaddr2' },
      ]);

      await context.syncService.subscribeNewWalletAddresses('wallet-1');

      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe wallet addresses', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      context.syncService['addressToWalletMap'].set('addr1', 'wallet-1');
      context.syncService['addressToWalletMap'].set('addr2', 'wallet-1');
      context.syncService['addressToWalletMap'].set('addr3', 'wallet-2');

      await context.syncService.unsubscribeWalletAddresses('wallet-1');

      expect(context.syncService['addressToWalletMap'].size).toBe(1);
      expect(mockElectrumClient.unsubscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('should gracefully handle unsubscribe errors for individual addresses', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      context.syncService['addressToWalletMap'].set('addr1', 'wallet-1');
      context.syncService['addressToWalletMap'].set('addr2', 'wallet-1');
      context.syncService['addressToWalletMap'].set('addr3', 'wallet-2');

      mockElectrumClient.unsubscribeAddress
        .mockRejectedValueOnce(new Error('electrum disconnect'))
        .mockResolvedValueOnce(undefined);

      await context.syncService.unsubscribeWalletAddresses('wallet-1');

      // Both addresses removed from map despite one unsubscribe failing
      expect(context.syncService['addressToWalletMap'].size).toBe(1);
      expect(context.syncService['addressToWalletMap'].has('addr3')).toBe(true);
      expect(mockElectrumClient.unsubscribeAddress).toHaveBeenCalledTimes(2);
    });
  });

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
    it('scopes live confirmation refreshes to the producing network', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([]);

      await context.syncService['updateNetworkConfirmations']('testnet4');

      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          confirmations: { lt: 6 },
          wallet: { network: 'testnet4' },
        },
      }));
    });

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

  describe('address activity and subscription helpers', () => {
    it('ignores address-activity events without a resolved address', async () => {
      await context.syncService['handleAddressActivity']({ scriptHash: 'hash-1', status: 'status' });
      expect(mockPrismaClient.address.findFirst).not.toHaveBeenCalled();
    });

    it('queues a mapped wallet on address activity', async () => {
      context.syncService['addressToWalletMap'].set('tb1mapped', 'wallet-mapped');
      await context.syncService['handleAddressActivity']({
        scriptHash: 'hash-2',
        address: 'tb1mapped',
        status: 'status',
      });

      await vi.waitFor(() => expect(mockSyncIntentRequest).toHaveBeenCalledWith('wallet-mapped'));
    });

    it('falls back to DB lookup when address is not in memory map', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValueOnce({ walletId: 'wallet-db' });
      await context.syncService['handleAddressActivity']({
        scriptHash: 'hash-3',
        address: 'tb1lookup',
        status: 'status',
      });

      expect(context.syncService['addressToWalletMap'].get('tb1lookup')).toBe('wallet-db');
      await vi.waitFor(() => expect(mockSyncIntentRequest).toHaveBeenCalledWith('wallet-db'));
    });

    it('does not queue when DB lookup cannot resolve address activity wallet', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValueOnce(null);
      const queueSpy = vi.spyOn(context.syncService as any, 'queueSync');

      await context.syncService['handleAddressActivity']({
        scriptHash: 'hash-4',
        address: 'tb1unknown',
        status: 'status',
      });

      expect(queueSpy).not.toHaveBeenCalled();
      expect(context.syncService['addressToWalletMap'].has('tb1unknown')).toBe(false);
    });

    it('subscribes wallet addresses using wallet network when present', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({ network: 'testnet3' });
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'tb1qaddr-a' },
        { address: 'tb1qaddr-b' },
      ]);

      await context.syncService.subscribeWalletAddresses('wallet-1');

      expect(mockGetNodeClient).toHaveBeenCalledWith('testnet3');
      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('defaults to mainnet and continues when one address subscription fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'bc1qaddr-a' },
        { address: 'bc1qaddr-b' },
      ]);
      mockElectrumClient.subscribeAddress
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce(undefined);

      await context.syncService.subscribeWalletAddresses('wallet-2');

      expect(mockGetNodeClient).toHaveBeenCalledWith('mainnet');
      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });
  });

  describe('address map reconciliation', () => {
    it('removes stale address-to-wallet mappings for deleted wallets', async () => {
      context.syncService['addressToWalletMap'].set('addr-keep', 'wallet-keep');
      context.syncService['addressToWalletMap'].set('addr-remove', 'wallet-remove');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-keep', walletId: 'wallet-keep' },
      ]);

      await context.syncService['reconcileAddressToWalletMap']();

      expect(context.syncService['addressToWalletMap'].has('addr-keep')).toBe(true);
      expect(context.syncService['addressToWalletMap'].has('addr-remove')).toBe(false);
    });

    it('skips reconciliation query when map is empty', async () => {
      context.syncService['addressToWalletMap'].clear();
      await context.syncService['reconcileAddressToWalletMap']();
      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('subscribes new addresses during reconciliation when ownership is self', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      context.syncService['addressToWalletMap'].set('addr-existing', 'wallet-1');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-existing', walletId: 'wallet-1' },
        { address: 'addr-new', walletId: 'wallet-2' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([['addr-new', 'status-new']])
      );

      await context.syncService['reconcileAddressToWalletMap']();

      expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-new']);
      expect(context.syncService['addressToWalletMap'].get('addr-new')).toBe('wallet-2');
    });
  });

}
