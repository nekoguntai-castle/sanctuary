import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';

const transferControl = vi.hoisted(() => ({
  active: new WeakSet<object>(),
}));

vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const actual = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceThread'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceThread');
  const projection = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceProjection');
  return {
    ...actual,
    createCompactTransactionEvidenceProjector: () => ({
      project: vi.fn(),
      projectCompact: vi.fn(),
      projectFull: vi.fn(),
      extractOutput: vi.fn(),
      extractOutputs: async (envelope: any, vouts: readonly number[]) => {
        if (transferControl.active.has(envelope)) {
          throw new actual.DetachedTransactionEvidenceError(new Error('concurrent transfer'));
        }
        transferControl.active.add(envelope);
        await new Promise<void>(resolve => setImmediate(resolve));
        try {
          return projection.extractExactAuthenticatedTransactionOutputs({
            expectedTxid: envelope.txid,
            canonicalBytes: envelope.canonicalBytes,
            digest: envelope.digest,
            complexity: envelope.complexity,
            metadata: envelope.metadata,
          }, vouts);
        } finally {
          transferControl.active.delete(envelope);
        }
      },
      close: async () => undefined,
    }),
  };
});

import { createTestContext } from '../../../../../src/services/bitcoin/sync/context';
import { fetchAuthenticatedOutpoints } from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { projectCompactAuthenticatedTransaction } from '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection';
import type { SyncEvidenceArchitectureEvent } from '../../../../../src/services/bitcoin/sync/types';

const compactTwoOutputTransaction = () => {
  const transaction = new bitcoin.Transaction();
  transaction.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('00', 'hex'));
  transaction.addOutput(Buffer.from('51', 'hex'), 1n);
  transaction.addOutput(Buffer.from('52', 'hex'), 2n);
  return {
    transaction,
    envelope: projectCompactAuthenticatedTransaction({
      expectedTxid: transaction.getId(),
      remoteTxid: transaction.getId(),
      canonicalBytes: Uint8Array.from(transaction.toBuffer()),
      metadata: {},
      limits: { maxInputs: 1, maxOutputs: 2, maxScriptHexChars: 6 },
    }, []),
  };
};

describe('exact outpoint projection concurrency', () => {
  it('serializes concurrent requests that transfer the same sealed envelope', async () => {
    const { transaction, envelope } = compactTwoOutputTransaction();
    const events: SyncEvidenceArchitectureEvent[] = [];
    const client = {
      getRawTransactionEvidenceBatch: vi.fn(),
      getRawTransactionEvidence: vi.fn(),
    };
    const ctx = createTestContext({
      client: client as any,
      evidenceObserver: event => events.push(event),
    });
    ctx.authenticatedTransactionEvidence.set(transaction.getId(), envelope);

    await Promise.all([
      fetchAuthenticatedOutpoints(ctx, new Map([[transaction.getId(), new Set([0])]])),
      fetchAuthenticatedOutpoints(ctx, new Map([[transaction.getId(), new Set([1])]])),
    ]);

    expect(ctx.authenticatedOutpointCoverage.get(transaction.getId())).toEqual(new Set([0, 1]));
    expect(ctx.authenticatedOutpointEvidence.get(`${transaction.getId()}:0`)?.valueSats).toBe(1n);
    expect(ctx.authenticatedOutpointEvidence.get(`${transaction.getId()}:1`)?.valueSats).toBe(2n);
    expect(events.filter(event => event.type === 'exact_output_batch_project')).toHaveLength(2);
    expect(client.getRawTransactionEvidenceBatch).not.toHaveBeenCalled();
    expect(envelope.canonicalBytes.byteLength).toBeGreaterThan(0);
  });
});
