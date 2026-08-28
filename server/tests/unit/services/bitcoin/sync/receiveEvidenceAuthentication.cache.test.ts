import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import { createTestContext } from '../../../../../src/services/bitcoin/sync';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';
import { SyncRemoteStageBudgetError } from '../../../../../src/services/bitcoin/sync/attemptRuntime';
import { fetchAuthenticatedTransactions } from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';

const projectionComplexity = vi.hoisted(() => new WeakMap<RawTransaction, {
  rawHexChars: number;
  inputs: number;
  outputs: number;
  scriptHexChars: number;
}>());
const projectionControl = vi.hoisted(() => ({
  exposeComplexity: true,
  projectorCreations: 0,
}));

vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const { projectAuthenticatedTransactionWithComplexity } = await import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  );
  return {
    createTransactionEvidenceProjector: () => {
      projectionControl.projectorCreations++;
      return {
        project: async (
          input: Parameters<typeof projectAuthenticatedTransactionWithComplexity>[0],
          signal?: AbortSignal,
        ) => {
          signal?.throwIfAborted();
          const projected = projectAuthenticatedTransactionWithComplexity(input);
          projectionComplexity.set(projected.value, projected.complexity);
          return projected.value;
        },
        close: async () => undefined,
      };
    },
    projectedTransactionEvidenceComplexity: (value: RawTransaction) => (
      projectionControl.exposeComplexity ? projectionComplexity.get(value) : undefined
    ),
  };
});

const makeRawTransaction = (script: Uint8Array, value: bigint) => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(script, value);
  return transaction;
};

const details = (transaction: bitcoin.Transaction): RawTransaction => ({
  txid: transaction.getId(),
  hex: transaction.toHex(),
  vin: [],
  vout: [],
});

const clientFor = (transactions: Map<string, RawTransaction>) => ({
  getTransactionsBatch: vi.fn(async (txids: string[]) => new Map(
    txids.flatMap(txid => transactions.has(txid) ? [[txid, transactions.get(txid)!] as const] : []),
  )),
  getTransaction: vi.fn(async (txid: string) => transactions.get(txid)),
});

describe('cached receive evidence authentication', () => {
  it('deduplicates requests, preserves metadata, and skips projectors for cached or empty work', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 2n);
    const rawDetails = {
      ...details(transaction),
      time: 1,
      blocktime: 2,
      blockheight: 3,
      confirmations: 4,
      blockhash: 'block-hash',
    };
    const client = clientFor(new Map([[transaction.getId(), rawDetails]]));
    const ctx = createTestContext({ client: client as any });

    const first = await fetchAuthenticatedTransactions(ctx, [transaction.getId(), transaction.getId()]);
    const creationsAfterFirst = projectionControl.projectorCreations;
    const second = await fetchAuthenticatedTransactions(ctx, [transaction.getId()]);
    const empty = await fetchAuthenticatedTransactions(ctx, []);

    expect(first).toEqual(new Set([transaction.getId()]));
    expect(second).toEqual(first);
    expect(empty).toEqual(new Set());
    expect(projectionControl.projectorCreations).toBe(creationsAfterFirst);
    expect(client.getTransactionsBatch).toHaveBeenCalledOnce();
    expect(ctx.txDetailsCache.get(transaction.getId())).toMatchObject({
      time: 1,
      blocktime: 2,
      blockheight: 3,
      confirmations: 4,
      blockhash: 'block-hash',
    });
  });

  it('does not create a projector for cached evidence under terminal cancellation', async () => {
    const txid = '05'.repeat(32);
    const ctx = createTestContext({
      txDetailsCache: new Map([[txid, { txid, vin: [], vout: [] } as RawTransaction]]),
    });
    const controller = new AbortController();
    const reason = new Error('attempt cancelled');
    controller.abort(reason);
    const creationsBefore = projectionControl.projectorCreations;

    await expect(fetchAuthenticatedTransactions(
      ctx,
      [txid],
      { signal: controller.signal, deadlineAt: Date.now() },
    )).rejects.toBe(reason);
    expect(projectionControl.projectorCreations).toBe(creationsBefore);
  });

  it('returns cached evidence without a projector after a local stage budget expires', async () => {
    const txid = '06'.repeat(32);
    const ctx = createTestContext({
      txDetailsCache: new Map([[txid, { txid, vin: [], vout: [] } as RawTransaction]]),
    });
    const controller = new AbortController();
    controller.abort(new SyncRemoteStageBudgetError('candidate_batch_remote'));
    const creationsBefore = projectionControl.projectorCreations;

    await expect(fetchAuthenticatedTransactions(
      ctx,
      [txid],
      { signal: controller.signal, deadlineAt: Date.now() },
    )).resolves.toEqual(new Set([txid]));
    expect(projectionControl.projectorCreations).toBe(creationsBefore);
  });

  it('reuses cached evidence while projecting only uncached siblings', async () => {
    const cachedTxid = '07'.repeat(32);
    const pending = makeRawTransaction(Uint8Array.from([0x51]), 9n);
    const client = clientFor(new Map([[pending.getId(), details(pending)]]));
    const ctx = createTestContext({
      client: client as any,
      txDetailsCache: new Map([[
        cachedTxid,
        { txid: cachedTxid, vin: [], vout: [] } as RawTransaction,
      ]]),
    });

    await expect(fetchAuthenticatedTransactions(ctx, [cachedTxid, pending.getId()]))
      .resolves.toEqual(new Set([cachedTxid, pending.getId()]));
    expect(client.getTransactionsBatch).toHaveBeenCalledWith([pending.getId()], false);
  });

  it('initializes retained complexity from a cached entry without raw hex', async () => {
    const cachedTxid = '04'.repeat(32);
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 2n);
    const client = clientFor(new Map([[transaction.getId(), details(transaction)]]));
    const ctx = createTestContext({
      client: client as any,
      txDetailsCache: new Map([[cachedTxid, {
        txid: cachedTxid,
        vin: [],
        vout: [],
      } as RawTransaction]]),
    });

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set([transaction.getId()]));
  });

  it('falls back to compact-result scanning when worker complexity metadata is unavailable', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 1n);
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), details(transaction)]])) as any,
    });
    projectionControl.exposeComplexity = false;

    try {
      await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
        .resolves.toEqual(new Set([transaction.getId()]));
    } finally {
      projectionControl.exposeComplexity = true;
    }

    expect(ctx.txDetailsCache.get(transaction.getId())?.vout).toHaveLength(1);
  });
});
