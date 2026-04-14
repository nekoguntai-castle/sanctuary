import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetNodeClient, mockWalletLog } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsErrorHandlingContracts() {
  it('handles address/transaction fetch failures and reports no updates needed', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => {
        throw new Error('history unavailable');
      }),
      getTransaction: vi.fn(async () => {
        throw new Error('tx fetch failed');
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-fail',
        txid: 'tx-fail',
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
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'info',
      'POPULATE',
      'No transaction updates needed'
    );
  });

  it('continues when fee/counterparty parsing and per-transaction processing throw errors', async () => {
    const outputWithThrowingFields: any = {};
    Object.defineProperty(outputWithThrowingFields, 'value', {
      get() {
        throw new Error('value parse error');
      },
    });
    Object.defineProperty(outputWithThrowingFields, 'scriptPubKey', {
      get() {
        throw new Error('script parse error');
      },
    });

    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async (txid: string) => {
        if (txid === 'tx-fee-counterparty-error') {
          return {
            vin: [{ prevout: { value: 0.001, scriptPubKey: { address: 'wallet-addr' } } }],
            vout: [outputWithThrowingFields],
          };
        }
        return {
          // Force outer catch in addressId section (for...of on non-iterable)
          vin: [],
          vout: 1,
        };
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-fee-counterparty-error',
        txid: 'tx-fee-counterparty-error',
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
        id: 't-outer-catch',
        txid: 'tx-outer-catch',
        type: 'received',
        amount: BigInt(500),
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

    expect(result.confirmationUpdates).toEqual([]);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(mockPrismaClient.transaction.update).toHaveBeenCalled();
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'warn',
      'POPULATE',
      expect.stringContaining('Failed to process tx'),
      expect.any(Object),
    );
  });
}
