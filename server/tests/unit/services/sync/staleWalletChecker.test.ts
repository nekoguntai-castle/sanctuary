import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockResetAllStuckSyncFlags,
  mockFindStuckSyncing,
  mockFindStale,
  mockWalletUpdate,
  mockWithLock,
  mockLogger,
} = vi.hoisted(() => ({
  mockResetAllStuckSyncFlags: vi.fn<() => Promise<number>>(),
  mockFindStuckSyncing: vi.fn<() => Promise<Array<{
    id: string;
    name: string;
    syncExecutionOwner?: string | null;
    syncStartedAt?: Date | null;
    syncStateVersion?: number;
  }>>>(),
  mockFindStale: vi.fn<(options: unknown) => Promise<Array<{ id: string }>>>(),
  mockWalletUpdate: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
  mockWithLock: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: {},
}));

vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    resetAllStuckSyncFlags: mockResetAllStuckSyncFlags,
    findStuckSyncing: mockFindStuckSyncing,
    findStale: mockFindStale,
    clearSyncStateIfUnchanged: mockWalletUpdate,
  },
}));

vi.mock('../../../../src/infrastructure', () => ({
  withLock: mockWithLock,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../../../../src/config', () => ({
  getConfig: () => ({
    sync: {
      staleThresholdMs: 300_000, // 5 minutes
      maxSyncDurationMs: 120_000,
    },
  }),
}));

import { resetStuckSyncs, checkAndQueueStaleSyncs } from '../../../../src/services/sync/staleWalletChecker';
import type { SyncState } from '../../../../src/services/sync/types';

const makeSyncState = (overrides: Partial<SyncState> = {}): SyncState => ({
  isRunning: true,
  syncQueue: [],
  activeSyncs: new Set(),
  activeLocks: new Map(),
  addressToWalletMap: new Map(),
  pendingRetries: new Map(),
  subscriptionLock: null,
  subscriptionLockRefresh: null,
  subscriptionsEnabled: false,
  subscriptionOwnership: 'disabled',
  subscribedToHeaders: false,
  pollingMode: 'in-process',
  ...overrides,
});

describe('staleWalletChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithLock.mockImplementation(async (_key, _ttl, callback) => ({
      success: true,
      result: await callback(),
    }));
    mockWalletUpdate.mockResolvedValue(true);
  });

  describe('resetStuckSyncs', () => {
    it('resets wallets with syncInProgress=true', async () => {
      mockResetAllStuckSyncFlags.mockResolvedValue(3);

      await resetStuckSyncs();

      expect(mockResetAllStuckSyncFlags).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reset 3 stuck sync flags'),
      );
    });

    it('does not log when no stuck syncs found', async () => {
      mockResetAllStuckSyncFlags.mockResolvedValue(0);

      await resetStuckSyncs();

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      mockResetAllStuckSyncFlags.mockRejectedValue(new Error('DB error'));

      await resetStuckSyncs();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reset stuck sync flags'),
        expect.any(Object),
      );
    });
  });

  describe('checkAndQueueStaleSyncs', () => {
    it('returns early when isRunning is false', async () => {
      const state = makeSyncState({ isRunning: false });
      const queueSync = vi.fn();

      await checkAndQueueStaleSyncs(state, queueSync);

      expect(mockFindStuckSyncing).not.toHaveBeenCalled();
    });

    it('unstucks wallets marked as syncing but not in activeSyncs', async () => {
      const state = makeSyncState({
        activeSyncs: new Set(['w2']),
      });

      // Stuck wallets
      mockFindStuckSyncing.mockResolvedValueOnce([
        { id: 'w1', name: 'Stuck Wallet', syncStateVersion: 1 },
        { id: 'w2', name: 'Active Wallet', syncStateVersion: 1 }, // this one IS in activeSyncs
      ]);
      // Stale wallets
      mockFindStale.mockResolvedValueOnce([]);
      const queueSync = vi.fn();
      await checkAndQueueStaleSyncs(state, queueSync);

      // Only w1 should be unstuck (w2 is genuinely syncing)
      expect(mockWalletUpdate).toHaveBeenCalledTimes(1);
      expect(mockWalletUpdate).toHaveBeenCalledWith({
        id: 'w1',
        syncExecutionOwner: null,
        syncStartedAt: null,
        syncStateVersion: 1,
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Auto-unstuck 1 wallets'),
      );
    });

    it('queues stale wallets for low-priority sync', async () => {
      const state = makeSyncState();

      // No stuck wallets
      mockFindStuckSyncing.mockResolvedValueOnce([]);
      // Stale wallets
      mockFindStale.mockResolvedValueOnce([
        { id: 'w1' },
        { id: 'w2' },
      ]);

      const queueSync = vi.fn();
      await checkAndQueueStaleSyncs(state, queueSync);

      expect(queueSync).toHaveBeenCalledWith('w1', 'low');
      expect(queueSync).toHaveBeenCalledWith('w2', 'low');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Queued 2 stale wallets'),
      );
    });

    it('keeps a fresh worker-owned attempt absent from API-local activity', async () => {
      mockFindStuckSyncing.mockResolvedValueOnce([{
        id: 'worker-wallet',
        name: 'Worker Wallet',
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(),
        syncStateVersion: 1,
      }]);
      mockFindStale.mockResolvedValueOnce([]);

      await checkAndQueueStaleSyncs(makeSyncState(), vi.fn());

      expect(mockWalletUpdate).not.toHaveBeenCalled();
      expect(mockWithLock).not.toHaveBeenCalled();
    });

    it('recovers an expired worker-owned row only when its lock is absent', async () => {
      mockFindStuckSyncing.mockResolvedValueOnce([{
        id: 'worker-wallet',
        name: 'Worker Wallet',
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(Date.now() - 600_000),
        syncStateVersion: 1,
      }]);
      mockFindStale.mockResolvedValueOnce([]);

      await checkAndQueueStaleSyncs(makeSyncState(), vi.fn());

      expect(mockWithLock).toHaveBeenCalledWith(
        'sync:wallet:worker-wallet',
        30_000,
        expect.any(Function),
      );
      expect(mockWalletUpdate).toHaveBeenCalledWith(expect.objectContaining({
        id: 'worker-wallet',
        syncExecutionOwner: 'worker',
        syncStateVersion: 1,
      }));
    });

    it('fails closed when worker lock authority is unavailable', async () => {
      mockFindStuckSyncing.mockResolvedValueOnce([{
        id: 'worker-wallet',
        name: 'Worker Wallet',
        syncExecutionOwner: 'worker',
        syncStartedAt: null,
        syncStateVersion: 1,
      }]);
      mockFindStale.mockResolvedValueOnce([]);
      mockWithLock.mockRejectedValueOnce(new Error('redis unavailable'));

      await checkAndQueueStaleSyncs(makeSyncState(), vi.fn());

      expect(mockWalletUpdate).not.toHaveBeenCalled();
    });

    it('does not clear a remote inline attempt while its distributed lock is held', async () => {
      mockFindStuckSyncing.mockResolvedValueOnce([{
        id: 'inline-wallet',
        name: 'Remote Inline Wallet',
        syncExecutionOwner: 'inline',
        syncStartedAt: new Date(),
        syncStateVersion: 1,
      }]);
      mockFindStale.mockResolvedValueOnce([]);
      mockWithLock.mockResolvedValueOnce({ success: false });

      await checkAndQueueStaleSyncs(makeSyncState(), vi.fn());

      expect(mockWalletUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when a candidate lacks an observed state version', async () => {
      mockFindStuckSyncing.mockResolvedValueOnce([{
        id: 'unversioned-wallet',
        name: 'Unversioned Wallet',
        syncExecutionOwner: 'inline',
      }]);
      mockFindStale.mockResolvedValueOnce([]);

      await checkAndQueueStaleSyncs(makeSyncState(), vi.fn());

      expect(mockWithLock).not.toHaveBeenCalled();
      expect(mockWalletUpdate).not.toHaveBeenCalled();
    });

    it('does not report a clear when the observed state version changed', async () => {
      mockFindStuckSyncing.mockResolvedValueOnce([{
        id: 'changed-wallet',
        name: 'Changed Wallet',
        syncExecutionOwner: 'inline',
        syncStartedAt: null,
        syncStateVersion: 4,
      }]);
      mockFindStale.mockResolvedValueOnce([]);
      mockWalletUpdate.mockResolvedValueOnce(false);

      await checkAndQueueStaleSyncs(makeSyncState(), vi.fn());

      expect(mockWalletUpdate).toHaveBeenCalledWith(expect.objectContaining({
        id: 'changed-wallet',
        syncStateVersion: 4,
      }));
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Auto-unstuck'),
      );
    });

    it('does not log when no stale wallets found', async () => {
      const state = makeSyncState();

      mockFindStuckSyncing.mockResolvedValueOnce([]);
      mockFindStale.mockResolvedValueOnce([]);

      const queueSync = vi.fn();
      await checkAndQueueStaleSyncs(state, queueSync);

      expect(queueSync).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      const state = makeSyncState();
      mockFindStuckSyncing.mockRejectedValue(new Error('DB error'));

      const queueSync = vi.fn();
      await checkAndQueueStaleSyncs(state, queueSync);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check for stale syncs'),
        expect.any(Object),
      );
    });

    it('does not log unstuck when none were stuck', async () => {
      const state = makeSyncState();

      mockFindStuckSyncing.mockResolvedValueOnce([]);
      mockFindStale.mockResolvedValueOnce([]);

      await checkAndQueueStaleSyncs(state, vi.fn());

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
