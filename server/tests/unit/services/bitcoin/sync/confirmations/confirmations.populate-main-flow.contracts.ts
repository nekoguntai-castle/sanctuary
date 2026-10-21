import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import {
  getTransactionFieldPatch,
  getTransactionFieldPatches,
  mockGetNodeClient,
  mockRecalculateWalletBalances,
} from './confirmationsTestHarness';
import {
  buildTransaction,
  nodeDetails,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const WALLET = walletOutput(1);
const CHANGE = walletOutput(2);
const EXTERNAL = walletOutput(3);
const SENDER = walletOutput(4);

export function registerPopulateMissingTransactionFieldsMainFlowContracts() {
  it('populates block/fee/address fields, uses history + prev tx cache, and recalculates balances when amount changes', async () => {
    const prevFee = buildTransaction({
      inputs: [{ txid: '11'.repeat(32), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(100_000) }],
    });
    const senderParent = buildTransaction({
      inputs: [{ txid: '12'.repeat(32), vout: 0 }],
      outputs: [{ script: SENDER.script, valueSats: BigInt(40_000) }],
    });
    const consolidationParent = buildTransaction({
      inputs: [{ txid: '13'.repeat(32), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(100_000) }],
    });
    const txSent = buildTransaction({
      inputs: [{ txid: prevFee.getId(), vout: 0 }],
      outputs: [
        { script: EXTERNAL.script, valueSats: BigInt(90_000) },
        { script: WALLET.script, valueSats: BigInt(5_000) },
      ],
    });
    const txRecvNoDetails = buildTransaction({
      inputs: [{ txid: '14'.repeat(32), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(30_000) }],
    });
    const txRecvDetailed = buildTransaction({
      inputs: [{ txid: senderParent.getId(), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(30_000) }],
    });
    const txConsolidate = buildTransaction({
      inputs: [{ txid: consolidationParent.getId(), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(98_000) }],
    });
    const mockClient = {
      getAddressHistory: vi.fn(async (address: string) => {
        if (address === WALLET.address) {
          return [{ tx_hash: txRecvNoDetails.getId(), height: 995 }];
        }
        return [];
      }),
      getTransaction: serveNodeTransactions([
        [txSent.getId(), nodeDetails(txSent, { confirmations: 2 })],
        [txRecvDetailed.getId(), nodeDetails(txRecvDetailed, { time: 1700000000 })],
        [txConsolidate.getId(), nodeDetails(txConsolidate, { blockheight: 999 })],
        [prevFee.getId(), nodeDetails(prevFee)],
        [senderParent.getId(), nodeDetails(senderParent)],
        [consolidationParent.getId(), nodeDetails(consolidationParent)],
      ]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        txid: txSent.getId(),
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
        txid: txRecvNoDetails.getId(),
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
        txid: txRecvDetailed.getId(),
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
        txid: txConsolidate.getId(),
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
      { id: 'addr-1', address: WALLET.address },
      { id: 'addr-2', address: CHANGE.address },
    ]);

    const onCommit = vi.fn();
    const signal = new AbortController().signal;
    const result = await populateMissingTransactionFields(
      'wallet-1',
      signal,
      onCommit,
      undefined,
      false,
      Date.now() + 30_000,
    );

    expect(result.updated).toBe(4);
    expect(result.confirmationUpdates).toEqual([
      { txid: txSent.getId(), oldConfirmations: 0, newConfirmations: 2 },
      { txid: txRecvNoDetails.getId(), oldConfirmations: 0, newConfirmations: 6 },
      { txid: txConsolidate.getId(), oldConfirmations: 0, newConfirmations: 2 },
    ]);
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit.mock.calls.map(([commit]) => commit)).toEqual([
      {
        updated: 2,
        confirmationUpdates: [
          { txid: txSent.getId(), oldConfirmations: 0, newConfirmations: 2 },
          { txid: txRecvNoDetails.getId(), oldConfirmations: 0, newConfirmations: 6 },
        ],
      },
      {
        updated: 2,
        confirmationUpdates: [
          { txid: txConsolidate.getId(), oldConfirmations: 0, newConfirmations: 2 },
        ],
      },
    ]);
    expect(mockClient.getTransaction).toHaveBeenCalledWith(
      prevFee.getId(),
      true,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getTransactionFieldPatch('t1')).toEqual({
      id: 't1',
      data: expect.objectContaining({
        blockHeight: 999,
        confirmations: 2,
        fee: BigInt(5000),
        counterpartyAddress: EXTERNAL.address,
      }),
    });
    expect(getTransactionFieldPatch('t2')).toEqual({
      id: 't2',
      data: expect.objectContaining({
        blockHeight: 995,
        confirmations: 6,
      }),
    });
    expect(getTransactionFieldPatch('t3')).toEqual({
      id: 't3',
      data: expect.objectContaining({
        counterpartyAddress: SENDER.address,
        addressId: 'addr-1',
      }),
    });
    expect(getTransactionFieldPatch('t4')).toEqual({
      id: 't4',
      data: expect.objectContaining({
        fee: BigInt(2000),
        amount: BigInt(-2000),
      }),
    });
    expect(mockRecalculateWalletBalances).toHaveBeenCalledWith(
      'wallet-1',
      undefined,
      expect.any(Function),
    );
  });

  it('stops before fetching a later population chunk when cancellation arrives during the current chunk write', async () => {
    const controller = new AbortController();
    const chainTransactions = Array.from({ length: 51 }, (_, index) => buildTransaction({
      inputs: [{ txid: '11'.repeat(32), vout: 0 }],
      outputs: [{ script: WALLET.script, valueSats: BigInt(1_000) }],
      locktime: index,
    }));
    const transactions = chainTransactions.map((tx, index) => ({
      id: `transaction-${index}`,
      txid: tx.getId(),
      type: 'received',
      amount: BigInt(1000),
      fee: BigInt(0),
      blockHeight: null,
      blockTime: new Date('2024-01-01T00:00:00.000Z'),
      confirmations: 0,
      addressId: 'address-1',
      counterpartyAddress: 'sender',
    }));
    const mockClient = {
      getAddressHistory: vi.fn().mockResolvedValue([]),
      getTransaction: serveNodeTransactions(
        chainTransactions.map((tx): [string, unknown] => [tx.getId(), nodeDetails(tx, { blockheight: 900 })]),
      ),
    };
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockPrismaClient.transaction.findMany.mockResolvedValue(transactions);
    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.$executeRaw.mockImplementation((query) => {
      const sql = query?.strings?.join('') ?? '';
      if (!sql.includes('jsonb_to_recordset')) return Promise.resolve(0);
      controller.abort(new Error('cancel population after current chunk'));
      return Promise.resolve(0);
    });

    await expect(populateMissingTransactionFields(
      'wallet-1',
      controller.signal,
    )).rejects.toThrow('cancel population after current chunk');

    expect(mockClient.getTransaction).toHaveBeenCalledTimes(50);
    // Cancellation is checked between database batches, so only the first
    // configured two-row transaction batch commits before the abort is observed.
    expect(getTransactionFieldPatches()).toHaveLength(2);
    expect(mockClient.getTransaction).not.toHaveBeenCalledWith(chainTransactions[50].getId(), true);
  });
}
