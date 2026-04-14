import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetNodeClient, mockWalletLog } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsCoreContracts() {
  it('returns empty result when wallet does not exist', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockGetNodeClient).not.toHaveBeenCalled();
  });

  it('returns early when no incomplete transactions are found', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue({
      getAddressHistory: vi.fn(),
      getTransaction: vi.fn(),
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);
    mockPrismaClient.address.findMany.mockResolvedValue([]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'info',
      'POPULATE',
      'All transaction fields are complete'
    );
  });
}
