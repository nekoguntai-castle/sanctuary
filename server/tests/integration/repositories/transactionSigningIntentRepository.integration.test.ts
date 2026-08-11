import { afterEach, describe, expect, it } from 'vitest';
import prisma from '../../../src/models/prisma';
import {
  claimBroadcast,
  create,
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
});
