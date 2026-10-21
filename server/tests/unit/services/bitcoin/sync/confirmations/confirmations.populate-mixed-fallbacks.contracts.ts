import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { getTransactionFieldPatch, mockGetNodeClient } from './confirmationsTestHarness';
import {
  buildTransaction,
  nodeDetails,
  payingTransaction,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const WALLET = walletOutput(1);
const EXTERNAL = walletOutput(3);
const SENDER_PREV_OK = walletOutput(4);

export function registerPopulateMissingTransactionFieldsMixedFallbacksContracts() {
  it('covers mixed fee/address fallback branches including invalid fee, coinbase, prevout, and consolidation amount update', async () => {
    // The verbose-fee and input-prevout fallbacks were removed (populate-authentication
    // contracts): fees and senders come only from authenticated parents.
    const prevOk = payingTransaction(SENDER_PREV_OK.script, 40_000, '11');
    const prevFail = payingTransaction(WALLET.script, 40_000, '12');
    const consolidationParent = payingTransaction(WALLET.script, 100_000, '13');
    const coinbase = buildTransaction({
      inputs: ['coinbase'],
      outputs: [{ script: EXTERNAL.script, valueSats: BigInt(100_000) }],
    });
    const consolidation = buildTransaction({
      inputs: [{ txid: consolidationParent.getId(), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(95_000) }],
    });
    const recvPrevOk = buildTransaction({
      inputs: [{ txid: prevOk.getId(), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(40_000) }],
    });
    const recvPrevFail = buildTransaction({
      inputs: [{ txid: prevFail.getId(), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(40_000) }],
    });
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([
        ...[coinbase, consolidation, recvPrevOk, recvPrevFail, prevOk, consolidationParent]
          .map((tx): [string, unknown] => [tx.getId(), nodeDetails(tx)]),
        [prevFail.getId(), new Error('prev tx unavailable')],
      ]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-coinbase',
        txid: coinbase.getId(),
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
        txid: consolidation.getId(),
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
        txid: recvPrevOk.getId(),
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
        txid: recvPrevFail.getId(),
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
      { id: 'addr-1', address: WALLET.address },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBeGreaterThan(0);
    expect(mockClient.getTransaction).toHaveBeenCalledWith(prevOk.getId(), true);
    expect(mockClient.getTransaction).toHaveBeenCalledWith(prevFail.getId(), true);

    // A coinbase input resolves the inputs to the output total: a zero fee is never persisted.
    expect(getTransactionFieldPatch('t-coinbase')?.data.fee).toBeUndefined();
    expect(getTransactionFieldPatch('t-consolidation')).toEqual({
      id: 't-consolidation',
      data: expect.objectContaining({
        fee: BigInt(5000),
        amount: BigInt(-5000),
      }),
    });
    expect(getTransactionFieldPatch('t-recv-prev-ok')).toEqual({
      id: 't-recv-prev-ok',
      data: expect.objectContaining({
        counterpartyAddress: SENDER_PREV_OK.address,
        addressId: 'addr-1',
      }),
    });
  });
}
