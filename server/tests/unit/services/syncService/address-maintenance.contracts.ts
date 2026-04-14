import { expect, it, vi } from 'vitest';
import {
  mockElectrumClient,
  mockGetNodeClient,
  mockNotificationService,
  mockPopulateMissingTransactionFields,
  mockPrismaClient,
  mockReleaseLock,
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

  describe('queue overflow behavior', () => {
    it('evicts a low-priority job when queue is full', () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('busy-1');
      context.syncService['activeSyncs'].add('busy-2');
      context.syncService['activeSyncs'].add('busy-3');
      context.syncService['activeSyncs'].add('busy-4');
      context.syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      context.syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `wallet-${i}`,
        priority: i === 500 ? 'low' : 'normal',
        requestedAt: now,
      }));

      context.syncService.queueSync('wallet-new', 'normal');

      expect(context.syncService['syncQueue']).toHaveLength(1000);
      expect(context.syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-new')).toBe(true);
      expect(context.syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-500')).toBe(false);
    });

    it('rejects low-priority jobs when queue is full of higher priority jobs', () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('busy-1');
      context.syncService['activeSyncs'].add('busy-2');
      context.syncService['activeSyncs'].add('busy-3');
      context.syncService['activeSyncs'].add('busy-4');
      context.syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      context.syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `wallet-${i}`,
        priority: 'normal',
        requestedAt: now,
      }));

      context.syncService.queueSync('wallet-low', 'low');

      expect(context.syncService['syncQueue']).toHaveLength(1000);
      expect(context.syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-low')).toBe(false);
    });

    it('evicts a normal-priority job for a high-priority request when full', () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('busy-1');
      context.syncService['activeSyncs'].add('busy-2');
      context.syncService['activeSyncs'].add('busy-3');
      context.syncService['activeSyncs'].add('busy-4');
      context.syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      context.syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `wallet-${i}`,
        priority: 'normal',
        requestedAt: now,
      }));

      context.syncService.queueSync('wallet-high', 'high');

      expect(context.syncService['syncQueue']).toHaveLength(1000);
      expect(context.syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-high')).toBe(true);
    });

    it('rejects non-high request when queue is full of high-priority jobs', () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('busy-1');
      context.syncService['activeSyncs'].add('busy-2');
      context.syncService['activeSyncs'].add('busy-3');
      context.syncService['activeSyncs'].add('busy-4');
      context.syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      context.syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `high-${i}`,
        priority: 'high',
        requestedAt: now,
      }));

      context.syncService.queueSync('wallet-normal-blocked', 'normal');

      expect(context.syncService['syncQueue']).toHaveLength(1000);
      expect(context.syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-normal-blocked')).toBe(false);
    });

    it('upgrades queued wallet priority when duplicate is re-queued as high', () => {
      context.syncService['isRunning'] = false;
      context.syncService['syncQueue'] = [{ walletId: 'wallet-dup', priority: 'low', requestedAt: new Date() }];

      context.syncService.queueSync('wallet-dup', 'high');

      expect(context.syncService['syncQueue'][0].priority).toBe('high');
    });

    it('keeps duplicate high-priority jobs unchanged when re-queued as high', () => {
      context.syncService['syncQueue'] = [{ walletId: 'wallet-dup-high', priority: 'high', requestedAt: new Date() }];

      context.syncService.queueSync('wallet-dup-high', 'high');

      expect(context.syncService['syncQueue']).toHaveLength(1);
      expect(context.syncService['syncQueue'][0].priority).toBe('high');
    });
  });

  describe('stale sync checks', () => {
    it('auto-unstucks stale sync flags and queues stale wallets', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('wallet-active');

      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([
          { id: 'wallet-stuck', name: 'Stuck Wallet' },
          { id: 'wallet-active', name: 'Active Wallet' },
        ])
        .mockResolvedValueOnce([
          { id: 'wallet-stale-1' },
          { id: 'wallet-stale-2' },
        ]);

      const queueSpy = vi.spyOn(context.syncService as any, 'queueSync');

      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-stuck' },
        data: { syncInProgress: false },
      });
      expect(queueSpy).toHaveBeenCalledWith('wallet-stale-1', 'low');
      expect(queueSpy).toHaveBeenCalledWith('wallet-stale-2', 'low');
    });

    it('returns early when service is not running', async () => {
      context.syncService['isRunning'] = false;

      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.findMany).not.toHaveBeenCalled();
    });

    it('handles stale-check query errors without throwing', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.findMany.mockRejectedValueOnce(new Error('db down'));

      await expect(context.syncService['checkAndQueueStaleSyncs']()).resolves.toBeUndefined();
    });

    it('auto-unstucks using wallet id when wallet name is missing', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([{ id: 'wallet-unnamed', name: '' }])
        .mockResolvedValueOnce([]);

      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-unnamed' },
        data: { syncInProgress: false },
      });
    });

    it('skips unstuck and stale queue summary paths when there is no work', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeSyncs'].add('wallet-active');
      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([{ id: 'wallet-active', name: 'Active Wallet' }])
        .mockResolvedValueOnce([]);
      const queueSpy = vi.spyOn(context.syncService as any, 'queueSync');

      await context.syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
      expect(queueSpy).not.toHaveBeenCalled();
    });

    it('handles resetStuckSyncs errors without throwing', async () => {
      mockPrismaClient.wallet.updateMany.mockRejectedValueOnce(new Error('updateMany failed'));

      await expect(context.syncService['resetStuckSyncs']()).resolves.toBeUndefined();
    });
  });

  describe('confirmation update flows', () => {
    it('updates confirmations and broadcasts only changed transactions', async () => {
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

      expect(mockNotificationService.broadcastConfirmationUpdate).toHaveBeenCalledTimes(2);
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
      expect(mockUpdateTransactionConfirmations).toHaveBeenCalledWith('wallet-ok');
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
      const queueSpy = vi.spyOn(context.syncService as any, 'queueSync');

      await context.syncService['handleAddressActivity']({
        scriptHash: 'hash-2',
        address: 'tb1mapped',
        status: 'status',
      });

      expect(queueSpy).toHaveBeenCalledWith('wallet-mapped', 'high');
    });

    it('falls back to DB lookup when address is not in memory map', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValueOnce({ walletId: 'wallet-db' });
      const queueSpy = vi.spyOn(context.syncService as any, 'queueSync');

      await context.syncService['handleAddressActivity']({
        scriptHash: 'hash-3',
        address: 'tb1lookup',
        status: 'status',
      });

      expect(context.syncService['addressToWalletMap'].get('tb1lookup')).toBe('wallet-db');
      expect(queueSpy).toHaveBeenCalledWith('wallet-db', 'high');
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
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({ network: 'testnet' });
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'tb1qaddr-a' },
        { address: 'tb1qaddr-b' },
      ]);

      await context.syncService.subscribeWalletAddresses('wallet-1');

      expect(mockGetNodeClient).toHaveBeenCalledWith('testnet');
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

  describe('cleanup on stop', () => {
    it('should cancel pending retry timers', async () => {
      context.syncService['isRunning'] = true;

      const timer = setTimeout(() => {}, 10000);
      context.syncService['pendingRetries'].set('wallet-1', timer);

      await context.syncService.stop();

      expect(context.syncService['pendingRetries'].size).toBe(0);
    });

    it('should release all active locks', async () => {
      context.syncService['isRunning'] = true;

      context.syncService['activeLocks'].set('wallet-1', { id: 'lock-1', resource: 'test' } as any);
      context.syncService['activeLocks'].set('wallet-2', { id: 'lock-2', resource: 'test' } as any);

      await context.syncService.stop();

      expect(mockReleaseLock).toHaveBeenCalledTimes(2);
      expect(context.syncService['activeLocks'].size).toBe(0);
    });

    it('should clear the sync queue', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['syncQueue'] = [
        { walletId: 'w1', priority: 'normal', requestedAt: new Date() },
        { walletId: 'w2', priority: 'high', requestedAt: new Date() },
      ];

      await context.syncService.stop();

      expect(context.syncService['syncQueue'].length).toBe(0);
    });

    it('continues stopping when active lock release fails', async () => {
      context.syncService['isRunning'] = true;
      context.syncService['activeLocks'].set('wallet-1', { id: 'lock-1', resource: 'test' } as any);
      mockReleaseLock.mockRejectedValueOnce(new Error('release failed'));

      await expect(context.syncService.stop()).resolves.toBeUndefined();
      expect(context.syncService['activeLocks'].size).toBe(0);
    });
  });
}
