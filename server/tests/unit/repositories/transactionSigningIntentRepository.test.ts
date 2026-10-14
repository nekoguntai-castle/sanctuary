import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    $transaction: mocks.transaction,
    transactionSigningIntent: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  MAX_RECONCILE_ATTEMPTS,
  create,
  findById,
  claimBroadcast,
  markBroadcastAccepted,
  markBroadcastComplete,
  markBroadcastUnknown,
  releaseRejectedBroadcast,
  markBroadcastStalled,
  listBroadcastsForReconciliation,
  listStalledBroadcastsForLookup,
  claimStalledBroadcastLookup,
  markStalledBroadcastAccepted,
} from '../../../src/repositories/transactionSigningIntentRepository';

const record = {
  id: 'intent-1',
  walletId: 'wallet-1',
  createdByUserId: 'user-1',
  network: 'testnet3',
  source: 'standard',
  snapshotVersion: 1,
  snapshot: { version: 1 },
  snapshotDigest: 'a'.repeat(64),
  unsignedPsbtBase64: 'cHNi',
  unsignedPsbtSha256: 'b'.repeat(64),
  expiresAt: new Date('2030-01-01T00:00:00Z'),
};

describe('transactionSigningIntentRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async callback => callback({
      transactionSigningIntent: {
        create: mocks.create,
        updateMany: mocks.updateMany,
        findUnique: mocks.findUnique,
        findUniqueOrThrow: mocks.findUniqueOrThrow,
      },
    }));
    mocks.create.mockResolvedValue(record);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue(record);
  });

  it('creates an intent without a supersession transition', async () => {
    await expect(create(record)).resolves.toEqual(record);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: 'wallet-1',
        snapshotDigest: 'a'.repeat(64),
      }),
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('atomically supersedes the exact active predecessor', async () => {
    await create({ ...record, supersedesIntentId: 'intent-old' });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'intent-old',
        walletId: 'wallet-1',
        supersededById: null,
        consumedAt: null,
        broadcastState: 'ready',
      },
      data: { supersededById: 'intent-1' },
    });
  });

  it('rolls back when the predecessor is no longer active', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(create({ ...record, supersedesIntentId: 'intent-old' }))
      .rejects.toThrow('SIGNING_INTENT_SUPERSESSION_CONFLICT');
  });

  it('loads an intent by its unique identifier', async () => {
    mocks.findUnique.mockResolvedValueOnce(record);
    await expect(findById('intent-1')).resolves.toEqual(record);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'intent-1' } });
  });

  const claimInput = () => ({
    id: 'intent-1', digest: 'a'.repeat(64), txid: 'c'.repeat(64), rawTx: '00',
    metadata: { amount: 1 }, leaseToken: 'lease-1', now: new Date('2030-01-01T00:00:00Z'),
    leaseExpiresAt: new Date('2030-01-01T00:01:00Z'),
  });

  const guards = {
    id: 'intent-1',
    snapshotDigest: 'a'.repeat(64),
    supersededById: null,
    consumedAt: null,
  };
  const sameArtifact = { broadcastTxid: 'c'.repeat(64), broadcastRawTx: '00' };

  it('claims a ready intent first, with the exact digest guards, and reports priorState ready', async () => {
    await expect(claimBroadcast(claimInput())).resolves.toEqual({ status: 'claimed', record, priorState: 'ready' });
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { ...guards, broadcastState: 'ready' },
      data: expect.objectContaining({
        broadcastState: 'claimed',
        broadcastTxid: 'c'.repeat(64),
        broadcastLeaseToken: 'lease-1',
        broadcastAttemptCount: { increment: 1 },
      }),
    });
  });

  it('reclaims an expired claim or an unknown exact artifact as resumed', async () => {
    const input = claimInput();
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(claimBroadcast(input)).resolves.toEqual({ status: 'claimed', record, priorState: 'resumed' });
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        ...guards,
        OR: [
          { broadcastState: 'claimed', ...sameArtifact, broadcastLeaseExpiresAt: { lte: input.now } },
          { broadcastState: 'unknown', ...sameArtifact, broadcastAttemptCount: { lt: 60 } },
        ],
      },
      data: expect.objectContaining({ broadcastState: 'claimed' }),
    });
  });

  it('claims a stalled exact artifact only when allowStalled is set', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    await expect(claimBroadcast({ ...claimInput(), allowStalled: true }))
      .resolves.toEqual({ status: 'claimed', record, priorState: 'stalled' });
    expect(mocks.updateMany).toHaveBeenCalledTimes(3);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(3, {
      where: { ...guards, broadcastState: 'unknown', ...sameArtifact, broadcastAttemptCount: { gte: 60 } },
      data: expect.objectContaining({ broadcastState: 'claimed', broadcastLeaseToken: 'lease-1' }),
    });
  });

  it.each([{}, { allowStalled: false }])('does not claim a stalled row without allowStalled: %j', async (extra) => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce({
      ...record, broadcastState: 'unknown', broadcastAttemptCount: 60, ...sameArtifact, consumedAt: null,
    });
    await expect(claimBroadcast({ ...claimInput(), ...extra })).resolves.toEqual({ status: 'busy' });
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['complete', { broadcastState: 'complete', consumedAt: null }, 'complete'],
    ['accepted', { broadcastState: 'accepted', consumedAt: null }, 'accepted'],
    ['consumed', { broadcastState: 'claimed', consumedAt: new Date() }, 'accepted'],
  ])('reports a lost claim race on a %s exact artifact', async (_label, state, status) => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce({ ...record, ...sameArtifact, ...state });
    await expect(claimBroadcast(claimInput())).resolves.toEqual({ status });
  });

  it.each([
    ['missing record', null],
    ['digest', { ...record, snapshotDigest: 'd'.repeat(64), broadcastTxid: 'c'.repeat(64), broadcastRawTx: '00' }],
    ['txid', { ...record, snapshotDigest: 'a'.repeat(64), broadcastTxid: 'd'.repeat(64), broadcastRawTx: '00' }],
    ['witness', { ...record, snapshotDigest: 'a'.repeat(64), broadcastTxid: 'c'.repeat(64), broadcastRawTx: '01' }],
  ])('rejects a lost claim race with conflicting %s evidence', async (_label, current) => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce(current);
    await expect(claimBroadcast(claimInput())).resolves.toEqual({ status: 'conflict' });
  });

  it('uses lease-token compare-and-swap for unknown and accepted outcomes', async () => {
    await expect(markBroadcastUnknown('intent-1', 'lease', 'timeout')).resolves.toBe(true);
    await expect(releaseRejectedBroadcast('intent-1', 'lease', 'rejected')).resolves.toBe(true);
    await expect(markBroadcastAccepted('intent-1', 'lease')).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'intent-1', broadcastState: 'claimed', broadcastLeaseToken: 'lease' },
      data: expect.objectContaining({ broadcastState: 'accepted', consumedAt: expect.any(Date) }),
    }));
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        broadcastState: 'ready',
        broadcastTxid: null,
        broadcastRawTx: null,
        broadcastMetadata: expect.anything(),
      }),
    }));
  });

  it('reports failed lease-token and completion compare-and-swap transitions', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(markBroadcastUnknown('intent-1', 'wrong-lease', 'timeout')).resolves.toBe(false);
    await expect(markBroadcastComplete('intent-1', 'c'.repeat(64))).resolves.toBe(false);
  });

  it('lists durable uncertain broadcasts with an explicit or default batch limit', async () => {
    mocks.findMany.mockResolvedValue([]);
    const now = new Date('2030-01-01T00:00:00Z');
    await listBroadcastsForReconciliation(now);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    await listBroadcastsForReconciliation(now, 7);
    expect(mocks.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 7 }));
  });

  it('completes only an accepted record bound to the exact txid', async () => {
    await expect(markBroadcastComplete('intent-1', 'c'.repeat(64))).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'intent-1', broadcastTxid: 'c'.repeat(64), broadcastState: 'accepted' },
      data: { broadcastState: 'complete', broadcastCompletedAt: expect.any(Date) },
    });
  });

  it('gives back the claim attempt only when countAttempt is false', async () => {
    await markBroadcastUnknown('intent-1', 'lease', 'timeout');
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ broadcastAttemptCount: expect.anything() }),
    }));
    await markBroadcastUnknown('intent-1', 'lease', 'timeout', { countAttempt: true });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ broadcastAttemptCount: expect.anything() }),
    }));
    await markBroadcastUnknown('intent-1', 'lease', 'timeout', { countAttempt: false });
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'intent-1', broadcastState: 'claimed', broadcastLeaseToken: 'lease' },
      data: expect.objectContaining({
        broadcastState: 'unknown',
        broadcastAttemptCount: { decrement: 1 },
      }),
    });
  });

  it('pins the attempt cap that defines a stalled intent', () => {
    expect(MAX_RECONCILE_ATTEMPTS).toBe(60);
  });

  it('stalls a claimed intent under the lease token at the cap and keeps the raw transaction', async () => {
    await expect(markBroadcastStalled('intent-1', 'lease', 'node said no')).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'intent-1',
        broadcastState: 'claimed',
        broadcastLeaseToken: 'lease',
        broadcastAttemptCount: { gte: 60 },
      },
      data: {
        // stalled is derived: an unknown intent at the cap (the state CHECK forbids a new value)
        broadcastState: 'unknown',
        broadcastLeaseToken: null,
        broadcastLeaseExpiresAt: null,
        broadcastLastError: 'node said no',
      },
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(markBroadcastStalled('intent-1', 'wrong', 'x')).resolves.toBe(false);
  });

  it('excludes capped unknown intents from the reconciliation list', async () => {
    mocks.findMany.mockResolvedValue([]);
    await listBroadcastsForReconciliation(new Date('2030-01-01T00:00:00Z'));
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ broadcastState: 'unknown', broadcastAttemptCount: { lt: 60 } });
    expect(where.OR).toContainEqual({ broadcastState: 'accepted' });
  });

  it('lists stalled broadcasts last attempted at least an hour ago, with an explicit or default limit', async () => {
    mocks.findMany.mockResolvedValue([]);
    const now = new Date('2030-01-01T12:00:00Z');
    await listStalledBroadcastsForLookup(now);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50,
      where: expect.objectContaining({
        broadcastState: 'unknown',
        broadcastAttemptCount: { gte: 60 },
        broadcastLastAttemptAt: { lte: new Date('2030-01-01T11:00:00Z') },
      }),
    }));
    await listStalledBroadcastsForLookup(now, 7);
    expect(mocks.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 7 }));
  });

  it('bumps the stalled lookup time conditionally and reports a lost race', async () => {
    const now = new Date('2030-01-01T12:00:00Z');
    await expect(claimStalledBroadcastLookup('intent-1', now)).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'intent-1',
        broadcastState: 'unknown',
        broadcastAttemptCount: { gte: 60 },
        broadcastLastAttemptAt: { lte: new Date('2030-01-01T11:00:00Z') },
      },
      data: { broadcastLastAttemptAt: now },
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(claimStalledBroadcastLookup('intent-1', now)).resolves.toBe(false);
  });

  it('accepts a stalled intent without a lease, setting the markBroadcastAccepted field set', async () => {
    const now = new Date('2030-01-01T12:00:00Z');
    await expect(markStalledBroadcastAccepted('intent-1', 'c'.repeat(64), now)).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'intent-1', broadcastState: 'unknown', broadcastAttemptCount: { gte: 60 }, broadcastTxid: 'c'.repeat(64),
      },
      data: {
        broadcastState: 'accepted',
        broadcastLeaseToken: null,
        broadcastLeaseExpiresAt: null,
        broadcastAcceptedAt: now,
        consumedAt: now,
        broadcastLastError: null,
      },
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(markStalledBroadcastAccepted('intent-1', 'c'.repeat(64))).resolves.toBe(false);
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ broadcastAcceptedAt: expect.any(Date) }),
    }));
  });
});
