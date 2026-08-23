import { describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
  mockCallbacks,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import {
  acquireLock,
  LockAuthorityUnavailableError,
  releaseLock,
} from '../../../../src/infrastructure';
import { getElectrumClientForNetwork } from '../../../../src/services/bitcoin/electrum';
import { setCachedBlockHeight } from '../../../../src/services/bitcoin/blockchain';
import { walletRepository } from '../../../../src/repositories';

export function registerElectrumManagerStartContracts() {
  describe('start', () => {
    it('returns early when subscription lock is not acquired', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      await manager.start();

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
    });

    it('keeps ownership retry active when lock authority is unavailable', async () => {
      vi.mocked(acquireLock).mockRejectedValueOnce(
        new LockAuthorityUnavailableError('acquire'),
      );

      await expect(manager.start()).resolves.toBeUndefined();

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
    });

    it('propagates unexpected subscription lock acquisition errors', async () => {
      vi.mocked(acquireLock).mockRejectedValueOnce(
        new Error('unexpected acquisition failure'),
      );

      await expect(manager.start()).rejects.toThrow(
        'unexpected acquisition failure',
      );

      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(false);
    });

    it('returns early when start is called while ownership retry is already scheduled', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      await manager.start();
      await manager.start();

      expect(vi.mocked(acquireLock)).toHaveBeenCalledTimes(1);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
    });

    it('retries subscription ownership after an initial lock miss', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);

      await manager.start();

      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);

      await vi.advanceTimersByTimeAsync(15_000);

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.subscribeHeaders).toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(true);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(false);

      vi.useRealTimers();
    });

    it('handles unavailable authority during a scheduled ownership retry', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new LockAuthorityUnavailableError('acquire'));

      await manager.start();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
      expect(vi.mocked(acquireLock)).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does not retry ownership after explicit stop clears a pending retry', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      await manager.start();
      await manager.stop();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(vi.mocked(acquireLock)).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('does not schedule ownership retry when explicitly stopped or already retrying', () => {
      (manager as any).explicitlyStopped = true;

      (manager as any).startSubscriptionOwnershipRetry();

      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(false);

      (manager as any).explicitlyStopped = false;
      (manager as any).subscriptionLockRetryTimer = {} as NodeJS.Timeout;

      (manager as any).startSubscriptionOwnershipRetry();

      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
    });

    it('skips retry lock acquisition while a retry attempt is already in flight', async () => {
      (manager as any).subscriptionLockRetryInFlight = true;

      await (manager as any).tryAcquireSubscriptionOwnership();

      expect(vi.mocked(acquireLock)).not.toHaveBeenCalled();
    });

    it('releases a retry-acquired lock when explicit stop wins the race', async () => {
      const lock = { key: 'lock', token: 'token' } as any;
      vi.mocked(acquireLock).mockImplementationOnce(async () => {
        (manager as any).explicitlyStopped = true;
        return lock;
      });

      await (manager as any).tryAcquireSubscriptionOwnership();

      expect(vi.mocked(releaseLock)).toHaveBeenCalledWith(lock);
      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
    });

    it('releases an initially acquired lock when explicit stop wins the race', async () => {
      const lock = { key: 'lock', token: 'token' } as any;
      let finishAcquire!: (value: typeof lock) => void;
      vi.mocked(acquireLock).mockReturnValueOnce(
        new Promise((resolve) => { finishAcquire = resolve; }),
      );

      const startup = manager.start();
      await manager.stop();
      finishAcquire(lock);
      await startup;

      expect(vi.mocked(releaseLock)).toHaveBeenCalledWith(lock);
      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
    });

    it('rearms ownership retry when retry-acquired startup fails', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockRejectedValueOnce(new Error('address query failed'));

      await (manager as any).tryAcquireSubscriptionOwnership();

      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
      expect(vi.mocked(releaseLock)).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('connects to primary network and subscribes to headers', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock', token: 'token', expiresAt: Date.now() + 30_000, isLocal: false,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.subscribeHeaders).toHaveBeenCalled();
      expect(setCachedBlockHeight).toHaveBeenCalledWith(100000, 'mainnet');
      expect(manager.isConnected()).toBe(true);
    });

    it('connects every represented wallet network exactly once at startup', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(walletRepository.findRepresentedNetworks).mockResolvedValueOnce([
        'testnet',
        'testnet3',
        'mainnet',
        'testnet4',
        'signet',
        'regtest',
      ]);
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      expect(getElectrumClientForNetwork).toHaveBeenCalledTimes(5);
      expect(getElectrumClientForNetwork).toHaveBeenNthCalledWith(1, 'mainnet');
      expect(getElectrumClientForNetwork).toHaveBeenNthCalledWith(2, 'testnet3');
      expect(getElectrumClientForNetwork).toHaveBeenNthCalledWith(3, 'testnet4');
      expect(getElectrumClientForNetwork).toHaveBeenNthCalledWith(4, 'signet');
      expect(getElectrumClientForNetwork).toHaveBeenNthCalledWith(5, 'regtest');
      expect(manager.getManagedNetworks()).toEqual([
        'mainnet', 'testnet3', 'testnet4', 'signet', 'regtest',
      ]);
    });

    it('fails startup closed before connecting an invalid persisted wallet network', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(walletRepository.findRepresentedNetworks).mockResolvedValueOnce(['unknown']);

      await expect(manager.start()).rejects.toThrow('Invalid persisted Bitcoin network');

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(manager.isSubscriptionOwner()).toBe(false);
    });

    it('publishes network readiness before initial address subscription', async () => {
      const onNetworkReady = vi.fn().mockResolvedValue(undefined);
      const onSubscriptionStatuses = vi.fn().mockResolvedValue(undefined);
      mockCallbacks.onNetworkReady = onNetworkReady;
      mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'address-1', address: 'bc1qready', walletId: 'wallet-1',
        wallet: { network: 'mainnet' },
      }] as any);

      try {
        await manager.start();

        expect(onNetworkReady).toHaveBeenCalledWith('mainnet');
        expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['bc1qready']);
        expect(onNetworkReady).toHaveBeenCalledBefore(mockClient.subscribeAddressBatch);
        expect(onSubscriptionStatuses).toHaveBeenCalledOnce();
        expect(onSubscriptionStatuses).toHaveBeenCalledWith(
          'mainnet',
          new Map([['bc1qready', 'status']]),
        );
      } finally {
        delete mockCallbacks.onNetworkReady;
        delete mockCallbacks.onSubscriptionStatuses;
      }
    });

    it('does not publish network readiness when the primary connection fails', async () => {
      const onNetworkReady = vi.fn().mockResolvedValue(undefined);
      mockCallbacks.onNetworkReady = onNetworkReady;
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      mockClient.connect.mockRejectedValueOnce(new Error('primary unavailable'));
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      try {
        await manager.start();
        expect(onNetworkReady).not.toHaveBeenCalled();
      } finally {
        delete mockCallbacks.onNetworkReady;
      }
    });

    it('stops startup when ownership is lost during network readiness', async () => {
      let finishReady!: () => void;
      mockCallbacks.onNetworkReady = vi.fn(() => new Promise<void>((resolve) => {
        finishReady = resolve;
      }));
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);

      const startup = manager.start();
      await vi.waitFor(() => {
        expect(mockCallbacks.onNetworkReady).toHaveBeenCalledOnce();
      });
      await manager.stop();
      finishReady();
      await startup;

      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
      delete mockCallbacks.onNetworkReady;
    });

    it('stops startup when ownership is lost during initial address subscription', async () => {
      let finishSubscription!: (statuses: Map<string, string | null>) => void;
      mockClient.subscribeAddressBatch.mockReturnValueOnce(
        new Promise<Map<string, string | null>>((resolve) => {
          finishSubscription = resolve;
        }),
      );
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'address-1', address: 'bc1qready', walletId: 'wallet-1',
        wallet: { network: 'mainnet' },
      }] as any);

      const startup = manager.start();
      await vi.waitFor(() => {
        expect(mockClient.subscribeAddressBatch).toHaveBeenCalledOnce();
      });
      await manager.stop();
      finishSubscription(new Map([['bc1qready', 'status']]));
      await startup;

      expect(manager.getHealthMetrics().isRunning).toBe(false);
    });

    it('does not install health checks when ownership changes as the final page completes', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      const finalPage = new Proxy([], {
        get(target, property, receiver) {
          if (property === 'length') {
            (manager as any).isRunningFlag = false;
            (manager as any).subscriptionLock = null;
            (manager as any).ownershipEpoch += 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce(finalPage as any);

      await manager.start();

      expect((manager as any).healthCheckTimer).toBeNull();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
    });

    it('returns early when start is called while manager is already running', async () => {
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);

      await manager.start();
      await manager.start();

      expect(getElectrumClientForNetwork).toHaveBeenCalledTimes(1);
    });
  });
}
