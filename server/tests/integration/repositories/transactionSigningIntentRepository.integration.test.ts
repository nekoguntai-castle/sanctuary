import { afterEach, describe, expect, it } from 'vitest';
import prisma from '../../../src/models/prisma';
import {
  claimBroadcast,
  claimStalledBroadcastLookup,
  create,
  listBroadcastsForReconciliation,
  lockDraftableIntent,
  listStalledBroadcastsForLookup,
  markBroadcastStalled,
  markBroadcastUnknown,
  markStalledBroadcastAccepted,
  restorePayjoinOriginal,
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

const RESTORE_WALLET = 'integration-wallet-restore';

/** A ready original superseded by a ready payjoin replacement, as /payjoin/attempt leaves them. */
async function seedPayjoinPair(): Promise<{ originalId: string; replacementId: string }> {
  const original = await create({ ...baseIntent('ignored'), walletId: RESTORE_WALLET, source: 'standard' });
  const replacement = await create({
    ...baseIntent('ignored'),
    walletId: RESTORE_WALLET,
    snapshotDigest: 'd'.repeat(64),
    supersedesIntentId: original.id,
  });
  return { originalId: original.id, replacementId: replacement.id };
}

function claimReplacement(replacementId: string) {
  const now = new Date();
  return claimBroadcast({
    id: replacementId, digest: 'd'.repeat(64), txid, rawTx: '00', metadata: { amount: 1 },
    leaseToken: 'restore-lease', now, leaseExpiresAt: new Date(now.getTime() + 60_000),
  });
}

/**
 * Wait until `count` backends are blocked behind the lock holder, else fail with
 * `${what} within 3 seconds`. The contenders run in the repository's own
 * interactive transactions (Prisma's 5 s default), so the deadline stays well
 * under it.
 */
async function waitForLockWaiters(holderPid: number, count: number, what: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    // A later waiter queues behind the first one's tuple lock, so it counts
    // when it is blocked by the holder or by a backend the holder blocks.
    const rows = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      WITH direct AS (
        SELECT pid FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND ${holderPid}::int = ANY(pg_blocking_pids(pid))
      )
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND (${holderPid}::int = ANY(pg_blocking_pids(pid))
          OR pg_blocking_pids(pid) && ARRAY(SELECT pid FROM direct))
    `;
    if (Number(rows[0].waiting) >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`${what} within 3 seconds`);
}

/** Hold the replacement's row lock until `release` resolves; reports the holder pid. */
function holdReplacementLock(replacementId: string, release: Promise<void>, onLocked: (pid: number) => void) {
  return prisma.$transaction(async tx => {
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM transaction_signing_intents WHERE id = ${replacementId} FOR UPDATE`;
    onLocked(pid);
    await release;
  }, { maxWait: 5_000, timeout: 15_000 });
}

describeWithDatabase('draftable intent lock integration', () => {
  const DRAFT_WALLET = 'integration-draft-lock-wallet';
  const intent = (id: string) => ({ ...baseIntent(id), walletId: DRAFT_WALLET, source: 'standard' });
  const claimFields = () => ({
    broadcastState: 'claimed', broadcastTxid: txid, broadcastRawTx: '00', broadcastMetadata: { amount: 1 },
    broadcastLeaseToken: 'draft-lock-lease', broadcastLeaseExpiresAt: new Date(Date.now() + 60_000),
  });

  afterEach(async () => {
    await prisma.transactionSigningIntent.deleteMany({ where: { walletId: DRAFT_WALLET } });
  });

  it('refuses to bind a draft to an intent whose broadcast has started', async () => {
    await prisma.transactionSigningIntent.create({ data: intent('draft-lock-ready') });
    await prisma.transactionSigningIntent.create({ data: { ...intent('draft-lock-claimed'), ...claimFields() } });
    await prisma.transactionSigningIntent.create({
      data: {
        ...intent('draft-lock-unknown'), ...claimFields(),
        broadcastState: 'unknown', broadcastLeaseToken: null, broadcastLeaseExpiresAt: null,
      },
    });

    await expect(lockDraftableIntent('draft-lock-ready', DRAFT_WALLET, prisma)).resolves.toBe(true);
    for (const id of ['draft-lock-claimed', 'draft-lock-unknown']) {
      await expect(lockDraftableIntent(id, DRAFT_WALLET, prisma)).resolves.toBe(false);
    }
  });

  it('a draft lock waiting behind a claim matches nothing once the claim commits', async () => {
    await prisma.transactionSigningIntent.create({ data: intent('draft-lock-race') });
    let releaseLock!: () => void;
    const release = new Promise<void>(resolve => { releaseLock = resolve; });
    let holderPid = 0;
    let locked!: () => void;
    const lockTaken = new Promise<void>(resolve => { locked = resolve; });
    const holder = prisma.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx.transactionSigningIntent.update({ where: { id: 'draft-lock-race' }, data: claimFields() });
      holderPid = pid;
      locked();
      await release;
    }, { maxWait: 5_000, timeout: 15_000 });
    await lockTaken;

    const draftLock = prisma.$transaction(tx => lockDraftableIntent('draft-lock-race', DRAFT_WALLET, tx));
    try {
      await waitForLockWaiters(holderPid, 1, 'The draft lock did not block on the claimed row');
    } finally {
      releaseLock();
    }
    const [lockResult] = await Promise.all([draftLock, holder]);
    expect(lockResult).toBe(false);
  });
});

describeWithDatabase('payjoin original restoration integration', () => {
  afterEach(async () => {
    await prisma.transactionSigningIntent.deleteMany({ where: { walletId: RESTORE_WALLET } });
  });

  it('restores the original so it can be claimed while the proposal claim conflicts', async () => {
    const { originalId, replacementId } = await seedPayjoinPair();

    await expect(restorePayjoinOriginal(originalId, RESTORE_WALLET, digest)).resolves.toBe('restored');
    await expect(restorePayjoinOriginal(originalId, RESTORE_WALLET, digest)).resolves.toBe('not_superseded');

    const rows = await prisma.transactionSigningIntent.findMany({
      where: { walletId: RESTORE_WALLET },
      select: { id: true, supersededById: true, broadcastState: true, broadcastMetadata: true },
    });
    expect(rows).toEqual(expect.arrayContaining([
      { id: originalId, supersededById: null, broadcastState: 'ready', broadcastMetadata: null },
      { id: replacementId, supersededById: originalId, broadcastState: 'ready', broadcastMetadata: null },
    ]));
    await expect(claimReplacement(replacementId)).resolves.toEqual({ status: 'conflict' });
    const now = new Date();
    await expect(claimBroadcast({
      id: originalId, digest, txid, rawTx: '00', metadata: { amount: 1 }, leaseToken: 'original-lease',
      now, leaseExpiresAt: new Date(now.getTime() + 60_000),
    })).resolves.toMatchObject({ status: 'claimed', priorState: 'ready' });
  });

  it('lets exactly one of a proposal claim and an original restore win a forced race', async () => {
    const { originalId, replacementId } = await seedPayjoinPair();
    let releaseLock!: () => void;
    const release = new Promise<void>(resolve => { releaseLock = resolve; });
    let holderPid = 0;
    let locked!: () => void;
    const lockTaken = new Promise<void>(resolve => { locked = resolve; });
    const holder = holdReplacementLock(replacementId, release, (pid) => { holderPid = pid; locked(); });
    await lockTaken;

    const claim = claimReplacement(replacementId);
    const restore = restorePayjoinOriginal(originalId, RESTORE_WALLET, digest);
    try {
      await waitForLockWaiters(holderPid, 2, 'Claim and restore did not both block on the replacement row lock');
    } finally {
      releaseLock();
    }
    const [claimResult, restoreResult] = await Promise.all([claim, restore, holder]);

    const replacement = await prisma.transactionSigningIntent.findUniqueOrThrow({ where: { id: replacementId } });
    const original = await prisma.transactionSigningIntent.findUniqueOrThrow({ where: { id: originalId } });
    if (claimResult.status === 'claimed') {
      expect(restoreResult).toBe('in_flight');
      expect(original.supersededById).toBe(replacementId);
      expect(replacement.broadcastState).toBe('claimed');
    } else {
      expect(claimResult).toEqual({ status: 'conflict' });
      expect(restoreResult).toBe('restored');
      expect(replacement.supersededById).toBe(originalId);
      expect(original.supersededById).toBeNull();
    }
  });
});
