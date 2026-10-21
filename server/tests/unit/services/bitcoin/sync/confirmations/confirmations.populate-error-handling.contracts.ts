import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import {
  getTransactionFieldPatches,
  mockGetBlockTimestamp,
  mockGetNodeClient,
  mockWalletLog,
} from './confirmationsTestHarness';
import {
  nodeDetails,
  payingTransaction,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const WALLET = walletOutput(1);

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
    expect(getTransactionFieldPatches()).toEqual([]);
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'info',
      'POPULATE',
      'No transaction updates needed'
    );
  });

  it('continues when fee/counterparty parsing and per-transaction processing throw errors', async () => {
    // Throwing getters inside the populators are covered by populators.defensive.test.ts:
    // authenticated projections cannot carry them. The flow keeps the outer
    // per-transaction catch: a block-header lookup that rejects for one row.
    const populated = payingTransaction(WALLET.script, 1_000, '11');
    const headerFailure = payingTransaction(WALLET.script, 1_000, '12');
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([
        [populated.getId(), nodeDetails(populated)],
        [headerFailure.getId(), nodeDetails(headerFailure)],
      ]),
    };
    mockGetBlockTimestamp.mockRejectedValueOnce(new Error('block header unavailable'));

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-populated',
        txid: populated.getId(),
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
      {
        id: 't-outer-catch',
        txid: headerFailure.getId(),
        type: 'received',
        amount: BigInt(500),
        fee: null,
        blockHeight: 999,
        blockTime: null,
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: WALLET.address },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.confirmationUpdates).toEqual([]);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(getTransactionFieldPatches()).not.toEqual([]);
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'warn',
      'POPULATE',
      expect.stringContaining('Failed to process tx'),
      expect.any(Object),
    );
  });
}
