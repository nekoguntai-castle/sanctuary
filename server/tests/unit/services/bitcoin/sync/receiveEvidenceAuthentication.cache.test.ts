import * as bitcoin from 'bitcoinjs-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext } from '../../../../../src/services/bitcoin/sync';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';
import { SyncRemoteStageBudgetError } from '../../../../../src/services/bitcoin/sync/attemptRuntime';
import {
  authenticatedRawHexChars,
  clearAuthenticatedEvidenceComplexity,
  fetchAuthenticatedTransactions,
  releaseAuthenticatedEvidence,
} from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { DetachedTransactionEvidenceError } from '../../../../../src/services/bitcoin/sync/transactionEvidenceThread';

const projectionComplexity = vi.hoisted(() => new WeakMap<RawTransaction, {
  rawHexChars: number;
  inputs: number;
  outputs: number;
  scriptHexChars: number;
}>());
const projectionControl = vi.hoisted(() => ({
  exposeComplexity: true,
  projectorCreations: 0,
  fullFailure: undefined as unknown,
  afterFull: undefined as undefined | (() => void),
}));

vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const actual = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceThread'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceThread');
  const projection = await import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  );
  const project = async (
    input: Parameters<typeof projection.projectAuthenticatedTransactionWithComplexity>[0],
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    const projected = projection.projectAuthenticatedTransactionWithComplexity(input);
    projectionComplexity.set(projected.value, projected.complexity);
    return projected.value;
  };
  return {
    ...actual,
    createTransactionEvidenceProjector: () => {
      projectionControl.projectorCreations++;
      return {
        project,
        close: async () => undefined,
      };
    },
    createCompactTransactionEvidenceProjector: (walletScripts: readonly string[]) => {
      projectionControl.projectorCreations++;
      return {
        project,
        projectCompact: async (
          input: Parameters<typeof projection.projectAuthenticatedTransactionWithComplexity>[0],
          signal?: AbortSignal,
        ) => {
          await project(input, signal);
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
        projectFull: async (envelope: any, signal?: AbortSignal) => {
          signal?.throwIfAborted();
          if (projectionControl.fullFailure !== undefined) throw projectionControl.fullFailure;
          const result = projection.reprojectFullAuthenticatedTransaction({
            expectedTxid: envelope.txid,
            canonicalBytes: envelope.canonicalBytes,
            digest: envelope.digest,
            complexity: envelope.complexity,
            metadata: envelope.metadata,
          });
          projectionControl.afterFull?.();
          return result;
        },
        extractOutput: async (envelope: any, vout: number) => (
          projection.extractExactAuthenticatedTransactionOutput({
            expectedTxid: envelope.txid,
            canonicalBytes: envelope.canonicalBytes,
            digest: envelope.digest,
            complexity: envelope.complexity,
            metadata: envelope.metadata,
          }, vout)
        ),
        extractOutputs: async (envelope: any, vouts: readonly number[]) => (
          projection.extractExactAuthenticatedTransactionOutputs({
            expectedTxid: envelope.txid,
            canonicalBytes: envelope.canonicalBytes,
            digest: envelope.digest,
            complexity: envelope.complexity,
            metadata: envelope.metadata,
          }, vouts)
        ),
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

beforeEach(() => {
  projectionControl.fullFailure = undefined;
  projectionControl.afterFull = undefined;
});

describe('cached receive evidence authentication', () => {
  it('releases all attempt-scoped authenticated evidence together', () => {
    const ctx = createTestContext({});
    const txid = '01'.repeat(32);
    ctx.authenticatedTransactionEvidence.set(txid, {
      txid,
      canonicalBytes: new Uint8Array(),
      digest: 'digest',
      complexity: { rawHexChars: 0, inputs: 0, outputs: 0, scriptHexChars: 0 },
      metadata: {},
      inputTxids: new Uint8Array(),
      inputVouts: new Uint32Array(),
      paidWalletScriptIndexes: new Uint32Array(),
    });
    ctx.authenticatedOutpointEvidence.set(`${txid}:0`, {
      txid, vout: 0, valueSats: 1n, scriptHex: '51',
    });
    ctx.authenticatedOutpointCoverage.set(txid, new Set([0]));
    ctx.authenticatedSpentOutpointKeys.add(`${txid}:0`);

    releaseAuthenticatedEvidence(ctx, 'attempt');

    expect(ctx.authenticatedTransactionEvidence.size).toBe(0);
    expect(ctx.authenticatedOutpointEvidence.size).toBe(0);
    expect(ctx.authenticatedOutpointCoverage.size).toBe(0);
    expect(ctx.authenticatedSpentOutpointKeys.size).toBe(0);
  });

  it('charges one exact raw encoding for compact and legacy projector results', () => {
    const txid = '03'.repeat(32);
    expect(authenticatedRawHexChars({ txid, vin: [], vout: [] }, 8)).toBe(8);
    expect(authenticatedRawHexChars({ txid, hex: '00112233', vin: [], vout: [] }, 16)).toBe(8);
    expect(authenticatedRawHexChars({
      txid,
      raw: Uint8Array.from([0, 1, 2, 3]),
      vin: [],
      vout: [],
    }, 16)).toBe(8);
  });

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

  it('rebuilds retained complexity without double-charging a compact full-cache entry', async () => {
    const retained = makeRawTransaction(Uint8Array.from([0x51]), 8n);
    const pending = makeRawTransaction(Uint8Array.from([0x52]), 9n);
    const client = clientFor(new Map([
      [retained.getId(), details(retained)],
      [pending.getId(), details(pending)],
    ]));
    const ctx = createTestContext({ client: client as any });

    await fetchAuthenticatedTransactions(ctx, [retained.getId()]);
    clearAuthenticatedEvidenceComplexity(ctx);

    await expect(fetchAuthenticatedTransactions(ctx, [pending.getId()]))
      .resolves.toEqual(new Set([pending.getId()]));
    expect(ctx.authenticatedTransactionEvidence.has(retained.getId())).toBe(true);
    expect(ctx.txDetailsCache.has(retained.getId())).toBe(true);
  });

  it('clears rejected full projections and preserves their fail-closed reason', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 10n);
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), details(transaction)]])) as any,
    });
    projectionControl.fullFailure = { reason: 'full_projection_rejected' };

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set());

    expect(ctx.txDetailsCache.has(transaction.getId())).toBe(false);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['full_projection_rejected', 1],
    ]));
  });

  it('classifies an unstructured full projection error as a fetch failure', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 10n);
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), details(transaction)]])) as any,
    });
    projectionControl.fullFailure = new Error('worker unavailable');

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .resolves.toEqual(new Set());
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['fetch_failed', 1]]));
  });

  it('finishes local projection when only the remote stage budget expires', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 10n);
    const controller = new AbortController();
    const budget = new SyncRemoteStageBudgetError('candidate_batch_remote');
    let aborted = false;
    const rawDetails: RawTransaction = {
      txid: transaction.getId(),
      vin: [],
      vout: [],
      get hex() {
        if (!aborted) {
          aborted = true;
          controller.abort(budget);
        }
        return transaction.toHex();
      },
    };
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), rawDetails]])) as any,
    });

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()], {
      signal: controller.signal,
      deadlineAt: Date.now() + 1_000,
    })).resolves.toEqual(new Set());
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([
      ['fetch_budget_exhausted', 1],
    ]));
  });

  it('clears and rethrows detached full projections without remote fallback', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 11n);
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), details(transaction)]])) as any,
    });
    const failure = new DetachedTransactionEvidenceError(new Error('worker lost ownership'));
    projectionControl.fullFailure = failure;

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()]))
      .rejects.toBe(failure);
    expect(ctx.txDetailsCache.has(transaction.getId())).toBe(false);
    expect(ctx.rejectedEvidenceCount).toBe(0);
  });

  it('rechecks the attempt runtime after full projection completes', async () => {
    const transaction = makeRawTransaction(Uint8Array.from([0x51]), 12n);
    const controller = new AbortController();
    const failure = new Error('attempt expired after full projection');
    const ctx = createTestContext({
      client: clientFor(new Map([[transaction.getId(), details(transaction)]])) as any,
      attemptRuntime: { signal: controller.signal, deadlineAt: Date.now() + 1_000 },
    });
    projectionControl.afterFull = () => controller.abort(failure);

    await expect(fetchAuthenticatedTransactions(ctx, [transaction.getId()], {
      signal: controller.signal,
      deadlineAt: Date.now() + 1_000,
    })).rejects.toBe(failure);
    expect(ctx.txDetailsCache.has(transaction.getId())).toBe(false);
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
