import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), unknown: vi.fn(), stalled: vi.fn(), rejected: vi.fn(), accepted: vi.fn(), complete: vi.fn(),
  findById: vi.fn(),
}));
vi.mock('../../../../../src/repositories/transactionSigningIntentRepository', () => ({
  transactionSigningIntentRepository: {
    claimBroadcast: mocks.claim,
    markBroadcastUnknown: mocks.unknown,
    markBroadcastStalled: mocks.stalled,
    releaseRejectedBroadcast: mocks.rejected,
    markBroadcastAccepted: mocks.accepted,
    markBroadcastComplete: mocks.complete,
    findById: mocks.findById,
  },
}));

import {
  claimSigningIntentBroadcast,
  DurableBroadcastMetadataSchema,
  findHeldPolicyReservations,
  markSigningIntentBroadcastAccepted,
  markSigningIntentBroadcastComplete,
  markSigningIntentBroadcastStalled,
  markSigningIntentBroadcastUnknown,
  releaseRejectedSigningIntentBroadcast,
} from '../../../../../src/services/bitcoin/signingIntent/broadcastLifecycle';
import { createValidatedBroadcastArtifactFixture } from '../../../../helpers/validatedBroadcastArtifact';

const artifact = createValidatedBroadcastArtifactFixture({
  txid: 'b'.repeat(64), rawTx: '00', walletId: 'wallet-1', network: 'testnet3',
  intentId: 'intent-1',
});
const metadata = {
  recipient: 'tb1qrecipient',
  amount: 0,
  fee: 1,
  utxos: [{ txid: 'c'.repeat(64), vout: 0 }],
};

describe('signing intent broadcast lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores the exact artifact and metadata in the atomic pre-broadcast claim', async () => {
    mocks.claim.mockResolvedValue({ status: 'claimed', record: {}, priorState: 'ready' });
    const now = new Date('2030-01-01T00:00:00Z');
    const result = await claimSigningIntentBroadcast(artifact, metadata, now);
    expect(result).toEqual({ status: 'claimed', leaseToken: expect.any(String), priorState: 'ready' });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      id: 'intent-1', digest: 'a'.repeat(64), txid: 'b'.repeat(64), rawTx: '00', metadata,
      now, leaseExpiresAt: new Date('2030-01-01T00:01:00Z'), allowStalled: true,
    }));
  });

  it.each(['ready', 'resumed', 'stalled'] as const)('returns the %s prior state of a claim', async priorState => {
    mocks.claim.mockResolvedValue({ status: 'claimed', record: {}, priorState });
    await expect(claimSigningIntentBroadcast(artifact, metadata))
      .resolves.toEqual({ status: 'claimed', leaseToken: expect.any(String), priorState });
  });

  it.each(['accepted', 'complete'] as const)('makes an exact retry idempotent after %s', async status => {
    mocks.claim.mockResolvedValue({ status });
    await expect(claimSigningIntentBroadcast(artifact, metadata)).resolves.toEqual({ status });
  });

  it('rejects a concurrent request while the lease is live', async () => {
    mocks.claim.mockResolvedValue({ status: 'busy' });
    await expect(claimSigningIntentBroadcast(artifact, metadata)).rejects.toThrow(
      'already in progress',
    );
  });

  it('rejects a digest or txid conflict', async () => {
    mocks.claim.mockResolvedValue({ status: 'conflict' });
    await expect(claimSigningIntentBroadcast(artifact, metadata)).rejects.toThrow(
      'does not match',
    );
  });

  it.each([
    { ...metadata, recipient: '' },
    { ...metadata, fee: Number.NaN },
    { ...metadata, utxos: [{ txid: 'not-a-txid', vout: 0 }] },
  ])('rejects malformed metadata before acquiring a broadcast lease', async invalidMetadata => {
    await expect(claimSigningIntentBroadcast(artifact, invalidMetadata)).rejects.toThrow(
      'Broadcast metadata is malformed',
    );
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('accepts and preserves a structural replacesTxid in the durable claim metadata', async () => {
    // Non-regression: DurableBroadcastMetadataSchema is `.strict()`, so an
    // unlisted key rejects the whole metadata object with "Broadcast
    // metadata is malformed" before a broadcast claim is even attempted —
    // which is exactly what happened to every RBF broadcast when
    // replacesTxid was added to broadcastAndSave's metadata without also
    // being added here (rbf-memo-prefix-spoofs-transaction-replacement).
    mocks.claim.mockResolvedValue({ status: 'claimed', record: {}, priorState: 'ready' });
    const replacesTxid = 'd'.repeat(64);
    const metadataWithReplacesTxid = { ...metadata, replacesTxid };

    await expect(claimSigningIntentBroadcast(artifact, metadataWithReplacesTxid))
      .resolves.toEqual({ status: 'claimed', leaseToken: expect.any(String), priorState: 'ready' });

    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      metadata: metadataWithReplacesTxid,
    }));
  });

  it('delegates every lease-bound outcome transition', async () => {
    mocks.unknown.mockResolvedValue(true);
    mocks.rejected.mockResolvedValue(true);
    mocks.stalled.mockResolvedValue(true);
    mocks.accepted.mockResolvedValue(true);
    mocks.complete.mockResolvedValue(true);
    await expect(markSigningIntentBroadcastUnknown('intent-1', 'lease', 'timeout')).resolves.toBe(true);
    expect(mocks.unknown).toHaveBeenLastCalledWith('intent-1', 'lease', 'timeout', undefined);
    await expect(markSigningIntentBroadcastUnknown('intent-1', 'lease', 'timeout', { countAttempt: false }))
      .resolves.toBe(true);
    expect(mocks.unknown).toHaveBeenLastCalledWith('intent-1', 'lease', 'timeout', { countAttempt: false });
    await expect(markSigningIntentBroadcastStalled('intent-1', 'lease', 'capped')).resolves.toBe(true);
    expect(mocks.stalled).toHaveBeenCalledWith('intent-1', 'lease', 'capped');
    await expect(releaseRejectedSigningIntentBroadcast('intent-1', 'lease', 'rejected')).resolves.toBe(true);
    await expect(markSigningIntentBroadcastAccepted('intent-1', 'lease')).resolves.toBe(true);
    await expect(markSigningIntentBroadcastComplete('intent-1', 'txid')).resolves.toBe(true);
  });

  describe('policy reservations on the durable claim', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => ({
      windowId: `window-${index}`, amount: String(index * 1000),
    }));

    it('round-trips more than sixteen reservation entries through the claim metadata', async () => {
      mocks.claim.mockResolvedValue({ status: 'claimed', record: {}, priorState: 'ready' });
      const withReservations = { ...metadata, policyReservations: many(24) };

      await expect(claimSigningIntentBroadcast(artifact, withReservations)).resolves.toMatchObject({ status: 'claimed' });
      expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ metadata: withReservations }));
    });

    it.each([
      [[{ windowId: '', amount: '1' }]],
      [[{ windowId: 'w1', amount: '-1' }]],
      [[{ windowId: 'w1', amount: '01' }]],
      [[{ windowId: 'w1', amount: 1 }]],
      [[{ windowId: 'w1', amount: '1', extra: true }]],
    ])('rejects a malformed reservation entry %j', (policyReservations) => {
      expect(DurableBroadcastMetadataSchema.safeParse({ ...metadata, policyReservations }).success).toBe(false);
    });

    it('bounds the entry count only by a generous sanity limit', () => {
      expect(DurableBroadcastMetadataSchema.safeParse({ ...metadata, policyReservations: many(3000) }).success).toBe(true);
      expect(DurableBroadcastMetadataSchema.safeParse({ ...metadata, policyReservations: many(3073) }).success).toBe(false);
    });

    it('forwards a resume-only claim to the repository', async () => {
      mocks.claim.mockResolvedValue({ status: 'conflict' });
      await expect(claimSigningIntentBroadcast(artifact, metadata, new Date(), { resumeOnly: true }))
        .rejects.toThrow('does not match');
      expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ resumeOnly: true, allowStalled: true }));
      expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ keepHeldReservations: false }));
    });

    it('asks a fresh claim to leave reservations held by an earlier attempt untouched', async () => {
      mocks.claim.mockResolvedValue({ status: 'busy' });
      await expect(claimSigningIntentBroadcast(artifact, metadata)).rejects.toThrow('already in progress');
      expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ resumeOnly: false, keepHeldReservations: true }));
    });
  });

  describe('findHeldPolicyReservations', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const txid = 'b'.repeat(64);
    const stored = (overrides: Record<string, unknown> = {}) => ({
      broadcastState: 'unknown',
      broadcastTxid: txid,
      broadcastLeaseExpiresAt: null,
      broadcastMetadata: { ...metadata, policyReservations: [{ windowId: 'w1', amount: '9000' }] },
      ...overrides,
    });

    it('returns the reservations of an unknown intent for the same txid', async () => {
      mocks.findById.mockResolvedValue(stored());
      await expect(findHeldPolicyReservations('intent-1', txid, now))
        .resolves.toEqual([{ windowId: 'w1', amount: BigInt(9000) }]);
      expect(mocks.findById).toHaveBeenCalledWith('intent-1');
    });

    it('returns the reservations of a claimed intent whose lease expired', async () => {
      mocks.findById.mockResolvedValue(stored({ broadcastState: 'claimed', broadcastLeaseExpiresAt: now }));
      await expect(findHeldPolicyReservations('intent-1', txid, now))
        .resolves.toEqual([{ windowId: 'w1', amount: BigInt(9000) }]);
    });

    it('returns an empty held list as held', async () => {
      mocks.findById.mockResolvedValue(stored({ broadcastMetadata: { ...metadata, policyReservations: [] } }));
      await expect(findHeldPolicyReservations('intent-1', txid, now)).resolves.toEqual([]);
    });

    it.each([
      ['a missing intent', null],
      ['a live claim', stored({ broadcastState: 'claimed', broadcastLeaseExpiresAt: new Date(now.getTime() + 1) })],
      ['a claim without a lease expiry', stored({ broadcastState: 'claimed' })],
      ['a ready intent', stored({ broadcastState: 'ready', broadcastTxid: null })],
      ['an accepted intent', stored({ broadcastState: 'accepted' })],
      ['a different txid', stored({ broadcastTxid: 'e'.repeat(64) })],
      ['legacy metadata without reservations', stored({ broadcastMetadata: metadata })],
      ['unparseable metadata', stored({ broadcastMetadata: { amount: 'x' } })],
      ['null metadata', stored({ broadcastMetadata: null })],
    ])('returns null for %s', async (_label, record) => {
      mocks.findById.mockResolvedValue(record);
      await expect(findHeldPolicyReservations('intent-1', txid, now)).resolves.toBeNull();
    });

    it('defaults the lease comparison to the current time', async () => {
      mocks.findById.mockResolvedValue(stored({
        broadcastState: 'claimed', broadcastLeaseExpiresAt: new Date(Date.now() - 1000),
      }));
      await expect(findHeldPolicyReservations('intent-1', txid)).resolves.toHaveLength(1);
    });
  });
});
