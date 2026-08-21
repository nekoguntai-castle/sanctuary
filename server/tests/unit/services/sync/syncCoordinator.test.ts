import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findByIdWithAccess: vi.fn(),
  findByNetworkWithSyncStatus: vi.fn(),
  findAccessibleWithSelect: vi.fn(),
  enqueueFullResyncBatch: vi.fn(),
  refreshWalletConfirmations: vi.fn(),
  clearActiveSyncAttempt: vi.fn(),
  publishLifecycle: vi.fn(),
}));

const confirmationErrors = vi.hoisted(() => {
  class ConfirmationLockUnavailableError extends Error {}
  class ConfirmationRefreshError extends Error {
    constructor(readonly cause: unknown) {
      super('confirmation refresh failed');
    }
  }
  return { ConfirmationLockUnavailableError, ConfirmationRefreshError };
});

vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    findByIdWithAccess: mocks.findByIdWithAccess,
    findByNetworkWithSyncStatus: mocks.findByNetworkWithSyncStatus,
    findAccessibleWithSelect: mocks.findAccessibleWithSelect,
  },
}));

vi.mock('../../../../src/services/sync/confirmationUpdater', () => ({
  ConfirmationLockUnavailableError: confirmationErrors.ConfirmationLockUnavailableError,
  ConfirmationRefreshError: confirmationErrors.ConfirmationRefreshError,
  refreshWalletConfirmations: mocks.refreshWalletConfirmations,
}));

vi.mock('../../../../src/services/sync/syncAttemptLifecycle', () => ({
  clearActiveSyncAttempt: mocks.clearActiveSyncAttempt,
}));

vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: mocks.publishLifecycle },
}));

vi.mock('../../../../src/services/workerSyncQueue', () => ({
  enqueueFullResyncBatch: mocks.enqueueFullResyncBatch,
}));

import { getSyncCoordinator, resetSyncCoordinatorForTests } from '../../../../src/services/sync/syncCoordinator';

describe('SyncCoordinator.resyncNetwork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncCoordinatorForTests();
    mocks.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
    mocks.refreshWalletConfirmations.mockResolvedValue({
      confirmationUpdates: [],
    });
    mocks.clearActiveSyncAttempt.mockResolvedValue({
      walletId: 'wallet-1',
      transition: 'cleared',
      state: { syncStateVersion: 4 },
    });
    mocks.findByNetworkWithSyncStatus.mockResolvedValue([
      { id: 'wallet-1', syncInProgress: false },
      { id: 'wallet-2', syncInProgress: false },
    ]);
    mocks.findAccessibleWithSelect.mockResolvedValue([]);
    mocks.enqueueFullResyncBatch.mockResolvedValue({
      outcomes: [
        { walletId: 'wallet-1', status: 'accepted' },
        { walletId: 'wallet-2', status: 'deduplicated' },
      ],
      acceptedWalletIds: ['wallet-1'],
      deduplicatedWalletIds: ['wallet-2'],
      rejectedWallets: [],
      indeterminateWallets: [],
    });
  });

  it('keeps deduplicated wallets out of the queued set', async () => {
    const result = await getSyncCoordinator().resyncNetwork('user-1', 'mainnet', true);

    expect(result.queued).toBe(1);
    expect(result.walletIds).toEqual(['wallet-1']);
    expect(result.acceptedWalletIds).toEqual(['wallet-1']);
    expect(result.deduplicatedWalletIds).toEqual(['wallet-2']);
  });

  it('reports wallets excluded from the batch by network as their own bucket', async () => {
    mocks.findAccessibleWithSelect.mockResolvedValue([{ id: 'wallet-regtest' }]);

    const result = await getSyncCoordinator().resyncNetwork('user-1', 'mainnet', true);

    expect(result.excludedWallets).toEqual([
      { walletId: 'wallet-regtest', reason: 'network_not_syncable' },
    ]);
    expect(result.message).toContain('1 wallet not on a syncable network');
    expect(mocks.findAccessibleWithSelect).toHaveBeenCalledWith(
      'user-1',
      { id: true },
      { network: { notIn: ['mainnet', 'testnet3', 'testnet4', 'signet'] } },
    );
  });

  it('reports excluded wallets even when the requested network has none', async () => {
    mocks.findByNetworkWithSyncStatus.mockResolvedValue([]);
    mocks.findAccessibleWithSelect.mockResolvedValue([{ id: 'wallet-regtest' }]);

    const result = await getSyncCoordinator().resyncNetwork('user-1', 'mainnet', true);

    expect(result.queued).toBe(0);
    expect(result.excludedWallets).toEqual([
      { walletId: 'wallet-regtest', reason: 'network_not_syncable' },
    ]);
    expect(result.message).toContain('not on a syncable network');
    expect(mocks.enqueueFullResyncBatch).not.toHaveBeenCalled();
  });

  it('reports an empty network without an exclusion clause', async () => {
    mocks.findByNetworkWithSyncStatus.mockResolvedValue([]);

    const result = await getSyncCoordinator().resyncNetwork('user-1', 'signet', true);

    expect(result).toEqual({
      success: true,
      queued: 0,
      walletIds: [],
      acceptedWalletIds: [],
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
      message: 'No signet wallets found',
    });
  });

  it('still rejects a batch in which nothing was retained', async () => {
    mocks.enqueueFullResyncBatch.mockResolvedValue({
      outcomes: [{ walletId: 'wallet-1', status: 'rejected', reason: 'queue_error' }],
      acceptedWalletIds: [],
      deduplicatedWalletIds: [],
      rejectedWallets: [{ walletId: 'wallet-1', reason: 'queue_error' }],
      indeterminateWallets: [],
    });

    await expect(getSyncCoordinator().resyncNetwork('user-1', 'mainnet', true))
      .rejects.toThrow('Full resync queue is unavailable or could not be confirmed');
  });

  it('requires the confirmation flag', async () => {
    await expect(getSyncCoordinator().resyncNetwork('user-1', 'mainnet', false))
      .rejects.toThrow('X-Confirm-Resync');
  });

  it('projects the canonical wallet confirmation result into the existing API response', async () => {
    const confirmationUpdates = [
      { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 },
    ];
    mocks.refreshWalletConfirmations.mockResolvedValueOnce({ confirmationUpdates });

    await expect(
      getSyncCoordinator().updateWalletConfirmations('user-1', 'wallet-1'),
    ).resolves.toEqual({
      message: 'Confirmations updated',
      updated: confirmationUpdates,
    });
    expect(mocks.findByIdWithAccess).toHaveBeenCalledWith('wallet-1', 'user-1');
    expect(mocks.refreshWalletConfirmations).toHaveBeenCalledWith('wallet-1');
  });

  it('maps confirmation lock contention to the existing sync-in-progress API error', async () => {
    mocks.refreshWalletConfirmations.mockRejectedValueOnce(
      new confirmationErrors.ConfirmationRefreshError(
        new confirmationErrors.ConfirmationLockUnavailableError(),
      ),
    );

    await expect(
      getSyncCoordinator().updateWalletConfirmations('user-1', 'wallet-1'),
    ).rejects.toMatchObject({ statusCode: 503, code: 'SYNC_IN_PROGRESS' });
  });

  it('preserves non-contention confirmation refresh failures', async () => {
    const refreshError = new confirmationErrors.ConfirmationRefreshError(
      new Error('electrum unavailable'),
    );
    mocks.refreshWalletConfirmations.mockRejectedValueOnce(refreshError);

    await expect(
      getSyncCoordinator().updateWalletConfirmations('user-1', 'wallet-1'),
    ).rejects.toBe(refreshError);
  });

  it('publishes the exact persisted transition when manually resetting sync state', async () => {
    const transition = {
      walletId: 'wallet-1',
      transition: 'cleared',
      state: { syncStateVersion: 4 },
    };
    mocks.clearActiveSyncAttempt.mockResolvedValueOnce(transition);

    await expect(
      getSyncCoordinator().resetWalletSyncState('user-1', 'wallet-1'),
    ).resolves.toEqual({ success: true, message: 'Sync state reset' });

    expect(mocks.findByIdWithAccess).toHaveBeenCalledWith('wallet-1', 'user-1');
    expect(mocks.clearActiveSyncAttempt).toHaveBeenCalledWith(
      'wallet-1',
      expect.any(Object),
    );
    expect(mocks.publishLifecycle).toHaveBeenCalledWith(transition);
    expect(mocks.clearActiveSyncAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishLifecycle.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
