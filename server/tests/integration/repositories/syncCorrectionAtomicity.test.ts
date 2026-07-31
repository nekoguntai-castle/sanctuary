import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { correctTransactionToConsolidation } from '../../../src/repositories/balanceCorrectionRepository';
import {
  reserveFullResyncGeneration,
  resetWalletForFullResync,
} from '../../../src/repositories/resyncRepository';
import { FULL_RESYNC_GENERATION_MAX } from '../../../src/constants/fullResync';
import {
  createTestAddress,
  createTestTransaction,
  createTestUser,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('sync correction atomicity', () => {
  const userIds: string[] = [];
  const factoryClient = prisma as unknown as PrismaClient;

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_address_update_trigger ON "addresses"',
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_output_update_trigger ON "transaction_outputs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_address_update()');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_output_update()');
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createWalletFixture() {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id);
    const address = await createTestAddress(factoryClient, wallet.id, { used: true });
    return { wallet, address };
  }

  async function waitForFullResyncLockWaiters(expectedCount: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [waiting] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS "count"
        FROM pg_stat_activity
        WHERE "pid" <> pg_backend_pid()
          AND "datname" = current_database()
          AND "query" LIKE '%full-resync-wallet-lock%'
          AND "wait_event_type" = 'Lock'
      `;
      if (Number(waiting?.count ?? 0) >= expectedCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${expectedCount} full-resync wallet lock waiter(s)`);
  }

  it('rolls back deletion when a later full-resync reset step fails', async () => {
    const { wallet, address } = await createWalletFixture();
    const transaction = await createTestTransaction(factoryClient, wallet.id);
    const generation = await reserveFullResyncGeneration(wallet.id);
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_address_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced address reset failure';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_address_update_trigger
      BEFORE UPDATE ON "addresses"
      FOR EACH ROW EXECUTE FUNCTION test_fail_address_update()
    `);

    await expect(resetWalletForFullResync(
      wallet.id,
      generation,
    )).rejects.toThrow('forced address reset failure');

    await expect(prisma.transaction.findUnique({
      where: { id: transaction.id },
      select: { id: true },
    })).resolves.toEqual({ id: transaction.id });
    await expect(prisma.address.findUnique({
      where: { id: address.id },
      select: { used: true },
    })).resolves.toEqual({ used: true });
    await expect(prisma.wallet.findUnique({
      where: { id: wallet.id },
      select: { processedFullResyncGeneration: true },
    })).resolves.toEqual({ processedFullResyncGeneration: 0 });
  });

  it('serializes inverted reset generations without regressing the processed high-water mark', async () => {
    const { wallet } = await createWalletFixture();
    await createTestTransaction(factoryClient, wallet.id);
    await reserveFullResyncGeneration(wallet.id);
    await reserveFullResyncGeneration(wallet.id);

    let releaseLock!: () => void;
    let lockReady!: () => void;
    const ready = new Promise<void>(resolve => { lockReady = resolve; });
    const release = new Promise<void>(resolve => { releaseLock = resolve; });
    const heldLock = prisma.$transaction(async tx => {
      await tx.$queryRaw`
        SELECT "id" FROM "wallets" WHERE "id" = ${wallet.id} FOR UPDATE
      `;
      lockReady();
      await release;
    });
    await ready;

    const newerReset = resetWalletForFullResync(wallet.id, 2);
    await waitForFullResyncLockWaiters(1);
    const olderReset = resetWalletForFullResync(wallet.id, 1);
    await waitForFullResyncLockWaiters(2);
    releaseLock();
    await heldLock;

    await expect(Promise.all([newerReset, olderReset])).resolves.toEqual([
      { deletedTransactions: 1, resetPerformed: true },
      { deletedTransactions: 0, resetPerformed: false },
    ]);
    await expect(prisma.wallet.findUnique({
      where: { id: wallet.id },
      select: { processedFullResyncGeneration: true },
    })).resolves.toEqual({ processedFullResyncGeneration: 2 });
  });

  it('rejects forged future generations and database counter overflow', async () => {
    const { wallet } = await createWalletFixture();
    await reserveFullResyncGeneration(wallet.id);

    await expect(resetWalletForFullResync(wallet.id, 2)).rejects.toThrow(
      'Full resync generation was not reserved',
    );
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        requestedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
        processedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
      },
    });
    await expect(reserveFullResyncGeneration(wallet.id)).rejects.toThrow();
    await expect(prisma.wallet.update({
      where: { id: wallet.id },
      data: { processedFullResyncGeneration: 0 },
    })).resolves.toMatchObject({ processedFullResyncGeneration: 0 });
    await expect(prisma.wallet.update({
      where: { id: wallet.id },
      data: { processedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX },
    })).resolves.toMatchObject({
      processedFullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
    });
    await expect(prisma.wallet.update({
      where: { id: wallet.id },
      data: { requestedFullResyncGeneration: 0 },
    })).rejects.toThrow();
  });

  it('rolls back the parent correction when output-role correction fails', async () => {
    const { wallet, address } = await createWalletFixture();
    const transaction = await createTestTransaction(factoryClient, wallet.id, {
      type: 'sent',
      amount: BigInt(-500),
    });
    const output = await prisma.transactionOutput.create({
      data: {
        transactionId: transaction.id,
        outputIndex: 0,
        address: address.address,
        amount: BigInt(500),
        isOurs: false,
        outputType: 'recipient',
      },
    });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_output_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced output correction failure';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_output_update_trigger
      BEFORE UPDATE ON "transaction_outputs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_output_update()
    `);

    await expect(correctTransactionToConsolidation(
      transaction.id,
      BigInt(0),
      [address.address],
    )).rejects.toThrow('forced output correction failure');

    await expect(prisma.transaction.findUnique({
      where: { id: transaction.id },
      select: { type: true, amount: true },
    })).resolves.toEqual({ type: 'sent', amount: BigInt(-500) });
    await expect(prisma.transactionOutput.findUnique({
      where: { id: output.id },
      select: { isOurs: true, outputType: true },
    })).resolves.toEqual({ isOurs: false, outputType: 'recipient' });
  });
});
