import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetNodeClient } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsCounterpartyFallbacksContracts() {
  it('covers fee/counterparty/addressId fallback branches for sent, consolidation, and received txs', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async (txid: string) => {
        const txMap: Record<string, unknown> = {
          'tx-sent-fallbacks': {
            vin: [
              {
                prevout: {
                  value: 0.0001,
                  scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
                },
              },
              {},
              { txid: 'prev-missing', vout: 0 },
            ],
            vout: [
              { value: 0.0002, scriptPubKey: {} },
              { value: 0.0001, scriptPubKey: { addresses: ['external-by-array'] } },
            ],
          },
          'tx-consolidation-nonzero': {
            fee: 0.00001,
            vin: [
              {
                prevout: {
                  value: 0.001,
                  scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
                },
              },
            ],
            vout: [{ value: 0.00099, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'tx-recv-coinbase': {
            vin: [{ coinbase: true }],
            vout: [{ value: 0.0001, scriptPubKey: {} }],
          },
          'tx-recv-vout-missing': {
            vin: [],
          },
          'tx-recv-prevout-mix': {
            vin: [
              { prevout: { scriptPubKey: {} } },
              { prevout: { scriptPubKey: { addresses: ['sender-array'] } } },
            ],
            vout: [{ value: 0.0001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'tx-recv-prevtx-mix': {
            vin: [
              {},
              { txid: 'prev-none', vout: 0 },
              { txid: 'prev-array', vout: 0 },
            ],
            vout: [{ value: 0.0001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'prev-none': {
            vout: [{ value: 0.0001, scriptPubKey: {} }],
          },
          'prev-array': {
            vout: [{ value: 0.0001, scriptPubKey: { addresses: ['sender-prev-array'] } }],
          },
        };
        if (txid === 'prev-missing') {
          return null;
        }
        return (txMap[txid] as any) ?? null;
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-sent-fallbacks',
        txid: 'tx-sent-fallbacks',
        type: 'sent',
        amount: BigInt(-1000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-consolidation-nonzero',
        txid: 'tx-consolidation-nonzero',
        type: 'consolidation',
        amount: BigInt(-1),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
      {
        id: 't-recv-coinbase',
        txid: 'tx-recv-coinbase',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-recv-vout-missing',
        txid: 'tx-recv-vout-missing',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-recv-prevout-mix',
        txid: 'tx-recv-prevout-mix',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-recv-prevtx-mix',
        txid: 'tx-recv-prevtx-mix',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: 'wallet-addr' },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBeGreaterThan(0);
    expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-missing', true);
    expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-none', true);
    expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-array', true);
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-sent-fallbacks' },
      data: expect.objectContaining({
        counterpartyAddress: 'external-by-array',
        addressId: 'addr-1',
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-consolidation-nonzero' },
      data: expect.objectContaining({
        fee: BigInt(1000),
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-recv-prevout-mix' },
      data: expect.objectContaining({
        counterpartyAddress: 'sender-array',
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-recv-prevtx-mix' },
      data: expect.objectContaining({
        counterpartyAddress: 'sender-prev-array',
      }),
    });
  });
}
