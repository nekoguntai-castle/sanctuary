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

  it('returns the claimed row source so a source-specific pre-network check reads the locked intent', async () => {
    mocks.claim.mockResolvedValue({ status: 'claimed', record: { source: 'cpfp' }, priorState: 'ready' });

    await expect(claimSigningIntentBroadcast(artifact, metadata))
      .resolves.toEqual({ status: 'claimed', leaseToken: expect.any(String), priorState: 'ready', source: 'cpfp' });
  });

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

describe('durable broadcast metadata boundaries', () => {
  const TXID = 'c'.repeat(64);
  const accepts = (value: unknown): boolean => DurableBroadcastMetadataSchema.safeParse(value).success;
  const withInput = (overrides: Record<string, unknown>) => ({
    ...metadata,
    inputs: [{ txid: TXID, vout: 0, address: 'tb1qinput', amount: 5, ...overrides }],
  });
  const withOutput = (overrides: Record<string, unknown>) => ({
    ...metadata,
    outputs: [{ address: 'tb1qoutput', amount: 4, outputType: 'recipient', isOurs: false, ...overrides }],
  });

  it('accepts the baseline metadata, inputs and outputs every case below varies', () => {
    expect(accepts(metadata)).toBe(true);
    expect(accepts(withInput({}))).toBe(true);
    expect(accepts(withOutput({}))).toBe(true);
  });

  it.each([
    ['a leading extra character', `x${TXID}`],
    ['a trailing extra character', `${TXID}x`],
    ['63 hex characters', TXID.slice(1)],
  ])('rejects a txid with %s', (_reason, txid) => {
    expect(accepts({ ...metadata, utxos: [{ txid, vout: 0 }] })).toBe(false);
    expect(accepts({ ...metadata, replacesTxid: txid })).toBe(false);
  });

  it('requires at least one spent outpoint and accepts several', () => {
    expect(accepts({ ...metadata, utxos: [] })).toBe(false);
    expect(accepts({ ...metadata, utxos: [{ txid: TXID, vout: 0 }, { txid: TXID, vout: 1 }] })).toBe(true);
  });

  it('rejects an empty draft id or derivation path and accepts longer ones', () => {
    expect(accepts({ ...metadata, draftId: '' })).toBe(false);
    expect(accepts({ ...metadata, draftId: 'draft-12' })).toBe(true);
    expect(accepts(withInput({ derivationPath: '' }))).toBe(false);
    expect(accepts(withInput({ derivationPath: "m/84'/1'/0'/0/5" }))).toBe(true);
  });

  it.each(['recipient', 'change', 'decoy', 'consolidation', 'unknown'])('accepts the output type %s', (outputType) => {
    expect(accepts(withOutput({ outputType }))).toBe(true);
  });

  it.each(['', 'fee', 'Recipient'])('rejects the output type %j', (outputType) => {
    expect(accepts(withOutput({ outputType }))).toBe(false);
  });

  it.each(['00', '0014ab'])('accepts the output script %s', (scriptPubKey) => {
    expect(accepts(withOutput({ scriptPubKey }))).toBe(true);
  });

  it.each(['', 'a', 'abc', 'zz00', '00zz', '00AB'])('rejects the output script %j', (scriptPubKey) => {
    expect(accepts(withOutput({ scriptPubKey }))).toBe(false);
  });
});

describe('signing intent broadcast claim errors', () => {
  beforeEach(() => vi.clearAllMocks());

  // The route maps `reason` to its response, so the details are part of the contract.
  it('reports malformed metadata as a metadata mismatch on the metadata field', async () => {
    await expect(claimSigningIntentBroadcast(artifact, { ...metadata, recipient: '' })).rejects.toMatchObject({
      message: 'Broadcast metadata is malformed',
      details: { reason: 'metadata_mismatch', field: 'metadata' },
    });
  });

  it('reports a live lease as a duplicate submission', async () => {
    mocks.claim.mockResolvedValue({ status: 'busy' });

    await expect(claimSigningIntentBroadcast(artifact, metadata)).rejects.toMatchObject({
      message: 'Signing intent broadcast is already in progress',
      statusCode: 409,
      details: { reason: 'duplicate_submission' },
    });
  });

  it('reports a digest or txid conflict as a metadata mismatch on the intent id', async () => {
    mocks.claim.mockResolvedValue({ status: 'conflict' });

    await expect(claimSigningIntentBroadcast(artifact, metadata)).rejects.toMatchObject({
      message: 'Signing intent does not match the broadcast artifact',
      details: { reason: 'metadata_mismatch', field: 'intentId' },
    });
  });
});

describe('held policy reservations of a finished intent', () => {
  // An expired lease only matters while the intent is still `claimed`.
  it.each(['accepted', 'complete', 'ready', 'rejected'])(
    'returns null for a %s intent even when its old lease has expired',
    async (broadcastState) => {
      const now = new Date('2030-01-01T00:00:00Z');
      mocks.findById.mockResolvedValue({
        broadcastState,
        broadcastTxid: 'b'.repeat(64),
        broadcastLeaseExpiresAt: new Date(now.getTime() - 1),
        broadcastMetadata: { ...metadata, policyReservations: [{ windowId: 'w1', amount: '9000' }] },
      });

      await expect(findHeldPolicyReservations('intent-1', 'b'.repeat(64), now)).resolves.toBeNull();
    },
  );
});
