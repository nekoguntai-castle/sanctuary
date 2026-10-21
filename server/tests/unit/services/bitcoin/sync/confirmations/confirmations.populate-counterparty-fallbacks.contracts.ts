import { expect, it, vi } from 'vitest';
import type * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { getTransactionFieldPatch, mockGetNodeClient } from './confirmationsTestHarness';
import {
  OP_RETURN_SCRIPT,
  buildTransaction,
  nodeDetails,
  payingTransaction,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const WALLET = walletOutput(1);
const EXTERNAL_BY_ARRAY = walletOutput(3);
const SENDER_ARRAY = walletOutput(4);
const SENDER_PREV_ARRAY = walletOutput(5);

export function registerPopulateMissingTransactionFieldsCounterpartyFallbacksContracts() {
  it('covers fee/counterparty/addressId fallback branches for sent, consolidation, and received txs', async () => {
    // Former verbose `prevout` mixes are authenticated parents now; inputs and
    // details without fields cannot be expressed in real bytes (populators.defensive.test.ts).
    const walletParent = payingTransaction(WALLET.script, 10_000, '11');
    const prevMissing = payingTransaction(WALLET.script, 10_000, '12');
    const consolidationParent = payingTransaction(WALLET.script, 100_000, '13');
    const prevNone = payingTransaction(OP_RETURN_SCRIPT, 10_000, '14');
    const prevArray = payingTransaction(SENDER_PREV_ARRAY.script, 10_000, '15');
    const prevoutEmpty = payingTransaction(OP_RETURN_SCRIPT, 10_000, '16');
    const prevoutSender = payingTransaction(SENDER_ARRAY.script, 10_000, '17');
    const txSentFallbacks = buildTransaction({
      inputs: [{ txid: walletParent.getId(), vout: 0 }, { txid: prevMissing.getId(), vout: 0 }],
      outputs: [
        { script: OP_RETURN_SCRIPT, valueSats: BigInt(20_000) },
        { script: EXTERNAL_BY_ARRAY.script, valueSats: BigInt(10_000) },
      ],
    });
    const txConsolidationNonzero = buildTransaction({
      inputs: [{ txid: consolidationParent.getId(), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(99_000) }],
    });
    const txRecvCoinbase = buildTransaction({
      inputs: ['coinbase'],
      outputs: [{ script: OP_RETURN_SCRIPT, valueSats: BigInt(10_000) }],
    });
    const receiving = (parents: bitcoin.Transaction[]) => buildTransaction({
      inputs: parents.map(parent => ({ txid: parent.getId(), vout: 0 })),
      outputs: [{ script: WALLET.script, valueSats: BigInt(10_000) }],
    });
    const txRecvPrevoutMix = receiving([prevoutEmpty, prevoutSender]);
    const txRecvPrevtxMix = receiving([prevNone, prevArray]);
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([
        ...[
          txSentFallbacks, txConsolidationNonzero, txRecvCoinbase, txRecvPrevoutMix, txRecvPrevtxMix,
          walletParent, consolidationParent, prevNone, prevArray, prevoutEmpty, prevoutSender,
        ].map((tx): [string, unknown] => [tx.getId(), nodeDetails(tx)]),
        [prevMissing.getId(), null],
      ]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-sent-fallbacks',
        txid: txSentFallbacks.getId(),
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
        txid: txConsolidationNonzero.getId(),
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
        txid: txRecvCoinbase.getId(),
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
        txid: txRecvPrevoutMix.getId(),
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
        txid: txRecvPrevtxMix.getId(),
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
      { id: 'addr-1', address: WALLET.address },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBeGreaterThan(0);
    expect(mockClient.getTransaction).toHaveBeenCalledWith(prevMissing.getId(), true);
    expect(mockClient.getTransaction).toHaveBeenCalledWith(prevNone.getId(), true);
    expect(mockClient.getTransaction).toHaveBeenCalledWith(prevArray.getId(), true);
    expect(getTransactionFieldPatch('t-sent-fallbacks')).toEqual({
      id: 't-sent-fallbacks',
      data: expect.objectContaining({
        counterpartyAddress: EXTERNAL_BY_ARRAY.address,
      }),
    });
    expect(getTransactionFieldPatch('t-consolidation-nonzero')).toEqual({
      id: 't-consolidation-nonzero',
      data: expect.objectContaining({
        fee: BigInt(1000),
      }),
    });
    expect(getTransactionFieldPatch('t-recv-prevout-mix')).toEqual({
      id: 't-recv-prevout-mix',
      data: expect.objectContaining({
        counterpartyAddress: SENDER_ARRAY.address,
      }),
    });
    expect(getTransactionFieldPatch('t-recv-prevtx-mix')).toEqual({
      id: 't-recv-prevtx-mix',
      data: expect.objectContaining({
        counterpartyAddress: SENDER_PREV_ARRAY.address,
      }),
    });
  });
}
