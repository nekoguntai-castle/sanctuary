import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { getTransactionFieldPatch, mockGetNodeClient } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const walletOut = (value: number) => ({ value, scriptPubKey: { address: 'wallet-addr', addresses: ['wallet-addr'] } });

const incompleteTx = (id: string, type: string, amount: bigint) => ({
  id,
  txid: id,
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
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: vi.fn(async (txid: string) => {
        const txMap: Record<string, unknown> = {
          'sent-partial': {
            vin: [{ txid: 'parent-ok', vout: 0 }, { txid: 'parent-missing', vout: 0 }],
            vout: [walletOut(0.9999)],
          },
          'consolidation-partial': {
            vin: [{ txid: 'parent-ok', vout: 0 }, { txid: 'parent-missing', vout: 0 }],
            vout: [walletOut(0.9999)],
          },
          'sent-no-vout': {
            vin: [{ txid: 'parent-ok' }],
            vout: [walletOut(0.5)],
          },
          'sent-no-txid': {
            vin: [{ vout: 0 }],
            vout: [walletOut(0.5)],
          },
          'sent-complete': {
            vin: [{ txid: 'parent-ok', vout: 0 }, { txid: 'parent-small', vout: 0 }],
            vout: [walletOut(0.9999)],
          },
          'parent-ok': { vout: [walletOut(1.0)] },
          'parent-small': { vout: [walletOut(0.0001)] },
        };
        if (txid === 'parent-missing') {
          throw new Error('parent unavailable');
        }
        return (txMap[txid] as unknown) ?? null;
      }),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      incompleteTx('sent-partial', 'sent', BigInt(-1000)),
      incompleteTx('consolidation-partial', 'consolidation', BigInt(0)),
      incompleteTx('sent-no-vout', 'sent', BigInt(-1000)),
      incompleteTx('sent-no-txid', 'sent', BigInt(-1000)),
      incompleteTx('sent-complete', 'sent', BigInt(-1000)),
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([{ id: 'addr-1', address: 'wallet-addr' }]);

    await populateMissingTransactionFields('wallet-1');

    // 1.0 BTC known + a missing 0.0001 BTC input would understate the 20,000 sat fee as 10,000 sats.
    expect(getTransactionFieldPatch('sent-partial')?.data.fee).toBeUndefined();
    expect(getTransactionFieldPatch('consolidation-partial')?.data.fee).toBeUndefined();
    expect(getTransactionFieldPatch('consolidation-partial')?.data.amount).toBeUndefined();
    expect(getTransactionFieldPatch('sent-no-vout')?.data.fee).toBeUndefined();
    expect(getTransactionFieldPatch('sent-no-txid')?.data.fee).toBeUndefined();
    expect(getTransactionFieldPatch('sent-complete')?.data.fee).toBe(BigInt(20000));
  });
}
