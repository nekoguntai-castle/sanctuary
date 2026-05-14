import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import appPrisma, { disconnect as disconnectAppPrisma } from '../../../src/models/prisma';
import {
  findOrCreateUsageWindow,
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
});
