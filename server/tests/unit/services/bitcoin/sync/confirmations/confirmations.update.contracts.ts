import { expect, it } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetBlockHeight, mockGetConfig, mockWalletLog } from './confirmationsTestHarness';
import { updateTransactionConfirmations } from '../../../../../../src/services/bitcoin/sync/confirmations';

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

    const updates = await updateTransactionConfirmations('wallet-1');

    expect(updates).toEqual([
      { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 },
      { txid: 'tx-3', oldConfirmations: 0, newConfirmations: 3 },
    ]);
    expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { confirmations: 1, rbfStatus: 'confirmed' },
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't3' },
      data: { confirmations: 3, rbfStatus: 'confirmed' },
    });
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'debug',
      'DB',
      expect.stringContaining('Processing batch')
    );
  });

  it('uses network fallback and skips zero-height/unchanged transactions without writes', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: '' });
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
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-already-confirmed' },
      data: { confirmations: 2 },
    });
  });
}
