import { expect, it, vi } from 'vitest';
import {
  mockAcquireLock,
  mockElectrumClient,
  mockExtendLock,
  mockGetElectrumClientIfActive,
  mockGetNodeClient,
  mockNotificationService,
  mockPrismaClient,
  mockReleaseLock,
  type SyncServiceTestContext,
} from './syncServiceTestHarness';

export function registerSyncServiceRealtimeSubscriptionTests(context: SyncServiceTestContext): void {
  describe('real-time subscriptions and block handling', () => {
    it('disables setup immediately when subscriptions are disabled in config', async () => {
      const configModule = await import('../../../../src/config');
      vi.spyOn(configModule, 'getConfig').mockReturnValue({
        sync: {
          intervalMs: 60000,
          confirmationUpdateIntervalMs: 30000,
          staleThresholdMs: 300000,
          maxConcurrentSyncs: 5,
          maxRetryAttempts: 3,
          retryDelaysMs: [1000, 5000, 15000],
          maxSyncDurationMs: 120000,
          transactionBatchSize: 100,
          electrumSubscriptionsEnabled: false,
        },
        bitcoin: { network: 'testnet' },
      } as any);

      await context.syncService['setupRealTimeSubscriptions']();

      expect(context.syncService['subscriptionOwnership']).toBe('disabled');
      expect(mockAcquireLock).not.toHaveBeenCalled();
    });

    it('sets ownership to external when subscription lock is unavailable', async () => {
      mockAcquireLock.mockResolvedValueOnce(null);

      await context.syncService['setupRealTimeSubscriptions']();

      expect(context.syncService['subscriptionOwnership']).toBe('external');
    });

    it('disables subscriptions when electrum client is unavailable', async () => {
      mockAcquireLock.mockResolvedValueOnce({
        key: 'electrum:subscriptions',
        token: 'token-1',
        expiresAt: Date.now() + 60000,
        isLocal: true,
      });
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await context.syncService['setupRealTimeSubscriptions']();

      expect(context.syncService['subscriptionOwnership']).toBe('disabled');
      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('continues setup when getServerVersion fails', async () => {
      mockElectrumClient.getServerVersion.mockRejectedValueOnce(new Error('version unavailable'));
      mockPrismaClient.address.findMany.mockResolvedValueOnce([]);

      await context.syncService['setupRealTimeSubscriptions']();

      expect(mockElectrumClient.subscribeHeaders).toHaveBeenCalled();
      expect(context.syncService['subscriptionOwnership']).toBe('self');
    });

    it('keeps existing header subscription and refresh timer on repeated setup calls', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);

      await context.syncService['setupRealTimeSubscriptions']();
      await context.syncService['setupRealTimeSubscriptions']();

      expect(mockElectrumClient.subscribeHeaders).toHaveBeenCalledTimes(1);
    });

    it('keeps ownership unchanged when setup fails before subscriptions are enabled', async () => {
      const configModule = await import('../../../../src/config');
      const configSpy = vi.spyOn(configModule, 'getConfig').mockImplementation(() => {
        throw new Error('config load failed');
      });
      context.syncService['subscriptionsEnabled'] = false;
      context.syncService['subscriptionOwnership'] = 'disabled';

      await context.syncService['setupRealTimeSubscriptions']();
      configSpy.mockRestore();

      expect(context.syncService['subscriptionOwnership']).toBe('disabled');
    });

    it('handles setup errors after acquiring lock', async () => {
      mockGetNodeClient.mockRejectedValueOnce(new Error('node offline'));

      await context.syncService['setupRealTimeSubscriptions']();

      expect(context.syncService['subscriptionOwnership']).toBe('external');
      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('refreshes subscription lock and handles lost ownership', async () => {
      context.syncService['subscriptionLock'] = {
        key: 'electrum:subscriptions',
        token: 'token-1',
        expiresAt: Date.now() + 60000,
        isLocal: true,
      } as any;
      context.syncService['subscriptionOwnership'] = 'self';

      const teardownSpy = vi.spyOn(context.syncService as any, 'teardownRealTimeSubscriptions').mockResolvedValue(undefined);
      mockExtendLock.mockResolvedValueOnce(null);

      context.syncService['startSubscriptionLockRefresh']();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(context.syncService['subscriptionOwnership']).toBe('external');
      expect(context.syncService['subscriptionLock']).toBeNull();
      expect(teardownSpy).toHaveBeenCalled();
    });

    it('updates subscription lock when refresh succeeds', async () => {
      const initialLock = {
        key: 'electrum:subscriptions',
        token: 'token-1',
        expiresAt: Date.now() + 60000,
        isLocal: true,
      } as any;
      const refreshedLock = {
        ...initialLock,
        token: 'token-2',
      };
      context.syncService['subscriptionLock'] = initialLock;
      context.syncService['subscriptionOwnership'] = 'self';
      mockExtendLock.mockResolvedValueOnce(refreshedLock);

      context.syncService['startSubscriptionLockRefresh']();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(context.syncService['subscriptionLock']).toEqual(refreshedLock);
      context.syncService['stopSubscriptionLockRefresh']();
    });

    it('skips refresh extension when lock is missing on refresh tick', async () => {
      context.syncService['subscriptionLock'] = null;

      context.syncService['startSubscriptionLockRefresh']();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockExtendLock).not.toHaveBeenCalled();
      context.syncService['stopSubscriptionLockRefresh']();
    });

    it('batch-subscribes addresses and falls back to individual subscriptions on batch failure', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-1', walletId: 'wallet-1' },
        { address: 'addr-2', walletId: 'wallet-2' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch unsupported'));
      mockElectrumClient.subscribeAddress
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('addr-2 failed'));

      await context.syncService['subscribeAllWalletAddresses']();

      expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-1', 'addr-2']);
      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
      expect(context.syncService['addressToWalletMap'].get('addr-1')).toBe('wallet-1');
    });

    it('returns early for subscribeAllWalletAddresses when ownership is not self', async () => {
      context.syncService['subscriptionOwnership'] = 'external';

      await context.syncService['subscribeAllWalletAddresses']();

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
      expect(mockElectrumClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('returns early for subscribeAllWalletAddresses when electrum client is unavailable', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await context.syncService['subscribeAllWalletAddresses']();

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('batch-subscribes addresses successfully and updates address map', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-a', walletId: 'wallet-a' },
        { address: 'addr-b', walletId: 'wallet-b' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([
          ['addr-a', 'status-a'],
          ['addr-b', 'status-b'],
        ])
      );

      await context.syncService['subscribeAllWalletAddresses']();

      expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-a', 'addr-b']);
      expect(context.syncService['addressToWalletMap'].get('addr-a')).toBe('wallet-a');
      expect(context.syncService['addressToWalletMap'].get('addr-b')).toBe('wallet-b');
    });

    it('ignores batch subscription entries without a truthy wallet id mapping', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-empty', walletId: '' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([['addr-empty', 'status-empty']])
      );

      await context.syncService['subscribeAllWalletAddresses']();

      expect(context.syncService['addressToWalletMap'].has('addr-empty')).toBe(false);
    });

    it('skips fallback address mapping when wallet id is not truthy', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-empty-fallback', walletId: '' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch unsupported'));
      mockElectrumClient.subscribeAddress.mockResolvedValueOnce(undefined);

      await context.syncService['subscribeAllWalletAddresses']();

      expect(context.syncService['addressToWalletMap'].has('addr-empty-fallback')).toBe(false);
    });

    it('returns early when unsubscribeWalletAddresses is called without ownership', async () => {
      context.syncService['subscriptionOwnership'] = 'external';
      context.syncService['addressToWalletMap'].set('addr-1', 'wallet-1');

      await context.syncService.unsubscribeWalletAddresses('wallet-1');

      expect(context.syncService['addressToWalletMap'].size).toBe(1);
      expect(mockElectrumClient.unsubscribeAddress).not.toHaveBeenCalled();
    });

    it('removes in-memory mappings even when electrum client is unavailable for unsubscribe', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      context.syncService['addressToWalletMap'].set('addr-no-client', 'wallet-1');
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await context.syncService.unsubscribeWalletAddresses('wallet-1');

      expect(context.syncService['addressToWalletMap'].size).toBe(0);
      expect(mockElectrumClient.unsubscribeAddress).not.toHaveBeenCalled();
    });

    it('logs no-op reconciliation path when all wallets still exist', async () => {
      context.syncService['addressToWalletMap'].set('addr-keep', 'wallet-keep');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-keep', walletId: 'wallet-keep' },
      ]);

      await context.syncService['reconcileAddressToWalletMap']();

      expect(context.syncService['addressToWalletMap'].has('addr-keep')).toBe(true);
    });

    it('handles new block success and confirmation-update failure paths', async () => {
      const { eventService } = await import('../../../../src/services/eventService');
      const updateSpy = vi.spyOn(context.syncService as any, 'updateAllConfirmations')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('confirmations failed'));

      await context.syncService['handleNewBlock']({ height: 200, hex: 'a'.repeat(80) });
      await context.syncService['handleNewBlock']({ height: 201, hex: 'b'.repeat(80) });

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(eventService.emitNewBlock).toHaveBeenCalledWith('testnet', 200, 'a'.repeat(64));
      expect(mockNotificationService.broadcastNewBlock).toHaveBeenCalledWith({ height: 200 });
    });

    it('tears down subscriptions even when unsubscribe throws', async () => {
      context.syncService['addressToWalletMap'].set('addr-1', 'wallet-1');
      mockElectrumClient.unsubscribeAddress.mockRejectedValueOnce(new Error('unsubscribe failed'));

      await context.syncService['teardownRealTimeSubscriptions']();

      expect(context.syncService['addressToWalletMap'].size).toBe(0);
    });

    it('clears address map even when electrum client is unavailable during teardown', async () => {
      context.syncService['addressToWalletMap'].set('addr-no-client', 'wallet-1');
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await context.syncService['teardownRealTimeSubscriptions']();

      expect(context.syncService['addressToWalletMap'].size).toBe(0);
      expect(mockElectrumClient.removeAllListeners).not.toHaveBeenCalled();
    });

    it('returns early for subscribeNewWalletAddresses when ownership is not self', async () => {
      context.syncService['subscriptionOwnership'] = 'external';

      await context.syncService.subscribeNewWalletAddresses('wallet-x');

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('returns early for subscribeNewWalletAddresses when electrum client is unavailable', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await context.syncService.subscribeNewWalletAddresses('wallet-no-client');

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('continues subscribeNewWalletAddresses when one address subscription fails', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'tb1-new-1' },
        { address: 'tb1-new-2' },
      ]);
      mockElectrumClient.subscribeAddress
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce(undefined);

      await context.syncService.subscribeNewWalletAddresses('wallet-y');

      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('skips subscribe calls for addresses that are already tracked', async () => {
      context.syncService['subscriptionOwnership'] = 'self';
      context.syncService['addressToWalletMap'].set('tb1-existing', 'wallet-z');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'tb1-existing' },
      ]);

      await context.syncService.subscribeNewWalletAddresses('wallet-z');

      expect(mockElectrumClient.subscribeAddress).not.toHaveBeenCalled();
    });
  });
}
