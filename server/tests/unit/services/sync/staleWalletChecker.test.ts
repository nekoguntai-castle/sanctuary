import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReset, mockUpdate, mockPublish, mockWithLock, mockLogger } = vi.hoisted(() => ({
  mockReset: vi.fn<() => Promise<number>>(),
  mockUpdate: vi.fn(),
  mockPublish: vi.fn(),
  mockWithLock: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../src/models/prisma', () => ({ default: {} }));
vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    resetAllStuckSyncFlags: mockReset,
  },
}));
vi.mock('../../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: { reset: mockUpdate },
}));
vi.mock('../../../../src/infrastructure', () => ({ withLock: mockWithLock }));
vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: mockPublish },
}));
vi.mock('../../../../src/utils/logger', () => ({ createLogger: () => mockLogger }));
vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock('../../../../src/config', () => ({
  getConfig: () => ({ sync: { maxSyncDurationMs: 120_000 } }),
}));

import {
  clearStuckSyncIfAuthorized,
  resetStuckSyncs,
} from '../../../../src/services/sync/staleWalletChecker';
import { metricsService } from '../../../../src/observability/metrics';

const clearedState = {
  syncInProgress: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  lastSyncFailureClass: null,
  syncExecutionOwner: null,
  syncRetryCount: 0,
  syncNextRetryAt: null,
  syncStartedAt: null,
  syncStateVersion: 2,
};

describe('staleWalletChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsService.reset();
    mockWithLock.mockImplementation(async (_key, _ttl, callback) => ({
      success: true,
      result: await callback(),
    }));
    mockUpdate.mockResolvedValue(clearedState);
  });

  describe('resetStuckSyncs', () => {
    it('reports cleared startup compatibility flags', async () => {
      mockReset.mockResolvedValue(3);
      await resetStuckSyncs();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Reset 3 stuck sync flags'));
      await expect(metricsService.getMetrics()).resolves.toContain(
        'sanctuary_wallet_sync_cleanup_total{outcome="flag_cleared"} 3',
      );
    });

    it('stays quiet when no flags were cleared', async () => {
      mockReset.mockResolvedValue(0);
      await resetStuckSyncs();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('logs repository failure without failing startup', async () => {
      mockReset.mockRejectedValue(new Error('DB error'));
      await expect(resetStuckSyncs()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reset stuck sync flags'),
        expect.any(Object),
      );
      await expect(metricsService.getMetrics()).resolves.toContain(
        'sanctuary_wallet_sync_cleanup_total{outcome="error"} 1',
      );
    });
  });

  describe('clearStuckSyncIfAuthorized', () => {
    it('rejects API-local and unversioned candidates before taking a lock', async () => {
      await expect(clearStuckSyncIfAuthorized(
        { id: 'active', syncStateVersion: 1 },
        new Set(['active']),
      )).resolves.toBe(false);
      await expect(clearStuckSyncIfAuthorized({ id: 'unversioned' }, new Set()))
        .resolves.toBe(false);
      await expect(clearStuckSyncIfAuthorized({
        id: 'incomplete', syncStateVersion: 1,
      }, new Set())).resolves.toBe(false);
      expect(mockWithLock).not.toHaveBeenCalled();
    });

    it('keeps a fresh worker-owned attempt', async () => {
      await expect(clearStuckSyncIfAuthorized({
        id: 'worker-wallet',
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date(),
        syncStateVersion: 1,
      }, new Set())).resolves.toBe(false);
      expect(mockWithLock).not.toHaveBeenCalled();
    });

    it.each([null, new Date(Date.now() - 600_000)])(
      'clears an expired worker attempt with lock and version authority (%s)',
      async syncStartedAt => {
        await expect(clearStuckSyncIfAuthorized({
          id: 'worker-wallet',
          syncExecutionOwner: 'worker',
          syncStartedAt,
          syncStateVersion: 1,
        }, new Set())).resolves.toBe(true);
        expect(mockUpdate).toHaveBeenCalledWith('worker-wallet', {
          syncStateVersion: 1,
          syncExecutionOwner: 'worker',
          syncStartedAt,
        });
        expect(mockPublish).toHaveBeenCalledWith({
          walletId: 'worker-wallet',
          transition: 'cleared',
          state: clearedState,
        });
        await expect(metricsService.getMetrics()).resolves.toContain(
          'sanctuary_wallet_sync_cleanup_total{outcome="flag_cleared"} 1',
        );
      },
    );

    it('clears a versioned compatibility inline attempt under its lock', async () => {
      await expect(clearStuckSyncIfAuthorized({
        id: 'inline-wallet',
        syncExecutionOwner: 'inline',
        syncStartedAt: null,
        syncStateVersion: 4,
      }, new Set())).resolves.toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('inline-wallet', {
        syncStateVersion: 4,
        syncExecutionOwner: 'inline',
        syncStartedAt: null,
      });
    });

    it.each([
      [{ success: false }, 'lock_present_deferred'],
      [{ success: true, result: null }, 'no_change'],
    ] as const)(
      'does not publish without an authoritative clear: $1',
      async (result, outcome) => {
        mockWithLock.mockResolvedValueOnce(result);
        await expect(clearStuckSyncIfAuthorized({
          id: 'candidate',
          syncExecutionOwner: null,
          syncStartedAt: null,
          syncStateVersion: 1,
        }, new Set())).resolves.toBe(false);
        expect(mockPublish).not.toHaveBeenCalled();
        await expect(metricsService.getMetrics()).resolves.toContain(
          `sanctuary_wallet_sync_cleanup_total{outcome="${outcome}"} 1`,
        );
      },
    );

    it('fails closed when distributed lock authority is unavailable', async () => {
      mockWithLock.mockRejectedValueOnce(new Error('redis unavailable'));
      await expect(clearStuckSyncIfAuthorized({
        id: 'candidate',
        syncExecutionOwner: null,
        syncStartedAt: null,
        syncStateVersion: 1,
      }, new Set())).resolves.toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('counts the durable clear once when lifecycle publication fails afterward', async () => {
      mockPublish.mockRejectedValueOnce(new Error('publisher unavailable'));

      await expect(clearStuckSyncIfAuthorized({
        id: 'candidate',
        syncExecutionOwner: null,
        syncStartedAt: null,
        syncStateVersion: 1,
      }, new Set())).resolves.toBe(false);

      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain(
        'sanctuary_wallet_sync_cleanup_total{outcome="flag_cleared"} 1',
      );
      expect(metrics).not.toContain('sanctuary_wallet_sync_cleanup_total{outcome="error"}');
    });
  });
});
