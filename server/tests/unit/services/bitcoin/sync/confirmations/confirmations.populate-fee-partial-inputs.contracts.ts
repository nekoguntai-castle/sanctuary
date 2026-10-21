import { expect, it, vi } from 'vitest';
import type * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { getTransactionFieldPatch, mockGetNodeClient } from './confirmationsTestHarness';
import {
  buildTransaction,
  nodeDetails,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const WALLET = walletOutput(1);

const walletOut = (valueSats: number) => ({ script: WALLET.script, valueSats: BigInt(valueSats) });

const incompleteTx = (id: string, tx: bitcoin.Transaction, type: string, amount: bigint) => ({
  id,
  txid: tx.getId(),
  type,
  amount,
  fee: null,
  blockHeight: 999,
  blockTime: new Date('2024-01-01T00:00:00.000Z'),
  confirmations: 1,
  addressId: 'addr-1',
  counterpartyAddress: 'external-1',
});

export function registerPopulateMissingTransactionFieldsFeePartialInputsContracts() {
  it('leaves fee and consolidation amount unset when a parent output is unresolved', async () => {
    // Inputs without a txid or vout cannot be expressed in real bytes; populators.defensive.test.ts covers them.
    const parentOk = buildTransaction({ inputs: [{ txid: '11'.repeat(32), vout: 0 }], outputs: [walletOut(100_000_000)] });
    const parentSmall = buildTransaction({ inputs: [{ txid: '12'.repeat(32), vout: 0 }], outputs: [walletOut(10_000)] });
    const parentMissing = buildTransaction({ inputs: [{ txid: '13'.repeat(32), vout: 0 }], outputs: [walletOut(10_000)] });
    const spending = (second: bitcoin.Transaction, locktime: number) => buildTransaction({
      inputs: [{ txid: parentOk.getId(), vout: 0 }, { txid: second.getId(), vout: 0 }],
      outputs: [walletOut(99_990_000)],
      locktime,
    });
    const sentPartial = spending(parentMissing, 1);
    const consolidationPartial = spending(parentMissing, 2);
    const sentComplete = spending(parentSmall, 3);
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([
        ...[sentPartial, consolidationPartial, sentComplete, parentOk, parentSmall]
          .map((tx): [string, unknown] => [tx.getId(), nodeDetails(tx)]),
        [parentMissing.getId(), new Error('parent unavailable')],
      ]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      incompleteTx('sent-partial', sentPartial, 'sent', BigInt(-1000)),
      incompleteTx('consolidation-partial', consolidationPartial, 'consolidation', BigInt(0)),
      incompleteTx('sent-complete', sentComplete, 'sent', BigInt(-1000)),
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([{ id: 'addr-1', address: WALLET.address }]);

    await populateMissingTransactionFields('wallet-1');

    // 1.0 BTC known + a missing 0.0001 BTC input would understate the 20,000 sat fee as 10,000 sats.
    expect(getTransactionFieldPatch('sent-partial')?.data.fee).toBeUndefined();
    expect(getTransactionFieldPatch('consolidation-partial')?.data.fee).toBeUndefined();
    expect(getTransactionFieldPatch('consolidation-partial')?.data.amount).toBeUndefined();
    expect(getTransactionFieldPatch('sent-complete')?.data.fee).toBe(BigInt(20000));
  });
}
