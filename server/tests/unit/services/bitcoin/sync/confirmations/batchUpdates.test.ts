import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batchUpdateByIds: vi.fn(),
  walletLog: vi.fn(),
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

import { executeInChunks } from '../../../../../../src/services/bitcoin/sync/confirmations/batchUpdates';

describe('confirmation batch updates', () => {
  beforeEach(() => vi.clearAllMocks());

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
});
