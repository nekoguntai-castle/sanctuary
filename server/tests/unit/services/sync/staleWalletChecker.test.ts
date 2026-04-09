import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockWalletFindMany,
  mockWalletUpdate,
  mockWalletUpdateMany,
  mockLogger,
} = vi.hoisted(() => ({
  mockWalletFindMany: vi.fn<any>(),
  mockWalletUpdate: vi.fn<any>(),
  mockWalletUpdateMany: vi.fn<any>(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/repositories/db', () => ({
  db: {
    wallet: {
      findMany: (...args: unknown[]) => mockWalletFindMany(...args),
      update: (...args: unknown[]) => mockWalletUpdate(...args),
      updateMany: (...args: unknown[]) => mockWalletUpdateMany(...args),
    },
  },
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
  });

  describe('resetStuckSyncs', () => {
    it('resets wallets with syncInProgress=true', async () => {
      mockWalletUpdateMany.mockResolvedValue({ count: 3 });

      await resetStuckSyncs();

      expect(mockWalletUpdateMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        data: { syncInProgress: false },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reset 3 stuck sync flags'),
      );
    });

    it('does not log when no stuck syncs found', async () => {
      mockWalletUpdateMany.mockResolvedValue({ count: 0 });

      await resetStuckSyncs();

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      mockWalletUpdateMany.mockRejectedValue(new Error('DB error'));

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

      expect(mockWalletFindMany).not.toHaveBeenCalled();
    });

    it('unstucks wallets marked as syncing but not in activeSyncs', async () => {
      const state = makeSyncState({
        activeSyncs: new Set(['w2']),
      });

      // First call: stuck wallets
      mockWalletFindMany.mockResolvedValueOnce([
        { id: 'w1', name: 'Stuck Wallet' },
        { id: 'w2', name: 'Active Wallet' }, // this one IS in activeSyncs
      ]);
      // Second call: stale wallets
      mockWalletFindMany.mockResolvedValueOnce([]);
      mockWalletUpdate.mockResolvedValue({});

      const queueSync = vi.fn();
      await checkAndQueueStaleSyncs(state, queueSync);

      // Only w1 should be unstuck (w2 is genuinely syncing)
      expect(mockWalletUpdate).toHaveBeenCalledTimes(1);
      expect(mockWalletUpdate).toHaveBeenCalledWith({
        where: { id: 'w1' },
        data: { syncInProgress: false },
      });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Auto-unstuck 1 wallets'),
      );
    });

    it('queues stale wallets for low-priority sync', async () => {
      const state = makeSyncState();

      // First call: no stuck wallets
      mockWalletFindMany.mockResolvedValueOnce([]);
      // Second call: stale wallets
      mockWalletFindMany.mockResolvedValueOnce([
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

    it('does not log when no stale wallets found', async () => {
      const state = makeSyncState();

      mockWalletFindMany.mockResolvedValueOnce([]); // no stuck
      mockWalletFindMany.mockResolvedValueOnce([]); // no stale

      const queueSync = vi.fn();
      await checkAndQueueStaleSyncs(state, queueSync);

      expect(queueSync).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      const state = makeSyncState();
      mockWalletFindMany.mockRejectedValue(new Error('DB error'));

      const queueSync = vi.fn();
      await checkAndQueueStaleSyncs(state, queueSync);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check for stale syncs'),
        expect.any(Object),
      );
    });

    it('does not log unstuck when none were stuck', async () => {
      const state = makeSyncState();

      mockWalletFindMany.mockResolvedValueOnce([]); // no stuck
      mockWalletFindMany.mockResolvedValueOnce([]); // no stale

      await checkAndQueueStaleSyncs(state, vi.fn());

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
