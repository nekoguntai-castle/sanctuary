import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetBlockTimestamp, mockGetNodeClient } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsNetworkHistoryContracts() {
  it('covers network fallback and blockTime derivation branches when wallet has no addresses', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => [{ tx_hash: 'tx-no-height', height: 0 }]),
      getTransaction: vi.fn(async (txid: string) => {
        if (txid === 'tx-no-height') {
          return {};
        }
        return { vin: [], vout: undefined };
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: '' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-no-height',
        txid: 'tx-no-height',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: null,
        blockTime: null,
        confirmations: 0,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-needs-timestamp',
        txid: 'tx-needs-timestamp',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: 999,
        blockTime: null,
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockGetBlockTimestamp.mockResolvedValue(null);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockGetNodeClient).toHaveBeenCalledWith('mainnet');
    expect(mockGetBlockTimestamp).toHaveBeenCalledWith(999, 'mainnet');
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
  });

  it('ignores non-positive heights from address history during block-height extraction', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => [{ tx_hash: 'tx-h0', height: 0 }]),
      getTransaction: vi.fn(async () => null),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-h0',
        txid: 'tx-h0',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: null,
        blockTime: null,
        confirmations: 0,
        addressId: null,
        counterpartyAddress: null,
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: 'wallet-addr' },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockClient.getAddressHistory).toHaveBeenCalledWith('wallet-addr');
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
  });
}
