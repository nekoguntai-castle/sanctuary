import { vi } from 'vitest';
/**
 * TOTP Single-Use Concurrency Integration Test
 *
 * P2 finding totp-code-replay-within-tolerance-window: `twoFactorService.verifyToken`
 * was stateless, so the same 6-digit code stayed valid for its whole clock-drift
 * tolerance window and could be submitted more than once. `sessionRepository.consumeTotpStep`
 * closes this by recording each accepted TOTP time step as a one-time marker row in
 * `revoked_tokens` (no schema change: the release gate pins the migration tree's
 * SHA-256, so this phase cannot add a migration). The marker's primary key (`jti`)
 * is the atomic one-time boundary: two concurrent submissions of the same accepted
 * time step race on the same `jti` insert and exactly one insert wins.
 *
 * This exercises that race against a real PostgreSQL connection pool (two genuinely
 * concurrent inserts), which a single rolled-back `withTestTransaction` cannot prove.
 *
 * Requires a running PostgreSQL database.
 * Set DATABASE_URL or TEST_DATABASE_URL environment variable.
 *
 * Run with: npm run test:integration
 */

import { sessionRepository } from '../../../src/repositories/sessionRepository';
import { createTestUser } from '../repositories/setup';
import { canRunIntegrationTests, getTestPrisma } from '../repositories/setup/database';

vi.setConfig({ testTimeout: 30000 });

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('TOTP single-use marker - concurrency (real PostgreSQL)', () => {
  const userIds: string[] = [];

  afterAll(async () => {
    if (userIds.length === 0) return;
    const prisma = await getTestPrisma();
    // The user FK cascade-deletes its revoked_tokens rows too, but this stays
    // explicit and order-independent in case that ever changes.
    await prisma.revokedToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function makeUser() {
    const prisma = await getTestPrisma();
    const user = await createTestUser(prisma, {
      username: `totp-replay-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      twoFactorEnabled: true,
      twoFactorSecret: 'irrelevant-for-this-test',
    });
    userIds.push(user.id);
    return user;
  }

  it('lets exactly one of two concurrent submissions of the same accepted time step win', async () => {
    const user = await makeUser();
    const timeStep = 41152264;

    const [first, second] = await Promise.all([
      sessionRepository.consumeTotpStep(user.id, timeStep),
      sessionRepository.consumeTotpStep(user.id, timeStep),
    ]);

    // Exactly one of the two genuinely concurrent inserts must have won.
    expect([first, second].filter(Boolean)).toHaveLength(1);

    const prisma = await getTestPrisma();
    const marker = await prisma.revokedToken.findUnique({
      where: { jti: `totp-step:${user.id}:${timeStep}` },
    });
    expect(marker).not.toBeNull();
    expect(marker?.reason).toBe('totp-step-consumed');
  });

  it('rejects a repeat of an already-consumed step once it is durably stored', async () => {
    const user = await makeUser();
    const timeStep = 41152300;

    const firstConsume = await sessionRepository.consumeTotpStep(user.id, timeStep);
    expect(firstConsume).toBe(true);

    // Today's bug: the same step (i.e. the same TOTP code) submitted again after
    // the first request has already completed must still be rejected.
    const replayConsume = await sessionRepository.consumeTotpStep(user.id, timeStep);
    expect(replayConsume).toBe(false);
  });

  it('accepts a different (e.g. later) time step than the one already consumed', async () => {
    const user = await makeUser();
    const firstStep = 41152400;
    const laterStep = 41152401;

    expect(await sessionRepository.consumeTotpStep(user.id, firstStep)).toBe(true);
    expect(await sessionRepository.consumeTotpStep(user.id, laterStep)).toBe(true);

    const prisma = await getTestPrisma();
    const count = await prisma.revokedToken.count({ where: { userId: user.id } });
    expect(count).toBe(2);
  });
});
