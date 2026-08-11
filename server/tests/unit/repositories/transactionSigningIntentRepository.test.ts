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
  create,
  findById,
  claimBroadcast,
  markBroadcastAccepted,
  markBroadcastComplete,
  markBroadcastUnknown,
  releaseRejectedBroadcast,
  listBroadcastsForReconciliation,
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

  it('atomically claims the exact digest and txid before network submission', async () => {
    const input = claimInput();
    await expect(claimBroadcast(input)).resolves.toEqual({ status: 'claimed', record });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'intent-1',
        snapshotDigest: 'a'.repeat(64),
        supersededById: null,
        consumedAt: null,
        OR: [
          { broadcastState: 'ready' },
          {
            broadcastState: 'claimed',
            broadcastTxid: 'c'.repeat(64),
            broadcastRawTx: '00',
            broadcastLeaseExpiresAt: { lte: input.now },
          },
          {
            broadcastState: 'unknown',
            broadcastTxid: 'c'.repeat(64),
            broadcastRawTx: '00',
          },
        ],
      },
      data: expect.objectContaining({
        broadcastState: 'claimed', broadcastTxid: 'c'.repeat(64), broadcastLeaseToken: 'lease-1',
      }),
    });
  });

  it('reclaims an unknown exact artifact without requiring a null lease to expire', async () => {
    await claimBroadcast(claimInput());
    const where = mocks.updateMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({
      broadcastState: 'unknown',
      broadcastTxid: 'c'.repeat(64),
      broadcastRawTx: '00',
    });
    expect(where.OR).toContainEqual({
      broadcastState: 'claimed',
      broadcastTxid: 'c'.repeat(64),
      broadcastRawTx: '00',
      broadcastLeaseExpiresAt: { lte: claimInput().now },
    });
  });

  it.each([
    ['complete', 'complete'], ['accepted', 'accepted'], ['claimed', 'busy'],
  ] as const)('returns idempotent/busy state when a claim loses the race: %s', async (state, expected) => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUnique.mockResolvedValueOnce({
      ...record, broadcastState: state, broadcastTxid: 'c'.repeat(64), broadcastRawTx: '00', consumedAt: null,
    });
    expect((await claimBroadcast(claimInput())).status).toBe(expected);
  });

  it.each([
    ['missing record', null],
    ['digest', { ...record, snapshotDigest: 'd'.repeat(64), broadcastTxid: 'c'.repeat(64), broadcastRawTx: '00' }],
    ['txid', { ...record, snapshotDigest: 'a'.repeat(64), broadcastTxid: 'd'.repeat(64), broadcastRawTx: '00' }],
    ['witness', { ...record, snapshotDigest: 'a'.repeat(64), broadcastTxid: 'c'.repeat(64), broadcastRawTx: '01' }],
  ])('rejects a lost claim race with conflicting %s evidence', async (_label, current) => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
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
});
