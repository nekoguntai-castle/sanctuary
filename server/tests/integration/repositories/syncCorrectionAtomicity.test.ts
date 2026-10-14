import { randomUUID } from 'node:crypto';
import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { correctTransactionToConsolidation } from '../../../src/repositories/balanceCorrectionRepository';
import {
  completeFencedWalletFullResync,
  completeWalletFullResync,
  requestFullResyncGeneration,
  reserveFullResyncGeneration,
  resetWalletForFullResync,
} from '../../../src/repositories/resyncRepository';
import { claimIncrementalSync } from '../../../src/repositories/syncIntentRepository';
import { reconcileTransactionBatch } from '../../../src/repositories/transactions/sync';
import { deleteById as deleteWalletById } from '../../../src/repositories/walletRepository';
import { FULL_RESYNC_GENERATION_MAX } from '../../../src/constants/fullResync';
import {
  createTestAddress,
  createTestLabel,
  createTestTransaction,
  createTestUser,
  createTestWallet,
  generateTxid,
} from './setup';

const SNAPSHOT_KEY_PREFIX = 'operational.wallet-resync-annotations.v1:';

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
    await prisma.systemSetting.deleteMany({
      where: { key: { startsWith: SNAPSHOT_KEY_PREFIX } },
    });
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
      select: {
        preparedFullResyncGeneration: true,
        processedFullResyncGeneration: true,
      },
    })).resolves.toEqual({
      preparedFullResyncGeneration: 0,
      processedFullResyncGeneration: 0,
    });
  });

  it('serializes inverted reset generations without regressing the prepared high-water mark', async () => {
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
      select: {
        preparedFullResyncGeneration: true,
        processedFullResyncGeneration: true,
      },
    })).resolves.toEqual({
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 0,
    });
  });

  it('advances completion only after rebuild success and preserves mixed-version high-water marks', async () => {
    const { wallet } = await createWalletFixture();
    const generation = await reserveFullResyncGeneration(wallet.id);
    await resetWalletForFullResync(wallet.id, generation);
    const syncedAt = new Date('2026-08-22T20:00:00.000Z');

    await expect(completeWalletFullResync(wallet.id, generation, {
      syncedAt,
      lastSyncedBlockHeight: 250,
    })).resolves.toMatchObject({ completionRecorded: true });
    await expect(prisma.wallet.findUnique({
      where: { id: wallet.id },
      select: {
        preparedFullResyncGeneration: true,
        processedFullResyncGeneration: true,
        lastSyncedAt: true,
        lastSyncedBlockHeight: true,
        lastSyncStatus: true,
        syncInProgress: true,
      },
    })).resolves.toEqual({
      preparedFullResyncGeneration: generation,
      processedFullResyncGeneration: generation,
      lastSyncedAt: syncedAt,
      lastSyncedBlockHeight: 250,
      lastSyncStatus: 'success',
      syncInProgress: false,
    });

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        requestedFullResyncGeneration: 3,
        preparedFullResyncGeneration: 1,
        processedFullResyncGeneration: 3,
        lastSyncedAt: null,
        lastSyncStatus: 'resyncing',
        syncInProgress: true,
      },
    });
    await expect(resetWalletForFullResync(wallet.id, 2)).resolves.toEqual({
      deletedTransactions: 0,
      resetPerformed: false,
    });
    const mixedVersionSyncedAt = new Date('2026-08-22T21:00:00.000Z');
    await expect(completeWalletFullResync(wallet.id, 3, {
      syncedAt: mixedVersionSyncedAt,
      lastSyncedBlockHeight: 251,
    })).resolves.toMatchObject({ completionRecorded: true });
    await expect(prisma.wallet.findUnique({
      where: { id: wallet.id },
      select: {
        preparedFullResyncGeneration: true,
        processedFullResyncGeneration: true,
        lastSyncedAt: true,
      },
    })).resolves.toEqual({
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 3,
      lastSyncedAt: mixedVersionSyncedAt,
    });
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
  describe('full resync annotation preservation', () => {
    const rebuildRow = (walletId: string, txid: string) => ({
      walletId,
      txid,
      type: 'received' as const,
      amount: BigInt(10_000),
      confirmations: 0,
      blockHeight: null,
      blockTime: null,
      rbfStatus: 'active' as const,
    });

    async function seedAnnotated(
      walletId: string,
      annotation: { label?: string; memo?: string; labelId?: string },
    ) {
      const transaction = await createTestTransaction(factoryClient, walletId, {
        txid: generateTxid(),
        label: annotation.label,
        memo: annotation.memo,
      });
      if (annotation.labelId) {
        await prisma.transactionLabel.create({
          data: { transactionId: transaction.id, labelId: annotation.labelId },
        });
      }
      return transaction.txid;
    }

    async function recreate(walletId: string, addressId: string, txids: string[]) {
      await reconcileTransactionBatch(txids.map(txid => ({
        ...rebuildRow(walletId, txid),
        addressId,
        classificationInputsComplete: true,
        classificationVersion: 2,
        classificationAddressCount: 1,
      })));
    }

    async function claimFullResyncFence(walletId: string) {
      const request = await requestFullResyncGeneration(walletId);
      if (request.status !== 'requested') throw new Error(`unexpected ${request.status}`);
      const claimedAt = new Date();
      const claim = await claimIncrementalSync(walletId, {
        leaseToken: randomUUID(),
        claimedAt,
        leaseExpiresAt: new Date(claimedAt.getTime() + 600_000),
        expectedRequestedGeneration: request.incrementalGeneration,
        fullResyncGeneration: request.generation,
      });
      if (claim.status !== 'claimed') throw new Error(`unexpected claim ${claim.status}`);
      return {
        generation: request.generation,
        fence: Object.freeze({
          walletId,
          generation: claim.claim.generation,
          leaseToken: claim.claim.leaseToken,
        }),
      };
    }

    async function annotationOf(walletId: string, txid: string) {
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { txid_walletId: { txid, walletId } },
        select: {
          label: true,
          memo: true,
          updatedAt: true,
          transactionLabels: { select: { labelId: true } },
        },
      });
      return {
        label: row.label,
        memo: row.memo,
        updatedAt: row.updatedAt,
        labelIds: row.transactionLabels.map(link => link.labelId),
      };
    }

    async function snapshotTxids(walletId: string): Promise<string[] | null> {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: `${SNAPSHOT_KEY_PREFIX}${walletId}` },
      });
      if (!setting) return null;
      const parsed = JSON.parse(setting.value) as { entries: Record<string, unknown> };
      return Object.keys(parsed.entries).sort();
    }

    it('restores labels, memos and label links at fenced completion without overwriting newer edits', async () => {
      const { wallet, address } = await createWalletFixture();
      const label = await createTestLabel(factoryClient, wallet.id, { name: 'rent' });
      const both = await seedAnnotated(wallet.id, {
        label: 'rent', memo: 'March', labelId: label.id,
      });
      const labelOnly = await seedAnnotated(wallet.id, { label: 'payroll' });
      const memoOnly = await seedAnnotated(wallet.id, { memo: 'gift' });
      const linkOnly = await seedAnnotated(wallet.id, { labelId: label.id });
      const edited = await seedAnnotated(wallet.id, { label: 'old', memo: 'old memo' });
      const missing = await seedAnnotated(wallet.id, { label: 'not found again' });
      const plain = await seedAnnotated(wallet.id, {});
      const { generation, fence } = await claimFullResyncFence(wallet.id);

      await expect(resetWalletForFullResync(wallet.id, generation, fence)).resolves.toEqual({
        deletedTransactions: 7,
        resetPerformed: true,
      });
      await expect(snapshotTxids(wallet.id)).resolves.toEqual(
        [both, labelOnly, memoOnly, linkOnly, edited, missing].sort(),
      );
      await recreate(wallet.id, address.id, [both, labelOnly, memoOnly, linkOnly, edited, plain]);
      await prisma.transaction.update({
        where: { txid_walletId: { txid: edited, walletId: wallet.id } },
        data: { label: 'new' },
      });
      const linkOnlyBefore = await annotationOf(wallet.id, linkOnly);
      const plainBefore = await annotationOf(wallet.id, plain);
      const labelOnlyBefore = await annotationOf(wallet.id, labelOnly);

      await expect(completeFencedWalletFullResync(wallet.id, generation, fence, {
        syncedAt: new Date(),
        lastSyncedBlockHeight: 250,
      })).resolves.toMatchObject({ completionRecorded: true });

      await expect(annotationOf(wallet.id, both)).resolves.toMatchObject({
        label: 'rent', memo: 'March', labelIds: [label.id],
      });
      const labelOnlyAfter = await annotationOf(wallet.id, labelOnly);
      expect(labelOnlyAfter).toMatchObject({ label: 'payroll', memo: null, labelIds: [] });
      expect(labelOnlyAfter.updatedAt.getTime())
        .toBeGreaterThan(labelOnlyBefore.updatedAt.getTime());
      await expect(annotationOf(wallet.id, memoOnly)).resolves.toMatchObject({
        label: null, memo: 'gift', labelIds: [],
      });
      await expect(annotationOf(wallet.id, linkOnly)).resolves.toEqual({
        ...linkOnlyBefore,
        labelIds: [label.id],
      });
      await expect(annotationOf(wallet.id, plain)).resolves.toEqual(plainBefore);
      await expect(annotationOf(wallet.id, edited)).resolves.toMatchObject({
        label: 'new', memo: 'old memo',
      });
      // A txid the rebuild did not find again stays pending for a later resync.
      await expect(snapshotTxids(wallet.id)).resolves.toEqual([missing]);

      await deleteWalletById(wallet.id);
      await expect(snapshotTxids(wallet.id)).resolves.toBeNull();
    });

    it('keeps a superseded generation snapshot and restores it at the newer completion', async () => {
      const { wallet, address } = await createWalletFixture();
      const label = await createTestLabel(factoryClient, wallet.id, { name: 'savings' });
      const deletedLabel = await createTestLabel(factoryClient, wallet.id, { name: 'gone' });
      const txid = await seedAnnotated(wallet.id, {
        label: 'savings', memo: 'cold storage', labelId: label.id,
      });
      await prisma.transactionLabel.create({
        data: {
          transactionId: (await prisma.transaction.findUniqueOrThrow({
            where: { txid_walletId: { txid, walletId: wallet.id } },
          })).id,
          labelId: deletedLabel.id,
        },
      });
      const first = await reserveFullResyncGeneration(wallet.id);
      await resetWalletForFullResync(wallet.id, first);
      await recreate(wallet.id, address.id, [txid]);
      const second = await reserveFullResyncGeneration(wallet.id);
      await expect(resetWalletForFullResync(wallet.id, second)).resolves.toMatchObject({
        resetPerformed: true,
      });
      await recreate(wallet.id, address.id, [txid]);
      await prisma.label.delete({ where: { id: deletedLabel.id } });

      await expect(completeWalletFullResync(wallet.id, first, {
        syncedAt: new Date(),
        lastSyncedBlockHeight: 250,
      })).resolves.toEqual({ completionRecorded: false });
      await expect(annotationOf(wallet.id, txid)).resolves.toMatchObject({
        label: null, memo: null, labelIds: [],
      });
      await expect(completeWalletFullResync(wallet.id, second, {
        syncedAt: new Date(),
        lastSyncedBlockHeight: 251,
      })).resolves.toMatchObject({ completionRecorded: true });

      await expect(annotationOf(wallet.id, txid)).resolves.toMatchObject({
        label: 'savings', memo: 'cold storage', labelIds: [label.id],
      });
      await expect(snapshotTxids(wallet.id)).resolves.toBeNull();
    });

    async function seedBulk(walletId: string, count: number, labelId: string) {
      const rows = await prisma.transaction.createManyAndReturn({
        data: Array.from({ length: count }, (_, index) => ({
          ...rebuildRow(walletId, generateTxid()),
          label: index % 2 === 0 ? `label-${index}` : null,
          memo: index % 2 === 0 ? null : `memo-${index}`,
        })),
        select: { id: true, txid: true },
      });
      await prisma.transactionLabel.createMany({
        data: rows.map(row => ({ transactionId: row.id, labelId })),
      });
      return rows.map(row => row.txid);
    }

    async function expectBulkRestored(walletId: string, txids: string[], labelId: string) {
      await expect(prisma.transaction.count({
        where: { walletId, OR: [{ label: { not: null } }, { memo: { not: null } }] },
      })).resolves.toBe(txids.length);
      await expect(prisma.transactionLabel.count({
        where: { labelId, transaction: { walletId } },
      })).resolves.toBe(txids.length);
      const last = txids.length - 1;
      await expect(annotationOf(walletId, txids[last]!)).resolves.toMatchObject(
        last % 2 === 0
          ? { label: `label-${last}`, memo: null }
          : { label: null, memo: `memo-${last}` },
      );
      await expect(snapshotTxids(walletId)).resolves.toBeNull();
    }

    it.each([1_000, 1_001])(
      'restores %i annotated txids across the restore chunk boundary',
      async count => {
        const { wallet } = await createWalletFixture();
        const label = await createTestLabel(factoryClient, wallet.id, { name: 'bulk' });
        const txids = await seedBulk(wallet.id, count, label.id);
        const generation = await reserveFullResyncGeneration(wallet.id);
        await resetWalletForFullResync(wallet.id, generation);
        await prisma.transaction.createMany({
          data: txids.map(txid => rebuildRow(wallet.id, txid)),
        });

        await expect(completeWalletFullResync(wallet.id, generation, {
          syncedAt: new Date(),
          lastSyncedBlockHeight: 250,
        })).resolves.toMatchObject({ completionRecorded: true });

        await expectBulkRestored(wallet.id, txids, label.id);
      },
    );

    it('restores several thousand annotations well inside the fenced completion timeout', async () => {
      const { wallet } = await createWalletFixture();
      const label = await createTestLabel(factoryClient, wallet.id, { name: 'bulk' });
      const txids = await seedBulk(wallet.id, 3_000, label.id);
      const { generation, fence } = await claimFullResyncFence(wallet.id);
      await resetWalletForFullResync(wallet.id, generation, fence);
      await prisma.transaction.createMany({
        data: txids.map(txid => rebuildRow(wallet.id, txid)),
      });

      const startedAt = Date.now();
      await expect(completeFencedWalletFullResync(wallet.id, generation, fence, {
        syncedAt: new Date(),
        lastSyncedBlockHeight: 250,
      })).resolves.toMatchObject({ completionRecorded: true });
      expect(Date.now() - startedAt).toBeLessThan(20_000);

      await expectBulkRestored(wallet.id, txids, label.id);
    }, 60_000);
  });
});
