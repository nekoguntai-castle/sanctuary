import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import {
  mockGetBlockHeight,
  mockGetConfig,
  mockGetNodeClient,
  mockWalletLog,
} from './confirmationsTestHarness';
import {
  updateTransactionConfirmations,
} from '../../../../../../src/services/bitcoin/sync/confirmations';
import {
  updateTransactionConfirmationsAtHeight,
} from '../../../../../../src/services/bitcoin/sync/confirmations/updateConfirmations';

function committedTransactionPatches(): Array<{ id: string; data: Record<string, unknown> }> {
  return mockPrismaClient.$executeRaw.mock.calls.flatMap(([query]) => {
    const values = (query as { values?: unknown[] }).values ?? [];
    const serialized = values.find(value => (
      typeof value === 'string' && value.startsWith('[{"id"')
    ));
    return typeof serialized === 'string' ? JSON.parse(serialized) : [];
  });
}

export function registerUpdateTransactionConfirmationsContracts() {
  it('returns empty when wallet does not exist', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const result = await updateTransactionConfirmations('wallet-1');

    expect(result).toEqual([]);
    expect(mockPrismaClient.systemSetting.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty when no transactions are eligible', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const result = await updateTransactionConfirmations('wallet-1');

    expect(result).toEqual([]);
    expect(mockGetBlockHeight).not.toHaveBeenCalled();
  });

  it('updates in chunks and marks newly confirmed tx as confirmed for RBF status', async () => {
    mockGetConfig.mockReturnValue({
      sync: { transactionBatchSize: 1 },
    });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't1', txid: 'tx-1', blockHeight: 1000, confirmations: 0 },
      { id: 't2', txid: 'tx-2', blockHeight: 999, confirmations: 2 },
      { id: 't3', txid: 'tx-3', blockHeight: 998, confirmations: 0 },
    ]);
    mockGetBlockHeight.mockResolvedValue(1000);

    const onCommit = vi.fn();
    const updates = await updateTransactionConfirmations(
      'wallet-1',
      new AbortController().signal,
      onCommit,
    );

    expect(updates).toEqual([
      { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 },
      { txid: 'tx-3', oldConfirmations: 0, newConfirmations: 3 },
    ]);
    expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
    expect(onCommit.mock.calls.map(([commit]) => commit)).toEqual([
      {
        updated: 0,
        confirmationUpdates: [
          { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 },
        ],
      },
      {
        updated: 0,
        confirmationUpdates: [
          { txid: 'tx-3', oldConfirmations: 0, newConfirmations: 3 },
        ],
      },
    ]);
    expect(committedTransactionPatches()).toEqual([
      { id: 't1', txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1,
        data: { confirmations: 1, rbfStatus: 'confirmed' } },
      { id: 't3', txid: 'tx-3', oldConfirmations: 0, newConfirmations: 3,
        data: { confirmations: 3, rbfStatus: 'confirmed' } },
    ]);
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'debug',
      'DB',
      expect.stringContaining('Processing batch')
    );
  });

  it('rejects an already-aborted refresh before reading wallet state', async () => {
    const controller = new AbortController();
    controller.abort(new Error('refresh lock lost'));

    await expect(updateTransactionConfirmations(
      'wallet-1',
      controller.signal,
    )).rejects.toThrow('refresh lock lost');

    expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
  });

  // This case previously mocked `network: ''` and asserted the tip was read from
  // 'mainnet', which pinned the fail-open fallback that
  // `config/wallet-sync-lifecycle-contract.json` forbids
  // (`invalidPersistedNetworkPolicy: fail_closed_without_mainnet_fallback`). An
  // empty persisted network now throws — see the persisted-network-resolution
  // contracts. The behaviour this case exists to cover, skipping zero-height and
  // unchanged transactions without writes, is unchanged and is exercised here
  // against a valid network.
  it('skips zero-height/unchanged transactions without writes', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't-zero', txid: 'tx-zero', blockHeight: 0, confirmations: 0 },
      { id: 't-same', txid: 'tx-same', blockHeight: 1000, confirmations: 1 },
    ]);
    mockGetBlockHeight.mockResolvedValue(1000);

    const updates = await updateTransactionConfirmations('wallet-1');

    expect(updates).toEqual([]);
    expect(mockGetBlockHeight).toHaveBeenCalledWith('mainnet');
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
  });

  it('updates confirmations without setting rbfStatus when tx was already confirmed', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't-already-confirmed', txid: 'tx-already-confirmed', blockHeight: 999, confirmations: 1 },
    ]);
    mockGetBlockHeight.mockResolvedValue(1000);

    const updates = await updateTransactionConfirmations('wallet-1');

    expect(updates).toEqual([
      { txid: 'tx-already-confirmed', oldConfirmations: 1, newConfirmations: 2 },
    ]);
    expect(committedTransactionPatches()).toEqual([{
      id: 't-already-confirmed', txid: 'tx-already-confirmed',
      oldConfirmations: 1, newConfirmations: 2, data: { confirmations: 2 },
    }]);
  });

  it('uses an authoritative lower height to reduce persisted confirmations only', async () => {
    const getAddressHistory = vi.fn();
    const getAddressHistoryBatch = vi.fn();
    mockGetNodeClient.mockReturnValue({ getAddressHistory, getAddressHistoryBatch });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't-reorged', txid: 'tx-reorged', blockHeight: 100, confirmations: 4 },
      { id: 't-unconfirmed', txid: 'tx-unconfirmed', blockHeight: 103, confirmations: 1 },
    ]);

    const updates = await updateTransactionConfirmationsAtHeight('wallet-1', 101);

    expect(updates).toEqual([
      { txid: 'tx-reorged', oldConfirmations: 4, newConfirmations: 2 },
      { txid: 'tx-unconfirmed', oldConfirmations: 1, newConfirmations: 0 },
    ]);
    expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
    expect(mockGetNodeClient).not.toHaveBeenCalled();
    expect(getAddressHistory).not.toHaveBeenCalled();
    expect(getAddressHistoryBatch).not.toHaveBeenCalled();
    expect(mockGetBlockHeight).not.toHaveBeenCalled();
    expect(committedTransactionPatches()).toEqual([
      { id: 't-reorged', txid: 'tx-reorged', oldConfirmations: 4,
        newConfirmations: 2, data: { confirmations: 2 } },
      { id: 't-unconfirmed', txid: 'tx-unconfirmed', oldConfirmations: 1,
        newConfirmations: 0, data: { confirmations: 0 } },
    ]);
  });

  it('does not mutate RBF state when an authoritative height first confirms a transaction', async () => {
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't-confirmed', txid: 'tx-confirmed', blockHeight: 100, confirmations: 0 },
    ]);

    await updateTransactionConfirmationsAtHeight('wallet-1', 100);

    expect(committedTransactionPatches()).toEqual([{
      id: 't-confirmed', txid: 'tx-confirmed', oldConfirmations: 0,
      newConfirmations: 1, data: { confirmations: 1 },
    }]);
  });

  it('skips an unchanged transaction selected for an explicit-height recheck', async () => {
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '6' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't-unchanged', txid: 'tx-unchanged', blockHeight: 96, confirmations: 5 },
    ]);

    await expect(updateTransactionConfirmationsAtHeight('wallet-1', 100)).resolves.toEqual([]);

    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
  });

  it('revisits a formerly deep transaction when a lower reconciled tip makes it pending again', async () => {
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '6' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't-deep-reorg', txid: 'tx-deep-reorg', blockHeight: 96, confirmations: 6 },
    ]);

    await expect(updateTransactionConfirmationsAtHeight('wallet-1', 100)).resolves.toEqual([
      { txid: 'tx-deep-reorg', oldConfirmations: 6, newConfirmations: 5 },
    ]);

    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-1',
        blockHeight: { not: null },
        OR: [
          { confirmations: { lt: 6 } },
          { blockHeight: { gt: 95 } },
        ],
      },
      select: { id: true, txid: true, blockHeight: true, confirmations: true },
    });
    expect(committedTransactionPatches()).toEqual([{
      id: 't-deep-reorg', txid: 'tx-deep-reorg', oldConfirmations: 6,
      newConfirmations: 5, data: { confirmations: 5 },
    }]);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid authoritative height %s before reading persisted state',
    async (height) => {
      await expect(updateTransactionConfirmationsAtHeight('wallet-1', height)).rejects.toThrow(
        'Authoritative block height must be a non-negative safe integer',
      );

      expect(mockPrismaClient.systemSetting.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
    },
  );
}
