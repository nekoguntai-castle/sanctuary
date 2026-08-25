import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batchUpdateByIds: vi.fn(),
  walletLog: vi.fn(),
  withWalletSyncMutationFence: vi.fn(),
  withWalletSyncMutationLock: vi.fn(),
}));

vi.mock('../../../../../../src/repositories', () => ({
  transactionRepository: { batchUpdateByIds: mocks.batchUpdateByIds },
}));

vi.mock('../../../../../../src/config', () => ({
  getConfig: () => ({ sync: { transactionBatchSize: 1 } }),
}));

vi.mock('../../../../../../src/websocket/notifications', () => ({
  walletLog: mocks.walletLog,
}));

vi.mock('../../../../../../src/repositories/syncIntentRepository', () => ({
  withWalletSyncMutationFence: mocks.withWalletSyncMutationFence,
  withWalletSyncMutationLock: mocks.withWalletSyncMutationLock,
}));

import { executeInChunks } from '../../../../../../src/services/bitcoin/sync/confirmations/batchUpdates';

describe('confirmation batch updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withWalletSyncMutationFence.mockImplementation(
      async (_fence, callback) => callback({ transaction: {} }),
    );
    mocks.withWalletSyncMutationLock.mockImplementation(
      async (_walletId, assertAuthority, callback) => {
        assertAuthority();
        return callback({ transaction: {} });
      },
    );
  });

  it('reports each batch only after it commits and retains earlier commit evidence on failure', async () => {
    const failure = new Error('second batch failed');
    mocks.batchUpdateByIds
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);
    const first = { id: 'one', data: { confirmations: 1 } };
    const second = { id: 'two', data: { confirmations: 2 } };
    const onChunkCommitted = vi.fn();

    await expect(executeInChunks(
      [first, second],
      'wallet-1',
      onChunkCommitted,
    )).rejects.toBe(failure);

    expect(onChunkCommitted).toHaveBeenCalledOnce();
    expect(onChunkCommitted).toHaveBeenCalledWith([first]);
    expect(mocks.walletLog).toHaveBeenCalledWith(
      'wallet-1',
      'debug',
      'DB',
      expect.stringContaining('Processing batch 1/2'),
    );
  });

  it('commits a chunk when no post-commit observer is registered', async () => {
    const item = { id: 'one', data: { confirmations: 1 } };

    await expect(executeInChunks([item], 'wallet-1')).resolves.toBeUndefined();

    expect(mocks.batchUpdateByIds).toHaveBeenCalledWith(
      [item],
      1,
      undefined,
    );
    expect(mocks.walletLog).not.toHaveBeenCalled();
  });

  it('requires a wallet target for a fenced chunk', async () => {
    await expect(executeInChunks(
      [{ id: 'one', data: {} }],
      undefined,
      undefined,
      undefined,
      { walletId: 'wallet-1', generation: 1, leaseToken: 'a'.repeat(64) },
    )).rejects.toThrow('require a target wallet ID');

    expect(mocks.batchUpdateByIds).not.toHaveBeenCalled();
  });

  it('uses a supplied fence and cancellation signal for a targeted chunk', async () => {
    const item = { id: 'one', data: { confirmations: 1 } };
    const signal = new AbortController().signal;
    const fence = { walletId: 'wallet-1', generation: 1, leaseToken: 'a'.repeat(64) };

    await executeInChunks([item], 'wallet-1', undefined, signal, fence);

    expect(mocks.withWalletSyncMutationFence).toHaveBeenCalledWith(
      fence,
      expect.any(Function),
    );
    expect(mocks.batchUpdateByIds).toHaveBeenCalledWith(
      [item],
      1,
      expect.objectContaining({ transaction: {} }),
    );
  });

  it('rechecks cancellation after acquiring the compatibility wallet lock', async () => {
    const controller = new AbortController();
    const reason = new Error('wallet lease lost while waiting for its row');
    mocks.withWalletSyncMutationLock.mockImplementationOnce(
      async (_walletId, assertAuthority) => {
        controller.abort(reason);
        assertAuthority();
      },
    );

    await expect(executeInChunks(
      [{ id: 'one', data: { confirmations: 1 } }],
      'wallet-1',
      undefined,
      controller.signal,
      undefined,
      true,
    )).rejects.toBe(reason);

    expect(mocks.batchUpdateByIds).not.toHaveBeenCalled();
  });

  it('retains compatibility behavior without a wallet target or fence', async () => {
    await executeInChunks([{ id: 'one', data: {} }]);

    expect(mocks.batchUpdateByIds).toHaveBeenCalledWith(
      [{ id: 'one', data: {} }],
      1,
      undefined,
    );
  });
});
