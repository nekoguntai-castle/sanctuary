/**
 * transactionRepository.getBucketedBalanceDeltas Integration Test
 *
 * Proves the `::bigint` cast on the raw balance-history aggregate: Postgres
 * widens `SUM(bigint)` to `numeric`, and without an explicit cast back to
 * `int8` Prisma deserializes the row as a `Prisma.Decimal`, not the declared
 * `bigint` type (see analyticsReadTools.ts / core.ts Phase 1 fix).
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  createTestUser,
  createTestWallet,
  createTestTransaction,
  getTestPrisma,
} from './setup';
import { transactionRepository } from '../../../src/repositories';

describeIfDatabase('transactionRepository.getBucketedBalanceDeltas Integration Tests', () => {
  setupRepositoryTests();

  it('returns a real bigint amount summed from same-day-bucket transactions', async () => {
    const client = await getTestPrisma();
    const user = await createTestUser(client);
    const wallet = await createTestWallet(client, user.id);
    const blockTime = new Date('2026-04-25T12:00:00.000Z');

    try {
      await createTestTransaction(client, wallet.id, {
        amount: BigInt(100),
        blockTime,
      });
      await createTestTransaction(client, wallet.id, {
        amount: BigInt(-25),
        blockTime: new Date('2026-04-25T18:00:00.000Z'),
      });
      await createTestTransaction(client, wallet.id, {
        amount: BigInt(1_000),
        blockTime,
        rbfStatus: 'replaced',
      });

      const rows = await transactionRepository.getBucketedBalanceDeltas(
        [wallet.id],
        new Date('2026-04-25T00:00:00.000Z'),
        'day'
      );

      expect(rows).toHaveLength(1);
      expect(typeof rows[0].amount).toBe('bigint');
      expect(rows[0].amount).toBe(BigInt(75));
    } finally {
      await client.transaction.deleteMany({ where: { walletId: wallet.id } });
      await client.wallet.delete({ where: { id: wallet.id } });
      await client.user.delete({ where: { id: user.id } });
    }
  });
});
