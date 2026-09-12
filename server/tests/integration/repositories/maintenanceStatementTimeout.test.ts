/**
 * Maintenance statement-timeout integration tests.
 *
 * These exist because the unit layer for this code path mocks `prisma`
 * entirely, so it asserted the *shape* of a statement PostgreSQL would never
 * accept. `SET statement_timeout = ${value}` through `$executeRaw` binds the
 * value as a query parameter, and `SET` is a utility command that takes no
 * parameter — so the weekly VACUUM job failed with
 * `syntax error at or near "$1"` before doing any work, and no mocked test
 * could see it.
 *
 * The point of this file is to run the real statement against a real server.
 */

import { describeIfDatabase, setupRepositoryTests, getTestPrisma } from './setup';
import { expect, it } from 'vitest';

describeIfDatabase('maintenance statement timeout', () => {
  setupRepositoryTests();

  it('applies a bounded statement_timeout through set_config', async () => {
    const prisma = await getTestPrisma();

    await prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(12345)}, false)`;

    const [{ statement_timeout: applied }] = await prisma.$queryRaw<
      { statement_timeout: string }[]
    >`SHOW statement_timeout`;

    // PostgreSQL normalises a bare integer setting to milliseconds.
    expect(applied).toBe('12345ms');

    await prisma.$executeRaw`SET statement_timeout = '0'`;
  });

  it('rejects the parameterised SET form that this bug shipped', async () => {
    const prisma = await getTestPrisma();

    // This is the exact statement the production path used to emit. If a future
    // change reintroduces it, this test fails instead of the weekly job
    // silently never running.
    await expect(
      prisma.$executeRaw`SET statement_timeout = ${String(12345)}`
    ).rejects.toThrow(/syntax error/i);

    await prisma.$executeRaw`SET statement_timeout = '0'`;
  });

  it('restores the session default after the maintenance window', async () => {
    const prisma = await getTestPrisma();

    await prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(5000)}, false)`;
    await prisma.$executeRaw`SET statement_timeout = '0'`;

    const [{ statement_timeout: restored }] = await prisma.$queryRaw<
      { statement_timeout: string }[]
    >`SHOW statement_timeout`;

    expect(restored).toBe('0');
  });
});
