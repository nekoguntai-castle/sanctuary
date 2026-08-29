import * as bitcoin from 'bitcoinjs-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repositoryMocks = vi.hoisted(() => ({
  findByWalletIdWithSelect: vi.fn(),
  markManyAsSpent: vi.fn(),
  batchUpdateByIds: vi.fn(),
  findExistingByOutpoints: vi.fn(),
  createMany: vi.fn(),
  findLocksByUtxoIdsWithDraftInfo: vi.fn(),
  deleteManyByIds: vi.fn(),
}));

vi.mock('../../../../../src/repositories', () => ({
  utxoRepository: {
    findByWalletIdWithSelect: repositoryMocks.findByWalletIdWithSelect,
    markManyAsSpent: repositoryMocks.markManyAsSpent,
    batchUpdateByIds: repositoryMocks.batchUpdateByIds,
    findExistingByOutpoints: repositoryMocks.findExistingByOutpoints,
    createMany: repositoryMocks.createMany,
  },
  draftLockRepository: {
    findLocksByUtxoIdsWithDraftInfo: repositoryMocks.findLocksByUtxoIdsWithDraftInfo,
  },
  draftRepository: { deleteManyByIds: repositoryMocks.deleteManyByIds },
}));

vi.mock('../../../../../src/repositories/syncIntentRepository', () => ({
  withWalletSyncMutationFence: vi.fn(),
  withWalletSyncMutationLock: vi.fn(),
}));

vi.mock('../../../../../src/config', () => ({
  getConfig: () => ({ sync: { transactionBatchSize: 100 } }),
}));

vi.mock('../../../../../src/websocket/notifications', () => ({ walletLog: vi.fn() }));

vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const actual = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceThread'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceThread');
  const projection = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceProjection');
  return {
    ...actual,
    createCompactTransactionEvidenceProjector: (walletScripts: readonly string[]) => ({
      project: async (
        input: Parameters<typeof projection.projectAuthenticatedTransaction>[0],
      ) => projection.projectAuthenticatedTransaction(input),
      projectCompact: async (
        input: Parameters<typeof projection.projectAuthenticatedTransaction>[0],
        signal?: AbortSignal,
      ) => {
        signal?.throwIfAborted();
        return projection.projectCompactAuthenticatedTransaction({
          expectedTxid: input.expectedTxid,
          remoteTxid: input.details.txid,
          canonicalBytes: Uint8Array.from(Buffer.from(input.details.hex ?? '', 'hex')),
          metadata: {},
          limits: input.limits,
        }, walletScripts);
      },
      projectFull: async (
        envelope: import('../../../../../src/services/bitcoin/sync/transactionEvidenceProjection')
          .CompactTransactionEvidenceEnvelope,
      ) => projection.reprojectFullAuthenticatedTransaction({
        expectedTxid: envelope.txid,
        canonicalBytes: envelope.canonicalBytes,
        digest: envelope.digest,
        complexity: envelope.complexity,
        metadata: envelope.metadata,
      }),
      extractOutput: async (
        envelope: import('../../../../../src/services/bitcoin/sync/transactionEvidenceProjection')
          .CompactTransactionEvidenceEnvelope,
        vout: number,
      ) => (
        projection.extractExactAuthenticatedTransactionOutput({
          expectedTxid: envelope.txid,
          canonicalBytes: envelope.canonicalBytes,
          digest: envelope.digest,
          complexity: envelope.complexity,
          metadata: envelope.metadata,
        }, vout)
      ),
      extractOutputs: async (
        envelope: import('../../../../../src/services/bitcoin/sync/transactionEvidenceProjection')
          .CompactTransactionEvidenceEnvelope,
        vouts: readonly number[],
      ) => (
        projection.extractExactAuthenticatedTransactionOutputs({
          expectedTxid: envelope.txid,
          canonicalBytes: envelope.canonicalBytes,
          digest: envelope.digest,
          complexity: envelope.complexity,
          metadata: envelope.metadata,
        }, vouts)
      ),
      close: async () => undefined,
    }),
  };
});

import {
  createTestContext,
  fetchUtxosPhase,
  insertUtxosPhase,
  reconcileUtxosPhase,
  type SyncContext,
} from '../../../../../src/services/bitcoin/sync';
import { fetchAuthenticatedOutpoints } from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { projectCompactAuthenticatedTransaction } from '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection';

const SCRIPT_A = '51';
const SCRIPT_B = '52';
const VALUE_SATS = 100_000n;

const transactionWithOutputs = (
  outputs: ReadonlyArray<{ scriptHex: string; valueSats: bigint }>,
): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('00', 'hex'));
  for (const output of outputs) {
    transaction.addOutput(Buffer.from(output.scriptHex, 'hex'), output.valueSats);
  }
  return transaction;
};

const rawDetails = (transaction: bitcoin.Transaction) => ({
  txid: transaction.getId(),
  hex: transaction.toHex(),
  vin: [],
  vout: [],
});

const compactEnvelope = (transaction: bitcoin.Transaction, walletScripts = [SCRIPT_A]) => (
  projectCompactAuthenticatedTransaction({
    expectedTxid: transaction.getId(),
    remoteTxid: transaction.getId(),
    canonicalBytes: Uint8Array.from(transaction.toBuffer()),
    metadata: {},
    limits: { maxInputs: 25_000, maxOutputs: 25_000, maxScriptHexChars: 1_000_000 },
  }, walletScripts)
);

const addressRecord = (address: string, scriptPubKey = SCRIPT_A) => ({
  id: `${address}-id`,
  address,
  scriptPubKey,
});

const nodeClient = (transactions: readonly bitcoin.Transaction[] = []) => {
  const details = new Map(transactions.map(transaction => [transaction.getId(), rawDetails(transaction)]));
  return {
    getAddressUTXOsBatch: vi.fn(),
    getAddressUTXOs: vi.fn(),
    getRawTransactionEvidenceBatch: vi.fn(async (txids: string[]) => new Map(
      txids.flatMap(txid => {
        const value = details.get(txid);
        return value ? [[txid, value] as const] : [];
      }),
    )),
    getRawTransactionEvidence: vi.fn(async (txid: string) => details.get(txid)),
    getTransactionsBatch: vi.fn(),
    getTransaction: vi.fn(),
  };
};

const listedUtxo = (transaction: bitcoin.Transaction, overrides: Partial<{
  tx_pos: number;
  value: number;
  height: number;
}> = {}) => ({
  tx_hash: transaction.getId(),
  tx_pos: overrides.tx_pos ?? 0,
  value: overrides.value ?? Number(VALUE_SATS),
  height: overrides.height ?? 799_995,
});

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMocks.findByWalletIdWithSelect.mockResolvedValue([]);
  repositoryMocks.markManyAsSpent.mockResolvedValue(0);
  repositoryMocks.batchUpdateByIds.mockResolvedValue(undefined);
  repositoryMocks.findExistingByOutpoints.mockResolvedValue(new Set());
  repositoryMocks.createMany.mockResolvedValue({ count: 1 });
  repositoryMocks.findLocksByUtxoIdsWithDraftInfo.mockResolvedValue([]);
  repositoryMocks.deleteManyByIds.mockResolvedValue(undefined);
});

describe('compact UTXO authentication', () => {
  it('accepts an exact sealed output without retaining a full transaction', async () => {
    const transaction = transactionWithOutputs([{ scriptHex: SCRIPT_A, valueSats: VALUE_SATS }]);
    const client = nodeClient([transaction]);
    const address = addressRecord('wallet-a');
    const utxo = listedUtxo(transaction);
    client.getAddressUTXOsBatch.mockResolvedValue(new Map([[address.address, [utxo]]]));
    const ctx = createTestContext({
      addresses: [address] as any,
      addressMap: new Map([[address.address, address]]) as any,
      walletScriptToAddress: new Map([[SCRIPT_A, address]]) as any,
      client: client as any,
    });

    await fetchUtxosPhase(ctx);

    expect(ctx.utxoResults).toEqual([{ address: address.address, utxos: [utxo] }]);
    expect(ctx.authenticatedOutpointEvidence.get(`${transaction.getId()}:0`)).toEqual({
      txid: transaction.getId(), vout: 0, valueSats: VALUE_SATS, scriptHex: SCRIPT_A,
    });
    expect(ctx.txDetailsCache.size).toBe(0);
  });

  it('retains a valid UTXO sibling when one batch item is malformed', async () => {
    const transaction = transactionWithOutputs([
      { scriptHex: SCRIPT_A, valueSats: VALUE_SATS },
      { scriptHex: SCRIPT_A, valueSats: VALUE_SATS + 1n },
    ]);
    const client = nodeClient([transaction]);
    const address = addressRecord('wallet-a');
    const valid = listedUtxo(transaction);
    const malformed = { ...listedUtxo(transaction, { tx_pos: 1 }), value: 1.5 };
    client.getAddressUTXOsBatch.mockResolvedValue(new Map([[
      address.address,
      [valid, malformed],
    ]]));
    const ctx = createTestContext({
      addresses: [address] as any,
      addressMap: new Map([[address.address, address]]) as any,
      walletScriptToAddress: new Map([[SCRIPT_A, address]]) as any,
      client: client as any,
    });

    await fetchUtxosPhase(ctx);

    expect(ctx.utxoResults).toEqual([{ address: address.address, utxos: [valid] }]);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['invalid_utxo_result', 1]]));
  });

  it.each([
    ['wrong value', SCRIPT_A, { value: Number(VALUE_SATS) + 1 }, false],
    ['wrong script', SCRIPT_B, {}, false],
    ['cross-address claim', SCRIPT_B, {}, true],
    ['missing vout', SCRIPT_A, { tx_pos: 4 }, false],
  ] as const)(
    'rejects %s without accepting the listed output',
    async (_case, outputScript, overrides, outputBelongsToOtherWalletAddress) => {
      const transaction = transactionWithOutputs([{
        scriptHex: outputScript,
        valueSats: VALUE_SATS,
      }]);
      const client = nodeClient([transaction]);
      const address = addressRecord('wallet-a', SCRIPT_A);
      const otherAddress = addressRecord('wallet-b', SCRIPT_B);
      client.getAddressUTXOsBatch.mockResolvedValue(new Map([[
        address.address,
        [listedUtxo(transaction, overrides)],
      ]]));
      const ctx = createTestContext({
        addresses: [address] as any,
        addressMap: new Map([[address.address, address]]) as any,
        walletScriptToAddress: new Map([
          [SCRIPT_A, address],
          ...(outputBelongsToOtherWalletAddress
            ? [[SCRIPT_B, otherAddress] as const]
            : []),
        ]) as any,
        client: client as any,
      });

      await fetchUtxosPhase(ctx);

      expect(ctx.utxoResults).toEqual([{ address: address.address, utxos: [] }]);
      expect(ctx.allUtxoKeys.size).toBe(0);
    },
  );

  it('extracts a later vout from a history-seen compact envelope without refetching', async () => {
    const transaction = transactionWithOutputs([
      { scriptHex: SCRIPT_B, valueSats: 1n },
      { scriptHex: SCRIPT_A, valueSats: VALUE_SATS },
    ]);
    const client = nodeClient();
    const ctx = createTestContext({ client: client as any });
    ctx.authenticatedTransactionEvidence.set(transaction.getId(), compactEnvelope(transaction));

    await fetchAuthenticatedOutpoints(ctx, new Map([[transaction.getId(), new Set([1])]]));

    expect(ctx.authenticatedOutpointEvidence.get(`${transaction.getId()}:1`)).toEqual({
      txid: transaction.getId(), vout: 1, valueSats: VALUE_SATS, scriptHex: SCRIPT_A,
    });
    expect(ctx.authenticatedOutpointCoverage.get(transaction.getId())).toEqual(new Set([1]));
    expect(client.getRawTransactionEvidenceBatch).not.toHaveBeenCalled();
    expect(client.getRawTransactionEvidence).not.toHaveBeenCalled();
  });

  it('publishes valid siblings while covering missing and rejecting invalid vouts', async () => {
    const transaction = transactionWithOutputs([{ scriptHex: SCRIPT_A, valueSats: VALUE_SATS }]);
    const ctx = createTestContext({ client: nodeClient() as any });
    ctx.authenticatedTransactionEvidence.set(transaction.getId(), compactEnvelope(transaction));

    await fetchAuthenticatedOutpoints(
      ctx,
      new Map([[transaction.getId(), new Set([0, 9, -1])]]),
    );

    expect(ctx.authenticatedOutpointEvidence.get(`${transaction.getId()}:0`)?.valueSats)
      .toBe(VALUE_SATS);
    expect(ctx.authenticatedOutpointCoverage.get(transaction.getId())).toEqual(new Set([0, 9]));
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['missing_output', 1],
      ['invalid_vout', 1],
    ]));
  });

  it('compactly fetches a UTXO-only transaction once and reuses exact-vout coverage', async () => {
    const transaction = transactionWithOutputs([{ scriptHex: SCRIPT_A, valueSats: VALUE_SATS }]);
    const client = nodeClient([transaction]);
    const ctx = createTestContext({ client: client as any });
    const request = new Map([[transaction.getId(), new Set([0])]]);

    await fetchAuthenticatedOutpoints(ctx, request);
    await fetchAuthenticatedOutpoints(ctx, request);

    expect(client.getRawTransactionEvidenceBatch).toHaveBeenCalledOnce();
    expect(ctx.authenticatedTransactionEvidence.has(transaction.getId())).toBe(true);
    expect(ctx.authenticatedOutpointEvidence.get(`${transaction.getId()}:0`)?.valueSats).toBe(VALUE_SATS);
    expect(ctx.txDetailsCache.size).toBe(0);
  });
});

describe('compact UTXO persistence consumers', () => {
  it('reconciles an existing UTXO from sealed outpoint evidence, not the full cache', async () => {
    const transaction = transactionWithOutputs([{ scriptHex: SCRIPT_A, valueSats: VALUE_SATS }]);
    const txid = transaction.getId();
    const key = `${txid}:0`;
    repositoryMocks.findByWalletIdWithSelect.mockResolvedValue([{
      id: 'existing-utxo', txid, vout: 0, spent: false, confirmations: 5,
      blockHeight: 799_994, address: 'wallet-a', amount: VALUE_SATS, scriptPubKey: SCRIPT_A,
    }]);
    const ctx = createTestContext({
      walletId: 'wallet-id',
      currentBlockHeight: 800_000,
      allUtxoKeys: new Set([key]),
      utxoDataMap: new Map([[key, {
        address: 'wallet-a', utxo: listedUtxo(transaction),
      }]]),
      authenticatedOutpointEvidence: new Map([[key, {
        txid, vout: 0, valueSats: VALUE_SATS, scriptHex: SCRIPT_A,
      }]]),
      txDetailsCache: new Map(),
    });
    ctx.authenticatedTransactionEvidence.set(txid, compactEnvelope(transaction));
    ctx.authenticatedOutpointCoverage.set(txid, new Set([0]));
    ctx.authenticatedSpentOutpointKeys.add(key);

    await reconcileUtxosPhase(ctx);

    expect(repositoryMocks.batchUpdateByIds).toHaveBeenCalledWith([{
      id: 'existing-utxo',
      data: { confirmations: 6, blockHeight: 799_995, spent: false },
    }], 100, undefined);
  });

  it('inserts a new UTXO from sealed output evidence without a transaction fallback', async () => {
    const transaction = transactionWithOutputs([{ scriptHex: SCRIPT_A, valueSats: VALUE_SATS }]);
    const txid = transaction.getId();
    const key = `${txid}:0`;
    const client = nodeClient();
    const ctx = createTestContext({
      walletId: 'wallet-id',
      currentBlockHeight: 800_000,
      client: client as any,
      allUtxoKeys: new Set([key]),
      utxoDataMap: new Map([[key, {
        address: 'wallet-a', utxo: listedUtxo(transaction),
      }]]),
      authenticatedOutpointEvidence: new Map([[key, {
        txid, vout: 0, valueSats: VALUE_SATS, scriptHex: SCRIPT_A,
      }]]),
      txDetailsCache: new Map(),
    });

    await insertUtxosPhase(ctx);

    expect(repositoryMocks.createMany).toHaveBeenCalledWith([{
      walletId: 'wallet-id', txid, vout: 0, address: 'wallet-a', amount: VALUE_SATS,
      scriptPubKey: SCRIPT_A, confirmations: 6, blockHeight: 799_995, spent: false,
    }], { skipDuplicates: true }, undefined);
    expect(client.getTransaction).not.toHaveBeenCalled();
    expect(ctx.authenticatedTransactionEvidence.size).toBe(0);
    expect(ctx.authenticatedOutpointEvidence.size).toBe(0);
    expect(ctx.authenticatedOutpointCoverage.size).toBe(0);
    expect(ctx.authenticatedSpentOutpointKeys.size).toBe(0);
  });

  it('does not mark an omitted UTXO spent without an authenticated input', async () => {
    const txid = 'ab'.repeat(32);
    repositoryMocks.findByWalletIdWithSelect.mockResolvedValue([{
      id: 'existing-utxo', txid, vout: 0, spent: false, confirmations: 5,
      blockHeight: 799_995, address: 'wallet-a', amount: VALUE_SATS, scriptPubKey: SCRIPT_A,
    }]);
    const ctx = createTestContext({
      walletId: 'wallet-id',
      allUtxoKeys: new Set(),
      authenticatedSpentOutpointKeys: new Set(),
    });

    await reconcileUtxosPhase(ctx);

    expect(repositoryMocks.markManyAsSpent).not.toHaveBeenCalled();
    expect(repositoryMocks.batchUpdateByIds).not.toHaveBeenCalled();
    expect(repositoryMocks.deleteManyByIds).not.toHaveBeenCalled();
  });
});
