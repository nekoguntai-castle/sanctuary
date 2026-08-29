import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import { createTestContext } from '../../../../../src/services/bitcoin/sync';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';
import type { SyncEvidenceArchitectureEvent } from '../../../../../src/services/bitcoin/sync/types';
import { recordFullProjection } from '../../../../../src/services/bitcoin/sync/evidenceArchitectureReceipts';
import {
  fetchAuthenticatedOutpoints,
  fetchAuthenticatedTransactions,
  fetchCompactAuthenticatedTransactions,
  releaseAuthenticatedTransactionDetails,
} from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';

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
      project: async (input: any) => (
        projection.projectAuthenticatedTransactionWithComplexity(input).value
      ),
      projectCompact: async (input: any, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        return projection.projectCompactAuthenticatedTransaction({
          expectedTxid: input.expectedTxid,
          remoteTxid: input.details.txid,
          canonicalBytes: Uint8Array.from(Buffer.from(input.details.hex, 'hex')),
          metadata: {},
          limits: input.limits,
        }, walletScripts);
      },
      projectFull: async (envelope: any, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        return projection.reprojectFullAuthenticatedTransaction({
          expectedTxid: envelope.txid,
          canonicalBytes: envelope.canonicalBytes,
          digest: envelope.digest,
          complexity: envelope.complexity,
          metadata: envelope.metadata,
        });
      },
      extractOutput: async (envelope: any, vout: number, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        return projection.extractExactAuthenticatedTransactionOutput({
          expectedTxid: envelope.txid,
          canonicalBytes: envelope.canonicalBytes,
          digest: envelope.digest,
          complexity: envelope.complexity,
          metadata: envelope.metadata,
        }, vout);
      },
      extractOutputs: async (envelope: any, vouts: readonly number[], signal?: AbortSignal) => {
        signal?.throwIfAborted();
        return projection.extractExactAuthenticatedTransactionOutputs({
          expectedTxid: envelope.txid,
          canonicalBytes: envelope.canonicalBytes,
          digest: envelope.digest,
          complexity: envelope.complexity,
          metadata: envelope.metadata,
        }, vouts);
      },
      close: async () => undefined,
    }),
  };
});

const transactionFixture = (): { transaction: bitcoin.Transaction; details: RawTransaction } => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(new Uint8Array(32), 0xffffffff);
  transaction.addOutput(Uint8Array.from([0x51]), 42n);
  return {
    transaction,
    details: {
      txid: transaction.getId(),
      hex: transaction.toHex(),
      vin: [],
      vout: [],
    },
  };
};

describe('compiled evidence architecture observer', () => {
  it('tolerates observer removal mid-receipt and excludes parent evidence from current counts', () => {
    const events: SyncEvidenceArchitectureEvent[] = [];
    const ctx = createTestContext({
      evidenceObserver: event => {
        events.push(event);
        ctx.evidenceObserver = undefined;
      },
    });

    expect(() => recordFullProjection(ctx, 'parent-txid', {
      value: { txid: 'parent-txid', vin: [], vout: [] },
      canonicalBytes: new Uint8Array(),
      digest: 'parent-digest',
    }, 'parent')).not.toThrow();

    expect(events).toEqual([{
      type: 'compact_to_full_reuse',
      txid: 'parent-txid',
      digest: 'parent-digest',
    }]);
  });

  it('reports compact ownership, local reuse, exact projections, release, and sealed refetches', async () => {
    const { transaction, details } = transactionFixture();
    const txid = transaction.getId();
    const getRawTransactionEvidenceBatch = vi.fn(async () => new Map([[txid, details]]));
    const events: SyncEvidenceArchitectureEvent[] = [];
    const ctx = createTestContext({
      client: { getRawTransactionEvidenceBatch } as never,
      evidenceObserver: event => events.push(event),
    });

    await fetchAuthenticatedTransactions(ctx, [txid], { evidenceRole: 'current' });
    await fetchAuthenticatedOutpoints(
      ctx,
      new Map([[txid, new Set([0])]]),
      { evidenceRole: 'utxo' },
    );
    releaseAuthenticatedTransactionDetails(ctx, { scope: 'candidate', txid });

    const compact = events.find(event => event.type === 'compact_project');
    const full = events.find(event => event.type === 'full_project');
    const reuse = events.find(event => event.type === 'compact_to_full_reuse');
    expect(compact).toMatchObject({
      type: 'compact_project',
      txid,
      canonicalBytes: transaction.byteLength(),
    });
    expect(full).toMatchObject({
      type: 'full_project',
      txid,
      source: 'compact',
      role: 'current',
      txDetailsCacheSize: 1,
    });
    expect(reuse).toMatchObject({
      type: 'compact_to_full_reuse',
      txid,
      digest: compact && 'digest' in compact ? compact.digest : undefined,
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'exact_output_project',
      txid,
      vout: 0,
      role: 'utxo',
    }));
    expect(events).toContainEqual({
      type: 'cache_state',
      reason: 'release',
      scope: 'candidate',
      txid,
      txDetailsCacheSize: 0,
      fullCurrentCount: 0,
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'cache_state',
      reason: 'full_project',
      txDetailsCacheSize: 1,
      fullCurrentCount: 1,
    }));

    ctx.authenticatedTransactionEvidence.delete(txid);
    await fetchCompactAuthenticatedTransactions(ctx, [txid]);

    const remoteFetches = events.filter(event => event.type === 'remote_fetch');
    expect(remoteFetches).toEqual([
      expect.objectContaining({ txids: [txid], transport: 'batch', refetchTxids: [] }),
      expect.objectContaining({ txids: [txid], transport: 'batch', refetchTxids: [txid] }),
    ]);
    expect(getRawTransactionEvidenceBatch).toHaveBeenCalledTimes(2);
  });

  it('does not let a diagnostic observer failure alter evidence acceptance', async () => {
    const { transaction, details } = transactionFixture();
    const txid = transaction.getId();
    const ctx = createTestContext({
      client: {
        getRawTransactionEvidenceBatch: vi.fn(async () => new Map([[txid, details]])),
      } as never,
      evidenceObserver: () => { throw new Error('diagnostic failure'); },
    });

    await expect(fetchCompactAuthenticatedTransactions(ctx, [txid]))
      .resolves.toEqual(new Set([txid]));
  });
});
