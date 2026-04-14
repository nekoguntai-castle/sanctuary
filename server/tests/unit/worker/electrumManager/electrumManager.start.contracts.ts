import { describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { acquireLock, releaseLock } from '../../../../src/infrastructure';
import { getElectrumClientForNetwork } from '../../../../src/services/bitcoin/electrum';
import { setCachedBlockHeight } from '../../../../src/services/bitcoin/blockchain';

export function registerElectrumManagerStartContracts() {
  describe('start', () => {
    it('returns early when subscription lock is not acquired', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      await manager.start();

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
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
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.subscribeHeaders).toHaveBeenCalled();
      expect(setCachedBlockHeight).toHaveBeenCalledWith(100000, 'mainnet');
      expect(manager.isConnected()).toBe(true);
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
