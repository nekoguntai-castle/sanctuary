import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import appPrisma, { disconnect as disconnectAppPrisma } from '../../../src/models/prisma';
import {
  findOrCreateUsageWindow,
  releaseUsageWindow,
  reserveUsageWindow,
  WALLET_SCOPED_USAGE_WINDOW_USER_ID,
} from '../../../src/repositories/policyRepository';
import {
  cleanupTestData,
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  disconnectTestDatabase,
  getTestPrisma,
} from './setup';

describeIfDatabase('PolicyRepository audit regressions', () => {
  beforeAll(async () => {
    await getTestPrisma();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDatabase();
    await disconnectAppPrisma();
  });

  it('persists wallet-scoped usage windows with a non-null user id', async () => {
    const db = await getTestPrisma();
    const user = await createTestUser(db, {
      username: 'policy-window-owner',
      email: 'policy-window-owner@example.com',
    });
    const wallet = await createTestWallet(db, user.id);
    const policy = await db.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Daily spending limit',
        type: 'spending_limit',
        config: { limitSats: 100_000 },
        createdBy: user.id,
        sourceType: 'wallet',
      },
    });
    const windowStart = new Date('2026-05-13T00:00:00.000Z');
    const windowEnd = new Date('2026-05-14T00:00:00.000Z');

    const first = await findOrCreateUsageWindow({
      policyId: policy.id,
      walletId: wallet.id,
      windowType: 'daily',
      windowStart,
      windowEnd,
    });
    const second = await findOrCreateUsageWindow({
      policyId: policy.id,
      walletId: wallet.id,
      windowType: 'daily',
      windowStart,
      windowEnd,
    });

    expect(second.id).toBe(first.id);
    await expect(
      db.$executeRaw`
        INSERT INTO "policy_usage_windows"
          ("id", "policyId", "walletId", "userId", "windowType", "windowStart", "windowEnd", "totalSpent", "txCount", "updatedAt")
        VALUES
          ('policy-window-null-user-regression', ${policy.id}, ${wallet.id}, NULL, 'daily', ${windowStart}, ${windowEnd}, 0, 0, CURRENT_TIMESTAMP)
      `
    ).rejects.toThrow();

    const rows = await db.policyUsageWindow.findMany({
      where: {
        policyId: policy.id,
        walletId: wallet.id,
        windowType: 'daily',
        windowStart,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(WALLET_SCOPED_USAGE_WINDOW_USER_ID);

    await appPrisma.policyUsageWindow.findUniqueOrThrow({ where: { id: first.id } });
  });

  it('lets exactly one of two concurrent reservations through a real Postgres window and never exceeds the limit', async () => {
    // Non-regression for the spending-limit/velocity TOCTOU bypass: two
    // concurrent 600k reservations against a 1,000,000 daily limit must not
    // both succeed. reserveUsageWindow's conditional updateMany is the
    // atomicity guarantee; this proves it against a real database rather
    // than a mocked Prisma client, where the row-level guard can't be faked.
    const db = await getTestPrisma();
    const user = await createTestUser(db, {
      username: 'policy-reservation-owner',
      email: 'policy-reservation-owner@example.com',
    });
    const wallet = await createTestWallet(db, user.id);
    const policy = await db.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Daily spending limit',
        type: 'spending_limit',
        config: { daily: 1_000_000, scope: 'wallet' },
        createdBy: user.id,
        sourceType: 'wallet',
      },
    });
    const windowStart = new Date('2026-05-13T00:00:00.000Z');
    const windowEnd = new Date('2026-05-14T00:00:00.000Z');

    const window = await findOrCreateUsageWindow({
      policyId: policy.id,
      walletId: wallet.id,
      windowType: 'daily',
      windowStart,
      windowEnd,
    });

    const [first, second] = await Promise.all([
      reserveUsageWindow({ windowId: window.id, amount: BigInt(600_000), spendLimit: BigInt(1_000_000) }),
      reserveUsageWindow({ windowId: window.id, amount: BigInt(600_000), spendLimit: BigInt(1_000_000) }),
    ]);

    const counts = [first.count, second.count].sort();
    expect(counts).toEqual([0, 1]);

    const settled = await appPrisma.policyUsageWindow.findUniqueOrThrow({ where: { id: window.id } });
    expect(settled.totalSpent).toBe(BigInt(600_000));
    expect(settled.totalSpent <= BigInt(1_000_000)).toBe(true);
    expect(settled.txCount).toBe(1);
  });

  it('releasing a zero-amount velocity reservation actually lowers txCount in Postgres', async () => {
    const db = await getTestPrisma();
    const user = await createTestUser(db, {
      username: 'policy-velocity-release-owner',
      email: 'policy-velocity-release-owner@example.com',
    });
    const wallet = await createTestWallet(db, user.id);
    const policy = await db.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Daily velocity limit',
        type: 'velocity',
        config: { maxPerDay: 10, scope: 'wallet' },
        createdBy: user.id,
        sourceType: 'wallet',
      },
    });
    const windowStart = new Date('2026-05-13T00:00:00.000Z');
    const windowEnd = new Date('2026-05-14T00:00:00.000Z');

    const window = await findOrCreateUsageWindow({
      policyId: policy.id,
      walletId: wallet.id,
      windowType: 'daily',
      windowStart,
      windowEnd,
    });

    const reserved = await reserveUsageWindow({ windowId: window.id, amount: BigInt(0), txLimit: 10 });
    expect(reserved.count).toBe(1);
    const afterReserve = await appPrisma.policyUsageWindow.findUniqueOrThrow({ where: { id: window.id } });
    expect(afterReserve.txCount).toBe(1);
    expect(afterReserve.totalSpent).toBe(BigInt(0));

    await releaseUsageWindow({ windowId: window.id, amount: BigInt(0) });

    const afterRelease = await appPrisma.policyUsageWindow.findUniqueOrThrow({ where: { id: window.id } });
    expect(afterRelease.txCount).toBe(0);
    expect(afterRelease.totalSpent).toBe(BigInt(0));
  });
});
