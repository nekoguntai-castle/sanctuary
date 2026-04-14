import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetNodeClient } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsAddressIdContracts() {
  it('populates addressId for sent transactions from input prevout wallet addresses', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async () => ({
        vin: [
          {
            prevout: {
              scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] },
            },
          },
        ],
        vout: [{ value: 0.0005, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
      })),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-sent-addressid',
        txid: 'tx-sent-addressid',
        type: 'sent',
        amount: BigInt(-50000),
        fee: BigInt(1000),
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: 'wallet-addr' },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(1);
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 't-sent-addressid' },
      data: expect.objectContaining({
        addressId: 'addr-1',
      }),
    });
  });

  it('leaves received transaction addressId unset when no output matches wallet addresses', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async () => ({
        vin: [],
        vout: [{ value: 0.0002, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
      })),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-recv-no-match',
        txid: 'tx-recv-no-match',
        type: 'received',
        amount: BigInt(20000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: 'wallet-addr' },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(0);
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
  });

  it('does not set received addressId when wallet lookup returns no id', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async () => ({
        vin: [],
        vout: [{ value: 0.0002, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } }],
      })),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-recv-missing-id',
        txid: 'tx-recv-missing-id',
        type: 'received',
        amount: BigInt(20000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    // Intentionally missing id to exercise the falsy-id branch.
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: undefined, address: 'wallet-addr' } as any,
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(0);
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
  });

  it('handles sent addressId fallback branches when vin is missing or lookup id is missing', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async (txid: string) => {
        if (txid === 'tx-sent-no-vin') {
          return {
            vout: [{ value: 0.0003, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
          };
        }
        return {
          vin: [
            {
              prevout: {
                scriptPubKey: { addresses: ['external-in'] },
              },
            },
            {
              prevout: {
                scriptPubKey: { addresses: ['wallet-addr'] },
              },
            },
          ],
          vout: [{ value: 0.0003, scriptPubKey: { address: 'external-addr', addresses: ['external-addr'] } }],
        };
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-sent-no-vin',
        txid: 'tx-sent-no-vin',
        type: 'sent',
        amount: BigInt(-30000),
        fee: BigInt(1000),
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
      {
        id: 't-sent-missing-id',
        txid: 'tx-sent-missing-id',
        type: 'sent',
        amount: BigInt(-30000),
        fee: BigInt(1000),
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    // Intentionally missing id to hit falsy lookup branch.
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: undefined, address: 'wallet-addr' } as any,
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(0);
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
  });
}
