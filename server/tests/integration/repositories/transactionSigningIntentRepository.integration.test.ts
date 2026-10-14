import { afterEach, describe, expect, it } from 'vitest';
import prisma from '../../../src/models/prisma';
import {
  claimBroadcast,
  claimStalledBroadcastLookup,
  create,
  listBroadcastsForReconciliation,
  listStalledBroadcastsForLookup,
  markBroadcastStalled,
  markBroadcastUnknown,
  markStalledBroadcastAccepted,
} from '../../../src/repositories/transactionSigningIntentRepository';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const intentIds = ['integration-intent-unknown'];
const digest = 'a'.repeat(64);
const txid = 'b'.repeat(64);

const baseIntent = (id: string) => ({
  id,
  walletId: 'integration-wallet',
  createdByUserId: 'integration-user',
  network: 'regtest',
  source: 'payjoin',
  snapshotVersion: 1,
  snapshot: { version: 1 },
  snapshotDigest: digest,
  unsignedPsbtBase64: 'cHNi',
  unsignedPsbtSha256: 'c'.repeat(64),
  expiresAt: new Date(Date.now() + 60_000),
});

describeWithDatabase('transaction signing intent repository integration', () => {
  afterEach(async () => {
    await prisma.transactionSigningIntent.deleteMany({ where: { walletId: 'integration-wallet' } });
  });

  it('atomically reclaims an unknown exact artifact whose lease is null', async () => {
    await prisma.transactionSigningIntent.create({
      data: {
        ...baseIntent(intentIds[0]),
        broadcastState: 'unknown',
        broadcastTxid: txid,
        broadcastRawTx: '00',
        broadcastMetadata: { amount: 1 },
        broadcastAttemptCount: 1,
      },
    });

    const now = new Date();
    const result = await claimBroadcast({
      id: intentIds[0],
      digest,
      txid,
      rawTx: '00',
      metadata: { amount: 1 },
      leaseToken: 'integration-lease',
      now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    });

    expect(result.status).toBe('claimed');
    expect(await prisma.transactionSigningIntent.findUnique({
      where: { id: intentIds[0] },
      select: { broadcastState: true, broadcastLeaseToken: true },
    })).toEqual({ broadcastState: 'claimed', broadcastLeaseToken: 'integration-lease' });
  });

  it('refuses to supersede an uncertain predecessor and rolls back the successor', async () => {
    await prisma.transactionSigningIntent.create({
      data: {
        ...baseIntent(intentIds[0]),
        broadcastState: 'unknown',
        broadcastTxid: txid,
        broadcastRawTx: '00',
        broadcastMetadata: { amount: 1 },
        broadcastAttemptCount: 1,
      },
    });

    await expect(create({
      ...baseIntent('ignored-generated-id'),
      supersedesIntentId: intentIds[0],
    })).rejects.toThrow('SIGNING_INTENT_SUPERSESSION_CONFLICT');
    await expect(prisma.transactionSigningIntent.count({
      where: { walletId: 'integration-wallet' },
    })).resolves.toBe(1);
  });

  describe('claim prior state and stalled intents', () => {
    const seed = (id: string, overrides: Record<string, unknown> = {}) => prisma.transactionSigningIntent.create({
      data: {
        ...baseIntent(id),
        broadcastTxid: txid,
        broadcastRawTx: '00',
        broadcastMetadata: { amount: 1 },
        broadcastAttemptCount: 1,
        ...overrides,
      },
    });
    const claim = (id: string, extra: { allowStalled?: boolean } = {}) => {
      const now = new Date();
      return claimBroadcast({
        id, digest, txid, rawTx: '00', metadata: { amount: 1 }, leaseToken: `lease-${id}`,
        now, leaseExpiresAt: new Date(now.getTime() + 60_000), ...extra,
      });
    };
    const hourAgo = () => new Date(Date.now() - 61 * 60_000);

    it('reports ready for a first claim and resumed for an unknown artifact', async () => {
      await seed('integration-intent-ready', { broadcastState: 'ready', broadcastTxid: null, broadcastRawTx: null, broadcastMetadata: undefined });
      await seed('integration-intent-resumed', { broadcastState: 'unknown' });
      await expect(claim('integration-intent-ready')).resolves.toMatchObject({ status: 'claimed', priorState: 'ready' });
      await expect(claim('integration-intent-resumed')).resolves.toMatchObject({ status: 'claimed', priorState: 'resumed' });
    });

    it('claims a stalled intent only when allowStalled is set', async () => {
      await seed('integration-intent-stalled', { broadcastState: 'unknown', broadcastAttemptCount: 60 });
      await expect(claim('integration-intent-stalled')).resolves.toEqual({ status: 'busy' });
      await expect(claim('integration-intent-stalled', { allowStalled: false })).resolves.toEqual({ status: 'busy' });
      await expect(claim('integration-intent-stalled', { allowStalled: true }))
        .resolves.toMatchObject({ status: 'claimed', priorState: 'stalled' });
    });

    it('gives an unanswered attempt back and excludes stalled intents from reconciliation', async () => {
      await seed('integration-intent-count', { broadcastState: 'unknown', broadcastAttemptCount: 3 });
      const claimed = await claim('integration-intent-count');
      expect(claimed).toMatchObject({ status: 'claimed', record: { broadcastAttemptCount: 4 } });
      await markBroadcastUnknown('integration-intent-count', 'lease-integration-intent-count', 'timeout', { countAttempt: false });
      await expect(prisma.transactionSigningIntent.findUnique({
        where: { id: 'integration-intent-count' }, select: { broadcastAttemptCount: true, broadcastState: true },
      })).resolves.toEqual({ broadcastAttemptCount: 3, broadcastState: 'unknown' });

      // Below the cap the stall transition is refused and the intent stays reconcilable.
      await claim('integration-intent-count');
      await expect(markBroadcastStalled('integration-intent-count', 'lease-integration-intent-count', 'early')).resolves.toBe(false);

      await prisma.transactionSigningIntent.update({
        where: { id: 'integration-intent-count' }, data: { broadcastAttemptCount: 60 },
      });
      await expect(markBroadcastStalled('integration-intent-count', 'lease-integration-intent-count', 'capped')).resolves.toBe(true);
      const listed = await listBroadcastsForReconciliation(new Date());
      expect(listed.map(row => row.id)).not.toContain('integration-intent-count');
      await expect(listStalledBroadcastsForLookup(new Date(Date.now() + 2 * 60 * 60_000)))
        .resolves.toEqual([expect.objectContaining({ id: 'integration-intent-count', broadcastState: 'unknown' })]);
    });

    it('looks up a stalled intent at most hourly and accepts it with consumedAt set', async () => {
      await seed('integration-intent-old', { broadcastState: 'unknown', broadcastAttemptCount: 60, broadcastLastAttemptAt: hourAgo() });
      await seed('integration-intent-recent', { broadcastState: 'unknown', broadcastAttemptCount: 60, broadcastLastAttemptAt: new Date() });
      const now = new Date();
      const due = await listStalledBroadcastsForLookup(now);
      expect(due.map(row => row.id)).toEqual(['integration-intent-old']);

      await expect(claimStalledBroadcastLookup('integration-intent-old', now)).resolves.toBe(true);
      await expect(claimStalledBroadcastLookup('integration-intent-old', now)).resolves.toBe(false);
      await expect(listStalledBroadcastsForLookup(now)).resolves.toEqual([]);

      await expect(markStalledBroadcastAccepted('integration-intent-old', txid, now)).resolves.toBe(true);
      const accepted = await prisma.transactionSigningIntent.findUnique({ where: { id: 'integration-intent-old' } });
      expect(accepted).toMatchObject({
        broadcastState: 'accepted', broadcastLeaseToken: null, broadcastLastError: null,
      });
      expect(accepted?.consumedAt).toEqual(now);
      expect(accepted?.broadcastAcceptedAt).toEqual(now);
      await expect(markStalledBroadcastAccepted('integration-intent-old', txid, now)).resolves.toBe(false);
    });
  });
});
