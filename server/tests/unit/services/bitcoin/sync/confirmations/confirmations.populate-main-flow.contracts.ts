import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetNodeClient, mockRecalculateWalletBalances } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsMainFlowContracts() {
  it('populates block/fee/address fields, uses history + prev tx cache, and recalculates balances when amount changes', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async (address: string) => {
        if (address === 'wallet-addr') {
          return [{ tx_hash: 'tx-recv-nodetails', height: 995 }];
        }
        return [];
      }),
      getTransaction: vi.fn(async (txid: string) => {
        const txMap: Record<string, unknown> = {
          'tx-sent': {
            confirmations: 2,
            vin: [{ txid: 'prev-fee', vout: 0 }],
            vout: [
              { value: 0.0009, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } },
              { value: 0.00005, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } },
            ],
          },
          'tx-recv-nodetails': null,
          'tx-recv-detailed': {
            time: 1700000000,
            vin: [
              {
                prevout: {
                  value: 0.0004,
                  scriptPubKey: { address: 'sender-addr', addresses: ['sender-addr'] },
                },
              },
            ],
            vout: [{ value: 0.0003, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'tx-consolidate': {
            blockheight: 999,
            fee: 0.00002,
            vin: [
              {
                prevout: {
                  value: 0.001,
                  scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
                },
              },
            ],
            vout: [{ value: 0.00098, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'prev-fee': {
            vout: [{ value: 0.001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
        };
        return (txMap[txid] as any) ?? null;
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        txid: 'tx-sent',
        type: 'sent',
        amount: BigInt(-95000),
        fee: null,
        blockHeight: null,
        blockTime: null,
        confirmations: 0,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't2',
        txid: 'tx-recv-nodetails',
        type: 'received',
        amount: BigInt(30000),
        fee: null,
        blockHeight: null,
        blockTime: null,
        confirmations: 0,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't3',
        txid: 'tx-recv-detailed',
        type: 'received',
        amount: BigInt(30000),
        fee: null,
        blockHeight: 997,
        blockTime: null,
        confirmations: 4,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't4',
        txid: 'tx-consolidate',
        type: 'consolidation',
        amount: BigInt(0),
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
      { id: 'addr-2', address: 'change-addr' },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(4);
    expect(result.confirmationUpdates).toEqual([
      { txid: 'tx-sent', oldConfirmations: 0, newConfirmations: 2 },
      { txid: 'tx-recv-nodetails', oldConfirmations: 0, newConfirmations: 6 },
      { txid: 'tx-consolidate', oldConfirmations: 0, newConfirmations: 2 },
    ]);
    expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-fee', true);
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({
        blockHeight: 999,
        confirmations: 2,
        fee: BigInt(5000),
        counterpartyAddress: 'external-addr',
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: expect.objectContaining({
        blockHeight: 995,
        confirmations: 6,
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't3' },
      data: expect.objectContaining({
        counterpartyAddress: 'sender-addr',
        addressId: 'addr-1',
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't4' },
      data: expect.objectContaining({
        fee: BigInt(2000),
        amount: BigInt(-2000),
      }),
    });
    expect(mockRecalculateWalletBalances).toHaveBeenCalledWith('wallet-1');
  });
}
