/**
 * Non-regression test for the 2026-08-20 incident.
 *
 * Two wallets on a production install sat unsyncable for 14.5 hours behind
 * `Sync pipeline failed at phase "receiveEvidenceGate": Receive evidence
 * authentication was incomplete; retry required`. The reason each piece of
 * evidence was rejected was logged by the worker and then discarded, so the
 * persisted `lastSyncError` could not distinguish a bad Electrum server from
 * bad wallet data, and the failure was not actionable from the support bundle.
 *
 * These tests pin the reason codes into the thrown error's message.
 */
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../../../../src/services/bitcoin/sync';
import { receiveEvidenceGatePhase } from '../../../../../src/services/bitcoin/sync/phases/receiveEvidenceGate';
import {
  recordRejectedEvidence,
  summariseRejectedEvidence,
} from '../../../../../src/services/bitcoin/sync/rejectedEvidence';

/**
 * The gate resolves with the context on success, so a bare `.catch(e => e as
 * Error)` widens to `Error | SyncContext` and fails the test typecheck.
 */
async function rejectionMessage(ctx: Parameters<typeof receiveEvidenceGatePhase>[0]): Promise<string> {
  let caught: unknown;
  try {
    await receiveEvidenceGatePhase(ctx);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  return (caught as Error).message;
}

describe('reasonCode attribution', () => {
  it('separates a server that returned no entry from a transport failure', async () => {
    // Both used to collapse to `fetch_failed`, which are different faults with
    // different remedies.
    const { fetchAuthenticatedTransactions } = await import(
      '../../../../../src/services/bitcoin/sync/evidenceAuthentication'
    );
    const ctx = createTestContext({
      client: {
        getTransactionsBatch: async () => new Map(),
        getTransaction: async () => { throw new Error('socket hang up'); },
      } as never,
    });

    await fetchAuthenticatedTransactions(ctx, ['a'.repeat(64)]);
    expect(ctx.rejectedEvidenceCount).toBeGreaterThan(0);
  });

  it('falls back to fetch_failed for an unexpected error inside the cache path', async () => {
    // A well-formed hex whose surrounding record is missing `txid` throws a
    // plain TypeError, not a RawTransactionEvidenceError.
    const bitcoin = await import('bitcoinjs-lib');
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(new Uint8Array(32), 0xffffffff);
    tx.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), 1000n);

    const { fetchAuthenticatedTransactions } = await import(
      '../../../../../src/services/bitcoin/sync/evidenceAuthentication'
    );
    const ctx = createTestContext({
      client: {
        getTransactionsBatch: async () => new Map([[tx.getId(), { hex: tx.toHex() }]]),
        getTransaction: async () => undefined,
      } as never,
    });

    await fetchAuthenticatedTransactions(ctx, [tx.getId()]);
    expect(ctx.rejectedEvidenceReasons.get('fetch_failed')).toBe(1);
  });

  it('attributes a thrown non-Error without crashing', async () => {
    const { fetchAuthenticatedTransactions } = await import(
      '../../../../../src/services/bitcoin/sync/evidenceAuthentication'
    );
    const ctx = createTestContext({
      client: {
        getTransactionsBatch: async () => { throw 'not-an-error'; },
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising a non-Error rejection
        getTransaction: async () => { throw 'not-an-error'; },
      } as never,
    });

    await fetchAuthenticatedTransactions(ctx, ['b'.repeat(64)]);
    expect(ctx.rejectedEvidenceReasons.get('fetch_failed')).toBeGreaterThan(0);
  });
});

describe('summariseRejectedEvidence', () => {
  it('returns an empty string when nothing was tallied', () => {
    expect(summariseRejectedEvidence(new Map())).toBe('');
  });
});

describe('receive evidence reason codes', () => {
  it('passes through when nothing was rejected', async () => {
    const ctx = createTestContext({});
    await expect(receiveEvidenceGatePhase(ctx)).resolves.toBe(ctx);
  });

  it('names every distinct reason in the thrown message', async () => {
    const ctx = createTestContext({});
    recordRejectedEvidence(ctx, 'txid_mismatch');
    recordRejectedEvidence(ctx, 'history_script_mismatch');
    recordRejectedEvidence(ctx, 'fetch_failed');

    await expect(receiveEvidenceGatePhase(ctx)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError',
      rejectedCount: 3,
    });

    const message = await rejectionMessage(ctx);
    expect(message).toContain('txid_mismatch');
    expect(message).toContain('history_script_mismatch');
    expect(message).toContain('fetch_failed');
  });

  it('deduplicates repeated reasons and reports each count', async () => {
    const ctx = createTestContext({});
    recordRejectedEvidence(ctx, 'fetch_failed');
    recordRejectedEvidence(ctx, 'fetch_failed');
    recordRejectedEvidence(ctx, 'fetch_failed');
    recordRejectedEvidence(ctx, 'txid_mismatch');

    const message = await rejectionMessage(ctx);
    expect(ctx.rejectedEvidenceCount).toBe(4);
    // Deduplicated, with the dominant reason first and its count attached.
    expect(message).toMatch(/fetch_failed\s*(?:x|×)\s*3/i);
    expect(message).toMatch(/txid_mismatch\s*(?:x|×)\s*1/i);
    expect(message.match(/fetch_failed/g)).toHaveLength(1);
  });

  it('keeps the message bounded when many distinct reasons occur', async () => {
    const ctx = createTestContext({});
    for (let i = 0; i < 40; i += 1) {
      recordRejectedEvidence(ctx, `reason_${i}`);
    }
    const message = await rejectionMessage(ctx);
    // The message is persisted to wallets.lastSyncError and shown in a tooltip.
    expect(message.length).toBeLessThan(500);
    expect(ctx.rejectedEvidenceCount).toBe(40);
  });

  it('still counts a rejection when the reason is empty', async () => {
    const ctx = createTestContext({});
    recordRejectedEvidence(ctx, '');
    const message = await rejectionMessage(ctx);
    expect(ctx.rejectedEvidenceCount).toBe(1);
    expect(message).toContain('unspecified');
  });
});
