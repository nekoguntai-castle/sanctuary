import * as bitcoin from 'bitcoinjs-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestContext,
  type RawTransaction,
} from '../../../../../src/services/bitcoin/sync';
import {
  fetchAuthenticatedOutpoints,
  fetchAuthenticatedTransactions,
  fetchCompactAuthenticatedTransactions,
} from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { authenticateHistoryResults } from '../../../../../src/services/bitcoin/sync/historyEvidenceAuthentication';
import type {
  CompactTransactionEvidenceEnvelope,
  TransactionEvidenceProjectionInput,
} from '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection';
import { DetachedTransactionEvidenceError } from '../../../../../src/services/bitcoin/sync/transactionEvidenceThread';

const projectorControl = vi.hoisted(() => ({
  compactTxids: [] as string[],
  fullTxids: [] as string[],
  outputKeys: [] as string[],
  closeCount: 0,
  beforeCompact: undefined as ((txid: string, signal?: AbortSignal) => void) | undefined,
  beforeFull: undefined as ((txid: string, signal?: AbortSignal) => void) | undefined,
  beforeOutput: undefined as ((key: string, signal?: AbortSignal) => void) | undefined,
  outputFailure: undefined as unknown,
  malformedOutputPartition: false,
}));

vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const actual = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceThread'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceThread');
  const projection = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceProjection');

  const createProjector = (walletScripts: readonly string[] = []) => ({
    project: async (input: TransactionEvidenceProjectionInput, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return projection.projectAuthenticatedTransactionWithComplexity(input).value;
    },
    projectCompact: async (input: TransactionEvidenceProjectionInput, signal?: AbortSignal) => {
      projectorControl.compactTxids.push(input.expectedTxid);
      projectorControl.beforeCompact?.(input.expectedTxid, signal);
      signal?.throwIfAborted();
      return projection.projectCompactAuthenticatedTransaction({
        expectedTxid: input.expectedTxid,
        remoteTxid: input.details.txid,
        canonicalBytes: Uint8Array.from(Buffer.from(input.details.hex ?? '', 'hex')),
        metadata: {
          time: input.details.time,
          blocktime: input.details.blocktime,
          blockheight: input.details.blockheight,
          confirmations: input.details.confirmations,
          blockhash: input.details.blockhash,
        },
        limits: input.limits,
      }, walletScripts);
    },
    projectFull: async (envelope: CompactTransactionEvidenceEnvelope, signal?: AbortSignal) => {
      projectorControl.fullTxids.push(envelope.txid);
      projectorControl.beforeFull?.(envelope.txid, signal);
      signal?.throwIfAborted();
      return projection.reprojectFullAuthenticatedTransaction({
        expectedTxid: envelope.txid,
        canonicalBytes: envelope.canonicalBytes,
        digest: envelope.digest,
        complexity: envelope.complexity,
        metadata: envelope.metadata,
      });
    },
    extractOutput: async (
      envelope: CompactTransactionEvidenceEnvelope,
      vout: number,
      signal?: AbortSignal,
    ) => {
      const key = `${envelope.txid}:${vout}`;
      projectorControl.outputKeys.push(key);
      projectorControl.beforeOutput?.(key, signal);
      signal?.throwIfAborted();
      return projection.extractExactAuthenticatedTransactionOutput({
        expectedTxid: envelope.txid,
        canonicalBytes: envelope.canonicalBytes,
        digest: envelope.digest,
        complexity: envelope.complexity,
        metadata: envelope.metadata,
      }, vout);
    },
    extractOutputs: async (
      envelope: CompactTransactionEvidenceEnvelope,
      vouts: readonly number[],
      signal?: AbortSignal,
    ) => {
      for (const vout of vouts) {
        const key = `${envelope.txid}:${vout}`;
        projectorControl.outputKeys.push(key);
        projectorControl.beforeOutput?.(key, signal);
      }
      signal?.throwIfAborted();
      if (projectorControl.outputFailure !== undefined) throw projectorControl.outputFailure;
      const result = projection.extractExactAuthenticatedTransactionOutputs({
        expectedTxid: envelope.txid,
        canonicalBytes: envelope.canonicalBytes,
        digest: envelope.digest,
        complexity: envelope.complexity,
        metadata: envelope.metadata,
      }, vouts);
      return projectorControl.malformedOutputPartition
        ? { ...result, missingVouts: [...result.missingVouts, ...result.outputs.map(item => item.vout)] }
        : result;
    },
    close: async () => { projectorControl.closeCount += 1; },
  });

  return {
    ...actual,
    createTransactionEvidenceProjector: () => createProjector(),
    createCompactTransactionEvidenceProjector: (walletScripts: readonly string[]) => (
      createProjector(walletScripts)
    ),
  };
});

const rawDetails = (
  transaction: bitcoin.Transaction,
  metadata: Partial<RawTransaction> = {},
): RawTransaction => ({
  txid: transaction.getId(),
  hex: transaction.toHex(),
  vin: [],
  vout: [],
  ...metadata,
});

const transactionWithOutputs = (...outputs: Uint8Array[]): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  outputs.forEach((script, index) => transaction.addOutput(script, BigInt(index + 1)));
  return transaction;
};

const spendingTransaction = (
  parentTxid: string,
  vout: number,
  ...outputs: Uint8Array[]
): bitcoin.Transaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.from(parentTxid, 'hex').reverse(), vout);
  outputs.forEach((script, index) => transaction.addOutput(script, BigInt(index + 1)));
  return transaction;
};

const addressRecord = (address: string, script: Uint8Array, index = 0) => ({
  id: `address-${index}`,
  walletId: 'wallet-id',
  address,
  derivationPath: `m/84'/1'/0'/0/${index}`,
  index,
  branch: 0,
  coordinateVersion: 1,
  canonicalPolicyId: 'single_sig_native_segwit',
  canonicalPolicyVersion: 1,
  scriptPubKey: Buffer.from(script).toString('hex'),
  used: false,
  createdAt: new Date(0),
});

const clientFor = (transactions: Map<string, RawTransaction>) => ({
  getRawTransactionEvidenceBatch: vi.fn(async (txids: readonly string[]) => new Map(
    txids.flatMap(txid => transactions.has(txid)
      ? [[txid, transactions.get(txid)!] as const]
      : []),
  )),
  getRawTransactionEvidence: vi.fn(async (txid: string) => transactions.get(txid)),
  getTransactionsBatch: vi.fn(),
  getTransaction: vi.fn(),
});

const historyContext = (input: {
  transactions: Map<string, RawTransaction>;
  addresses: ReturnType<typeof addressRecord>[];
  history: Array<[string, Array<{ tx_hash: string; height: number }>]>;
}) => {
  const client = clientFor(input.transactions);
  const addressMap = new Map(input.addresses.map(address => [address.address, address]));
  return {
    client,
    ctx: createTestContext({
      client: client as never,
      addresses: input.addresses as never,
      addressMap: addressMap as never,
      walletAddressSet: new Set(addressMap.keys()),
      walletScriptToAddress: new Map(input.addresses.map(address => [
        address.scriptPubKey,
        address,
      ])) as never,
      historyResults: new Map(input.history),
    }),
  };
};

beforeEach(() => {
  projectorControl.compactTxids.length = 0;
  projectorControl.fullTxids.length = 0;
  projectorControl.outputKeys.length = 0;
  projectorControl.closeCount = 0;
  projectorControl.beforeCompact = undefined;
  projectorControl.beforeFull = undefined;
  projectorControl.beforeOutput = undefined;
  projectorControl.outputFailure = undefined;
  projectorControl.malformedOutputPartition = false;
});

describe('compact receive-evidence staging', () => {
  it('authenticates pay-only history compactly without populating the full cache', async () => {
    const walletScript = Uint8Array.from([0x51]);
    const transaction = transactionWithOutputs(walletScript);
    const address = addressRecord('wallet-pay', walletScript);
    const history = { tx_hash: transaction.getId(), height: 101 };
    const { ctx } = historyContext({
      transactions: new Map([[transaction.getId(), rawDetails(transaction)]]),
      addresses: [address],
      history: [[address.address, [history]]],
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([history]);
    expect(ctx.allTxids).toEqual(new Set([transaction.getId()]));
    expect(ctx.authenticatedTransactionEvidence.has(transaction.getId())).toBe(true);
    expect(ctx.txDetailsCache.size).toBe(0);
    expect(projectorControl.fullTxids).toEqual([]);
  });

  it('authenticates a spend only through its exact parent vout', async () => {
    const walletScript = Uint8Array.from([0x51]);
    const externalScript = Uint8Array.from([0x00]);
    const parent = transactionWithOutputs(externalScript, walletScript);
    const spend = spendingTransaction(parent.getId(), 1, externalScript);
    const address = addressRecord('wallet-spend', walletScript);
    const history = { tx_hash: spend.getId(), height: 102 };
    const { ctx } = historyContext({
      transactions: new Map([
        [parent.getId(), rawDetails(parent)],
        [spend.getId(), rawDetails(spend)],
      ]),
      addresses: [address],
      history: [[address.address, [history]]],
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([history]);
    expect(ctx.authenticatedOutpointEvidence.get(`${parent.getId()}:1`)).toMatchObject({
      txid: parent.getId(),
      vout: 1,
      scriptHex: Buffer.from(walletScript).toString('hex'),
    });
    expect(ctx.authenticatedOutpointEvidence.has(`${parent.getId()}:0`)).toBe(false);
    expect(ctx.authenticatedSpentOutpointKeys).toEqual(new Set([`${parent.getId()}:1`]));
    expect(ctx.txDetailsCache.size).toBe(0);
  });

  it('deduplicates a shared parent while monotonically covering disjoint vouts', async () => {
    const firstScript = Uint8Array.from([0x51]);
    const secondScript = Uint8Array.from([0x52]);
    const parent = transactionWithOutputs(firstScript, Uint8Array.from([0x00]), secondScript);
    const firstSpend = spendingTransaction(parent.getId(), 0, Uint8Array.from([0x00]));
    const secondSpend = spendingTransaction(parent.getId(), 2, Uint8Array.from([0x00]));
    const firstAddress = addressRecord('wallet-first', firstScript, 0);
    const secondAddress = addressRecord('wallet-second', secondScript, 1);
    const { ctx } = historyContext({
      transactions: new Map([
        [parent.getId(), rawDetails(parent)],
        [firstSpend.getId(), rawDetails(firstSpend)],
        [secondSpend.getId(), rawDetails(secondSpend)],
      ]),
      addresses: [firstAddress, secondAddress],
      history: [
        [firstAddress.address, [{ tx_hash: firstSpend.getId(), height: 103 }]],
        [secondAddress.address, [{ tx_hash: secondSpend.getId(), height: 104 }]],
      ],
    });

    await authenticateHistoryResults(ctx);

    expect(projectorControl.compactTxids.filter(txid => txid === parent.getId())).toHaveLength(1);
    expect(projectorControl.outputKeys.filter(key => key.startsWith(parent.getId()))).toEqual([
      `${parent.getId()}:0`,
      `${parent.getId()}:2`,
    ]);
    expect(ctx.authenticatedOutpointCoverage.get(parent.getId())).toEqual(new Set([0, 2]));
    expect(ctx.authenticatedSpentOutpointKeys).toEqual(new Set([
      `${parent.getId()}:0`,
      `${parent.getId()}:2`,
    ]));
  });

  it('preserves pays-or-spends relevance when an unrelated parent output is invalid', async () => {
    const walletScript = Uint8Array.from([0x51]);
    const parent = transactionWithOutputs(Uint8Array.from([0x00]));
    const payment = spendingTransaction(parent.getId(), 7, walletScript);
    const address = addressRecord('wallet-pay-or-spend', walletScript);
    const history = { tx_hash: payment.getId(), height: 105 };
    const { ctx } = historyContext({
      transactions: new Map([
        [parent.getId(), rawDetails(parent)],
        [payment.getId(), rawDetails(payment)],
      ]),
      addresses: [address],
      history: [[address.address, [history]]],
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([history]);
    expect(ctx.allTxids).toEqual(new Set([payment.getId()]));
    expect(ctx.authenticatedSpentOutpointKeys.size).toBe(0);
    expect(ctx.authenticatedOutpointEvidence.has(`${parent.getId()}:7`)).toBe(false);
  });

  it('retains an accepted sibling when another authenticated history item is irrelevant', async () => {
    const walletScript = Uint8Array.from([0x51]);
    const accepted = transactionWithOutputs(walletScript);
    const rejected = transactionWithOutputs(Uint8Array.from([0x52]));
    const address = addressRecord('wallet-siblings', walletScript);
    const acceptedHistory = { tx_hash: accepted.getId(), height: 106 };
    const { ctx } = historyContext({
      transactions: new Map([
        [accepted.getId(), rawDetails(accepted)],
        [rejected.getId(), rawDetails(rejected)],
      ]),
      addresses: [address],
      history: [[address.address, [
        acceptedHistory,
        { tx_hash: rejected.getId(), height: 107 },
      ]]],
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([acceptedHistory]);
    expect(ctx.allTxids).toEqual(new Set([accepted.getId()]));
    expect(ctx.rejectedEvidenceReasons.get('history_script_mismatch')).toBe(1);
    expect(ctx.authenticatedTransactionEvidence.has(accepted.getId())).toBe(true);
  });

  it('reprojects sealed compact bytes fully without a remote refetch or second charge', async () => {
    const transaction = transactionWithOutputs(Uint8Array.from([0x51]));
    const transactions = new Map([[transaction.getId(), rawDetails(transaction)]]);
    const client = clientFor(transactions);
    const ctx = createTestContext({ client: client as never });

    await expect(fetchCompactAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set([transaction.getId()]));
    const sealedDigest = ctx.authenticatedTransactionEvidence.get(transaction.getId())?.digest;
    transactions.clear();

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set([transaction.getId()]));
    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set([transaction.getId()]));

    expect(client.getRawTransactionEvidenceBatch).toHaveBeenCalledOnce();
    expect(client.getRawTransactionEvidence).not.toHaveBeenCalled();
    expect(projectorControl.compactTxids).toEqual([transaction.getId()]);
    expect(projectorControl.fullTxids).toEqual([transaction.getId()]);
    expect(ctx.authenticatedTransactionEvidence.get(transaction.getId())?.digest).toBe(sealedDigest);
    expect(ctx.txDetailsCache.has(transaction.getId())).toBe(true);
  });

  it('fails missing and out-of-range parent outputs closed without publishing proof', async () => {
    const walletScript = Uint8Array.from([0x51]);
    const knownParent = transactionWithOutputs(walletScript);
    const missingParentTxid = 'ab'.repeat(32);
    const missingParentSpend = spendingTransaction(missingParentTxid, 0, Uint8Array.from([0x00]));
    const outOfRangeSpend = spendingTransaction(knownParent.getId(), 9, Uint8Array.from([0x00]));
    const address = addressRecord('wallet-invalid-parents', walletScript);
    const { ctx } = historyContext({
      transactions: new Map([
        [knownParent.getId(), rawDetails(knownParent)],
        [missingParentSpend.getId(), rawDetails(missingParentSpend)],
        [outOfRangeSpend.getId(), rawDetails(outOfRangeSpend)],
      ]),
      addresses: [address],
      history: [[address.address, [
        { tx_hash: missingParentSpend.getId(), height: 108 },
        { tx_hash: outOfRangeSpend.getId(), height: 109 },
      ]]],
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([]);
    expect(ctx.allTxids.size).toBe(0);
    expect(ctx.authenticatedOutpointEvidence.has(`${missingParentTxid}:0`)).toBe(false);
    expect(ctx.authenticatedOutpointEvidence.has(`${knownParent.getId()}:9`)).toBe(false);
    expect(ctx.authenticatedOutpointCoverage.get(knownParent.getId())).toContain(9);
    expect(ctx.rejectedEvidenceCount).toBeGreaterThanOrEqual(2);
  });

  it('publishes no partial envelope or outpoint when parent authentication is cancelled', async () => {
    const walletScript = Uint8Array.from([0x51]);
    const parent = transactionWithOutputs(walletScript);
    const spend = spendingTransaction(parent.getId(), 0, Uint8Array.from([0x00]));
    const address = addressRecord('wallet-cancelled-parent', walletScript);
    const controller = new AbortController();
    const cancellation = new Error('lease lost during compact parent authentication');
    projectorControl.beforeCompact = (txid) => {
      if (txid === parent.getId()) controller.abort(cancellation);
    };
    const { ctx } = historyContext({
      transactions: new Map([
        [parent.getId(), rawDetails(parent)],
        [spend.getId(), rawDetails(spend)],
      ]),
      addresses: [address],
      history: [[address.address, [{ tx_hash: spend.getId(), height: 110 }]]],
    });
    const retainedCoverage = new Set([7]);
    ctx.authenticatedOutpointCoverage.set('retained-parent', retainedCoverage);

    await expect(authenticateHistoryResults(ctx, { signal: controller.signal }))
      .rejects.toBe(cancellation);

    expect(ctx.authenticatedTransactionEvidence.size).toBe(0);
    expect(ctx.authenticatedOutpointEvidence.size).toBe(0);
    expect(ctx.authenticatedOutpointCoverage).toEqual(new Map([
      ['retained-parent', new Set([7])],
    ]));
    expect(ctx.authenticatedOutpointCoverage.get('retained-parent')).not.toBe(retainedCoverage);
    expect(ctx.authenticatedSpentOutpointKeys.size).toBe(0);
    expect(ctx.txDetailsCache.size).toBe(0);
  });

  it('accepts authenticated history when optional remote metadata is absent', async () => {
    const walletScript = Uint8Array.from([0x51]);
    const transaction = transactionWithOutputs(walletScript);
    const address = addressRecord('wallet-no-metadata', walletScript);
    const history = { tx_hash: transaction.getId(), height: 111 };
    const { ctx } = historyContext({
      transactions: new Map([[transaction.getId(), rawDetails(transaction)]]),
      addresses: [address],
      history: [[address.address, [history]]],
    });

    await authenticateHistoryResults(ctx);

    expect(ctx.historyResults.get(address.address)).toEqual([history]);
    expect(ctx.txHeightMap.get(transaction.getId())).toBe(111);
    expect(ctx.authenticatedTransactionEvidence.get(transaction.getId())?.metadata).toEqual({
      time: undefined,
      blocktime: undefined,
      blockheight: undefined,
      confirmations: undefined,
      blockhash: undefined,
    });
    expect(ctx.rejectedEvidenceCount).toBe(0);
  });

  it('deduplicates direct exact-output requests and records missing coverage', async () => {
    const transaction = transactionWithOutputs(Uint8Array.from([0x51]));
    const client = clientFor(new Map([[transaction.getId(), rawDetails(transaction)]]));
    const ctx = createTestContext({ client: client as never });

    await fetchCompactAuthenticatedTransactions(ctx, [transaction.getId()]);
    await fetchAuthenticatedOutpoints(ctx, new Map([
      [transaction.getId(), new Set([0, 0, 4, -1])],
    ]));
    await fetchAuthenticatedOutpoints(ctx, new Map([
      [transaction.getId(), new Set([0])],
    ]));

    expect(projectorControl.outputKeys).toEqual([
      `${transaction.getId()}:0`,
      `${transaction.getId()}:4`,
      `${transaction.getId()}:-1`,
    ]);
    expect(ctx.authenticatedOutpointEvidence.has(`${transaction.getId()}:0`)).toBe(true);
    expect(ctx.authenticatedOutpointEvidence.has(`${transaction.getId()}:4`)).toBe(false);
    expect(ctx.authenticatedOutpointCoverage.get(transaction.getId())).toEqual(new Set([0, 4]));
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['missing_output', 1],
      ['invalid_vout', 1],
    ]));
  });

  it('rejects a malformed exact-output partition and removes pending evidence', async () => {
    const transaction = transactionWithOutputs(Uint8Array.from([0x51]));
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), rawDetails(transaction)]])) as never,
    });
    await fetchCompactAuthenticatedTransactions(ctx, [transaction.getId()]);
    const key = `${transaction.getId()}:0`;
    ctx.authenticatedOutpointEvidence.set(key, {
      txid: transaction.getId(), vout: 0, valueSats: 99n, scriptHex: '00',
    });
    projectorControl.malformedOutputPartition = true;

    await fetchAuthenticatedOutpoints(ctx, new Map([[transaction.getId(), new Set([0])]]));

    expect(ctx.authenticatedOutpointEvidence.has(key)).toBe(false);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['evidence_digest_mismatch', 1],
    ]));
  });

  it('removes pending evidence before rethrowing detached output ownership', async () => {
    const transaction = transactionWithOutputs(Uint8Array.from([0x51]));
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), rawDetails(transaction)]])) as never,
    });
    await fetchCompactAuthenticatedTransactions(ctx, [transaction.getId()]);
    const key = `${transaction.getId()}:0`;
    ctx.authenticatedOutpointEvidence.set(key, {
      txid: transaction.getId(), vout: 0, valueSats: 99n, scriptHex: '00',
    });
    const failure = new DetachedTransactionEvidenceError(
      new Error('detached exact-output evidence'),
    );
    projectorControl.outputFailure = failure;

    await expect(fetchAuthenticatedOutpoints(
      ctx,
      new Map([[transaction.getId(), new Set([0])]]),
    )).rejects.toBe(failure);
    expect(ctx.authenticatedOutpointEvidence.has(key)).toBe(false);
  });
});
