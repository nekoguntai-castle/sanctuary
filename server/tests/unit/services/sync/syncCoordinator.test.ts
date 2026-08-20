import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findByNetworkWithSyncStatus: vi.fn(),
  findAccessibleWithSelect: vi.fn(),
  enqueueFullResyncBatch: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    findByNetworkWithSyncStatus: mocks.findByNetworkWithSyncStatus,
    findAccessibleWithSelect: mocks.findAccessibleWithSelect,
  },
}));

vi.mock('../../../../src/services/workerSyncQueue', () => ({
  enqueueFullResyncBatch: mocks.enqueueFullResyncBatch,
}));

import { getSyncCoordinator, resetSyncCoordinatorForTests } from '../../../../src/services/sync/syncCoordinator';

describe('SyncCoordinator.resyncNetwork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSyncCoordinatorForTests();
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
});
