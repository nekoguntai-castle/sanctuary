import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

import { correctTransactionToConsolidation } from '../../../src/repositories/balanceCorrectionRepository';

describe('balanceCorrectionRepository', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  it('updates the parent and every wallet-address output in one transaction', async () => {
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });

    await expect(correctTransactionToConsolidation(
      'tx-1',
      BigInt(-50),
      ['wallet-a', 'wallet-b'],
    )).resolves.toBe(true);

    expect(mockPrismaClient.transactionOutput.updateMany).toHaveBeenCalledWith({
      where: {
        transactionId: 'tx-1',
        address: { in: ['wallet-a', 'wallet-b'] },
      },
      data: { isOurs: true, outputType: 'consolidation' },
    });
  });

  it('does not touch outputs when the parent no longer needs correction', async () => {
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 0 });

    await expect(correctTransactionToConsolidation(
      'tx-1',
      BigInt(0),
      ['wallet-a'],
    )).resolves.toBe(false);
    expect(mockPrismaClient.transactionOutput.updateMany).not.toHaveBeenCalled();
  });

  it('propagates output failures through the shared transaction', async () => {
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });
    mockPrismaClient.transactionOutput.updateMany.mockRejectedValue(new Error('output failed'));

    await expect(correctTransactionToConsolidation(
      'tx-1',
      BigInt(0),
      ['wallet-a'],
    )).rejects.toThrow('output failed');
  });
});
