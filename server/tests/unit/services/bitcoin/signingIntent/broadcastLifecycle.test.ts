import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), unknown: vi.fn(), rejected: vi.fn(), accepted: vi.fn(), complete: vi.fn(),
}));
vi.mock('../../../../../src/repositories/transactionSigningIntentRepository', () => ({
  transactionSigningIntentRepository: {
    claimBroadcast: mocks.claim,
    markBroadcastUnknown: mocks.unknown,
    releaseRejectedBroadcast: mocks.rejected,
    markBroadcastAccepted: mocks.accepted,
    markBroadcastComplete: mocks.complete,
  },
}));

import {
  claimSigningIntentBroadcast,
  markSigningIntentBroadcastAccepted,
  markSigningIntentBroadcastComplete,
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
    mocks.claim.mockResolvedValue({ status: 'claimed', record: {} });
    const now = new Date('2030-01-01T00:00:00Z');
    const result = await claimSigningIntentBroadcast(artifact, metadata, now);
    expect(result).toEqual({ status: 'claimed', leaseToken: expect.any(String) });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      id: 'intent-1', digest: 'a'.repeat(64), txid: 'b'.repeat(64), rawTx: '00', metadata,
      now, leaseExpiresAt: new Date('2030-01-01T00:01:00Z'),
    }));
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

  it('delegates every lease-bound outcome transition', async () => {
    mocks.unknown.mockResolvedValue(true);
    mocks.rejected.mockResolvedValue(true);
    mocks.accepted.mockResolvedValue(true);
    mocks.complete.mockResolvedValue(true);
    await expect(markSigningIntentBroadcastUnknown('intent-1', 'lease', 'timeout')).resolves.toBe(true);
    await expect(releaseRejectedSigningIntentBroadcast('intent-1', 'lease', 'rejected')).resolves.toBe(true);
    await expect(markSigningIntentBroadcastAccepted('intent-1', 'lease')).resolves.toBe(true);
    await expect(markSigningIntentBroadcastComplete('intent-1', 'txid')).resolves.toBe(true);
  });
});
