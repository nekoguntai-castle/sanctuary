import { describe, expect, it, vi } from 'vitest';

// Phase 4 non-regression coverage for
// confirmation-refresh-lock-released-before-detached-writer-settles: the wallet
// sync lock must stay held until the executor's promise actually settles, even
// once the sync duration budget (plus the legacy abort grace window) has
// elapsed and the executor is still ignoring its AbortSignal.

const {
  mockUpdateTransactionConfirmations,
  mockPopulateMissingTransactionFields,
  mockAcquireLock,
  mockExtendLock,
  mockGetSyncLockTtlMs,
  mockReleaseLock,
  mockMaxSyncDurationMs,
} = vi.hoisted(() => ({
  mockUpdateTransactionConfirmations: vi.fn(),
  mockPopulateMissingTransactionFields: vi.fn(),
  mockAcquireLock: vi.fn(),
  mockExtendLock: vi.fn(),
  mockGetSyncLockTtlMs: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockMaxSyncDurationMs: vi.fn(),
}));

vi.mock('../../../../src/config', () => ({
  getConfig: () => ({ sync: { maxSyncDurationMs: mockMaxSyncDurationMs() } }),
}));

vi.mock('../../../../src/infrastructure', () => ({
  acquireLock: mockAcquireLock,
  extendLock: mockExtendLock,
  releaseLock: mockReleaseLock,
}));

vi.mock('../../../../src/jobs/syncJobContract', () => ({
  getSyncLockKey: ({ walletId }: { walletId: string }) => `sync:wallet:${walletId}`,
  getSyncLockTtlMs: mockGetSyncLockTtlMs,
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  updateTransactionConfirmations: mockUpdateTransactionConfirmations,
  populateMissingTransactionFields: mockPopulateMissingTransactionFields,
}));

vi.mock('../../../../src/services/bitcoin/sync/confirmations/updateConfirmations', () => ({
  updateTransactionConfirmationsAtHeight: vi.fn(),
}));

vi.mock('../../../../src/services/eventService', () => ({
  eventService: { emitTransactionConfirmed: vi.fn() },
}));

import {
  ConfirmationRefreshError,
  refreshWalletConfirmations,
} from '../../../../src/services/sync/confirmationUpdater';
import { SYNC_ABORT_GRACE_MS } from '../../../../src/services/sync/syncAttemptLifecycle';
import type { ConfirmationUpdate } from '../../../../src/services/bitcoin/blockchain';

describe('refreshWalletConfirmations settlement lock', () => {
  it('holds the wallet lock until a detached writer settles past the abort grace window', async () => {
    vi.useFakeTimers();
    try {
      mockAcquireLock.mockResolvedValue({ key: 'sync:wallet:wallet-1', token: 'token' });
      mockExtendLock.mockImplementation(async lock => lock);
      mockGetSyncLockTtlMs.mockReturnValue(120_000);
      mockReleaseLock.mockResolvedValue('deleted');
      mockMaxSyncDurationMs.mockReturnValue(1_000);
      mockPopulateMissingTransactionFields.mockResolvedValue({
        updated: 0,
        confirmationUpdates: [],
      });

      const executorSettled = vi.fn();
      let resolveUpdate!: (updates: ConfirmationUpdate[]) => void;
      // Never attaches an abort listener, so the timeout at maxSyncDurationMs
      // cannot make this promise settle on its own.
      mockUpdateTransactionConfirmations.mockImplementationOnce(() => new Promise(resolve => {
        resolveUpdate = (updates) => { executorSettled(); resolve(updates); };
      }));

      const refresh = refreshWalletConfirmations('wallet-1');
      const rejection = refresh.catch(error => error);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockReleaseLock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SYNC_ABORT_GRACE_MS + 1_000);
      expect(mockReleaseLock).not.toHaveBeenCalled();

      resolveUpdate([]);
      const error = await rejection;

      expect(mockReleaseLock).toHaveBeenCalledOnce();
      expect(executorSettled.mock.invocationCallOrder[0])
        .toBeLessThan(mockReleaseLock.mock.invocationCallOrder[0]);
      expect(error).toBeInstanceOf(ConfirmationRefreshError);
      expect(error.message).toContain('timed out after 1000ms');
      expect(error.partialResult).toMatchObject({ walletId: 'wallet-1', fieldUpdates: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
