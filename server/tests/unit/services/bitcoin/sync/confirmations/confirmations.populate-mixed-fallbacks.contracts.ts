import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetNodeClient } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsMixedFallbacksContracts() {
  it('covers mixed fee/address fallback branches including invalid fee, coinbase, prevout, and consolidation amount update', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async (txid: string) => {
        const txMap: Record<string, unknown> = {
          'tx-invalid-fee': {
            fee: 2, // invalid (> 1 BTC), should be rejected
            vin: [{ prevout: { value: 0.002, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } } }],
            vout: [{ value: 0.0019, scriptPubKey: { address: 'external-1', addresses: ['external-1'] } }],
          },
          'tx-coinbase': {
            vin: [{ coinbase: true }],
            vout: [{ value: 0.001, scriptPubKey: { address: 'external-2', addresses: ['external-2'] } }],
          },
          'tx-prevout-fee': {
            vin: [{ prevout: { value: 0.001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } } }],
            vout: [{ value: 0.0009, scriptPubKey: { address: 'external-3', addresses: ['external-3'] } }],
          },
          'tx-consolidation-calc': {
            vin: [{ prevout: { value: 0.001, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } } }],
            vout: [{ value: 0.00095, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'tx-recv-prevcache-ok': {
            vin: [{ txid: 'prev-ok', vout: 0 }],
            vout: [{ value: 0.0004, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'tx-recv-prevcache-fail': {
            vin: [{ txid: 'prev-fail', vout: 0 }],
            vout: [{ value: 0.0004, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
          },
          'prev-ok': {
            vout: [{ value: 0.0004, scriptPubKey: { address: 'sender-prev-ok', addresses: ['sender-prev-ok'] } }],
          },
        };
        if (txid === 'prev-fail') {
          throw new Error('prev tx unavailable');
        }
        return (txMap[txid] as any) ?? null;
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-invalid-fee',
        txid: 'tx-invalid-fee',
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
        id: 't-coinbase',
        txid: 'tx-coinbase',
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
        id: 't-prevout-fee',
        txid: 'tx-prevout-fee',
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
        id: 't-consolidation',
        txid: 'tx-consolidation-calc',
        type: 'consolidation',
        amount: BigInt(0),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-recv-prev-ok',
        txid: 'tx-recv-prevcache-ok',
        type: 'received',
        amount: BigInt(40000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-recv-prev-fail',
        txid: 'tx-recv-prevcache-fail',
        type: 'received',
        amount: BigInt(40000),
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
    expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-ok', true);
    expect(mockClient.getTransaction).toHaveBeenCalledWith('prev-fail', true);

    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-prevout-fee' },
      data: expect.objectContaining({
        fee: BigInt(10000),
        counterpartyAddress: 'external-3',
        addressId: 'addr-1',
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-consolidation' },
      data: expect.objectContaining({
        fee: BigInt(5000),
        amount: BigInt(-5000),
      }),
    });
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-recv-prev-ok' },
      data: expect.objectContaining({
        counterpartyAddress: 'sender-prev-ok',
        addressId: 'addr-1',
      }),
    });
  });
}
