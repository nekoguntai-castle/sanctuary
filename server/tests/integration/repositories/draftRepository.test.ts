/**
 * Draft Repository Integration Tests
 *
 * Tests the draft repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestDraft,
  createTestUtxo,
  TestScenarioBuilder,
  assertCount,
  assertNotExists,
} from './setup';

describeIfDatabase('DraftRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('create', () => {
    it('should create a draft with all fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const draft = await createTestDraft(tx, wallet.id, user.id, {
          recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
          amount: BigInt(50000),
          feeRate: 10,
          fee: BigInt(1000),
          status: 'unsigned',
        });

        expect(draft.recipient).toBe('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
        expect(draft.amount).toBe(BigInt(50000));
        expect(draft.feeRate).toBe(10);
        expect(draft.status).toBe('unsigned');
        expect(draft.walletId).toBe(wallet.id);
        expect(draft.userId).toBe(user.id);
      });
    });

    it('should create draft with PSBT data', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const draft = await createTestDraft(tx, wallet.id, user.id, {
          psbtBase64: 'cHNidP8BAHUCAAAAAQLdKnlX...',
        });

        expect(draft.psbtBase64).toBe('cHNidP8BAHUCAAAAAQLdKnlX...');
      });
    });
  });

  describe('findById', () => {
    it('should find draft by ID', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const draft = await createTestDraft(tx, wallet.id, user.id);

        const found = await tx.draftTransaction.findUnique({
          where: { id: draft.id },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(draft.id);
      });
    });

    it('should return null for non-existent ID', async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.draftTransaction.findUnique({
          where: { id: 'non-existent-id' },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findByIdInWallet', () => {
    it('should find draft within specific wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const draft = await createTestDraft(tx, wallet.id, user.id);

        const found = await tx.draftTransaction.findFirst({
          where: { id: draft.id, walletId: wallet.id },
        });

        expect(found).not.toBeNull();
      });
    });

    it('should return null if draft not in specified wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet1 = await createTestWallet(tx, user.id);
        const wallet2 = await createTestWallet(tx, user.id);
        const draft = await createTestDraft(tx, wallet1.id, user.id);

        const found = await tx.draftTransaction.findFirst({
          where: { id: draft.id, walletId: wallet2.id },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findByWalletId', () => {
    it('should find all drafts for a wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestDraft(tx, wallet.id, user.id);
        await createTestDraft(tx, wallet.id, user.id);
        await createTestDraft(tx, wallet.id, user.id);

        const drafts = await tx.draftTransaction.findMany({
          where: { walletId: wallet.id },
          orderBy: { createdAt: 'desc' },
        });

        expect(drafts).toHaveLength(3);
      });
    });

    it('should order by created date descending', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const firstCreatedAt = new Date('2024-01-01T00:00:00.000Z');
        const secondCreatedAt = new Date('2024-01-01T00:00:01.000Z');

        await createTestDraft(tx, wallet.id, user.id, { createdAt: firstCreatedAt });
        await createTestDraft(tx, wallet.id, user.id, { createdAt: secondCreatedAt });

        const drafts = await tx.draftTransaction.findMany({
          where: { walletId: wallet.id },
          orderBy: { createdAt: 'desc' },
        });

        expect(drafts[0].createdAt.getTime()).toBeGreaterThanOrEqual(
          drafts[1].createdAt.getTime()
        );
      });
    });
  });

  describe('findByUserId', () => {
    it('should find all drafts by user', async () => {
      await withTestTransaction(async (tx) => {
        const user1 = await createTestUser(tx, { username: 'user1' });
        const user2 = await createTestUser(tx, { username: 'user2' });
        const wallet = await createTestWallet(tx, user1.id);

        // User 1 creates 2 drafts
        await createTestDraft(tx, wallet.id, user1.id);
        await createTestDraft(tx, wallet.id, user1.id);
        // User 2 creates 1 draft (in shared wallet scenario)
        await tx.walletUser.create({
          data: { walletId: wallet.id, userId: user2.id, role: 'signer' },
        });
        await createTestDraft(tx, wallet.id, user2.id);

        const user1Drafts = await tx.draftTransaction.findMany({
          where: { userId: user1.id },
        });

        expect(user1Drafts).toHaveLength(2);
      });
    });
  });

  describe('update', () => {
    it('should update signed PSBT', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const draft = await createTestDraft(tx, wallet.id, user.id);

        const updated = await tx.draftTransaction.update({
          where: { id: draft.id },
          data: {
            signedPsbtBase64: 'cHNidP8SIGNED...',
          },
        });

        expect(updated.signedPsbtBase64).toBe('cHNidP8SIGNED...');
      });
    });

    it('should update status through signing workflow', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id, {
          type: 'multi_sig',
          quorum: 2,
          totalSigners: 3,
        });
        const draft = await createTestDraft(tx, wallet.id, user.id, {
          status: 'unsigned',
        });

        // First signature - partial
        const partial = await tx.draftTransaction.update({
          where: { id: draft.id },
          data: {
            status: 'partial',
            signedDeviceIds: ['device-1'],
          },
        });

        expect(partial.status).toBe('partial');
        expect(partial.signedDeviceIds).toContain('device-1');

        // Second signature - signed
        const signed = await tx.draftTransaction.update({
          where: { id: draft.id },
          data: {
            status: 'signed',
            signedDeviceIds: ['device-1', 'device-2'],
          },
        });

        expect(signed.status).toBe('signed');
        expect(signed.signedDeviceIds).toHaveLength(2);
      });
    });

    it('should update label and memo', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const draft = await createTestDraft(tx, wallet.id, user.id);

        const updated = await tx.draftTransaction.update({
          where: { id: draft.id },
          data: {
            label: 'Payment to Alice',
            memo: 'Monthly rent',
          },
        });

        expect(updated.label).toBe('Payment to Alice');
        expect(updated.memo).toBe('Monthly rent');
      });
    });
  });

  describe('delete', () => {
    it('should delete a draft', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const draft = await createTestDraft(tx, wallet.id, user.id);

        await tx.draftTransaction.delete({
          where: { id: draft.id },
        });

        await assertNotExists(tx, 'draftTransaction', { id: draft.id });
      });
    });
  });

  describe('findExpired', () => {
    it('should find expired drafts', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Create expired draft
        await tx.draftTransaction.create({
          data: {
            walletId: wallet.id,
            userId: user.id,
            recipient: 'tb1qtest',
            amount: BigInt(50000),
            feeRate: 10,
            selectedUtxoIds: [],
            psbtBase64: 'cHNidP8...',
            fee: BigInt(1000),
            totalInput: BigInt(100000),
            totalOutput: BigInt(99000),
            changeAmount: BigInt(49000),
            effectiveAmount: BigInt(50000),
            inputPaths: [],
            expiresAt: new Date(Date.now() - 1000), // Expired
          },
        });

        // Create non-expired draft
        await tx.draftTransaction.create({
          data: {
            walletId: wallet.id,
            userId: user.id,
            recipient: 'tb1qtest2',
            amount: BigInt(50000),
            feeRate: 10,
            selectedUtxoIds: [],
            psbtBase64: 'cHNidP8...',
            fee: BigInt(1000),
            totalInput: BigInt(100000),
            totalOutput: BigInt(99000),
            changeAmount: BigInt(49000),
            effectiveAmount: BigInt(50000),
            inputPaths: [],
            expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
          },
        });

        const expired = await tx.draftTransaction.findMany({
          where: {
            expiresAt: { lt: new Date() },
          },
        });

        expect(expired).toHaveLength(1);
      });
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired drafts', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Create 2 expired drafts
        for (let i = 0; i < 2; i++) {
          await tx.draftTransaction.create({
            data: {
              walletId: wallet.id,
              userId: user.id,
              recipient: `tb1qtest${i}`,
              amount: BigInt(50000),
              feeRate: 10,
              selectedUtxoIds: [],
              psbtBase64: 'cHNidP8...',
              fee: BigInt(1000),
              totalInput: BigInt(100000),
              totalOutput: BigInt(99000),
              changeAmount: BigInt(49000),
              effectiveAmount: BigInt(50000),
              inputPaths: [],
              expiresAt: new Date(Date.now() - 1000),
            },
          });
        }

        const result = await tx.draftTransaction.deleteMany({
          where: {
            expiresAt: { lt: new Date() },
          },
        });

        expect(result.count).toBe(2);
      });
    });
  });

  describe('countByWalletId', () => {
    it('should count drafts for a wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestDraft(tx, wallet.id, user.id);
        await createTestDraft(tx, wallet.id, user.id);
        await createTestDraft(tx, wallet.id, user.id);

        const count = await tx.draftTransaction.count({
          where: { walletId: wallet.id },
        });

        expect(count).toBe(3);
      });
    });
  });

  describe('countByStatus', () => {
    it('should count drafts by status', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestDraft(tx, wallet.id, user.id, { status: 'unsigned' });
        await createTestDraft(tx, wallet.id, user.id, { status: 'unsigned' });
        await createTestDraft(tx, wallet.id, user.id, { status: 'partial' });
        await createTestDraft(tx, wallet.id, user.id, { status: 'signed' });

        const unsignedCount = await tx.draftTransaction.count({
          where: { walletId: wallet.id, status: 'unsigned' },
        });
        const partialCount = await tx.draftTransaction.count({
          where: { walletId: wallet.id, status: 'partial' },
        });
        const signedCount = await tx.draftTransaction.count({
          where: { walletId: wallet.id, status: 'signed' },
        });

        expect(unsignedCount).toBe(2);
        expect(partialCount).toBe(1);
        expect(signedCount).toBe(1);
      });
    });
  });

  describe('UTXO locking', () => {
    it('should create draft with UTXO locks', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo1 = await createTestUtxo(tx, wallet.id);
        const utxo2 = await createTestUtxo(tx, wallet.id);

        const draft = await createTestDraft(tx, wallet.id, user.id);

        // Create UTXO locks
        await tx.draftUtxoLock.createMany({
          data: [
            { draftId: draft.id, utxoId: utxo1.id },
            { draftId: draft.id, utxoId: utxo2.id },
          ],
        });

        const locks = await tx.draftUtxoLock.findMany({
          where: { draftId: draft.id },
        });

        expect(locks).toHaveLength(2);
      });
    });

    it('should enforce unique UTXO per draft', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id);
        const draft = await createTestDraft(tx, wallet.id, user.id);

        await tx.draftUtxoLock.create({
          data: { draftId: draft.id, utxoId: utxo.id },
        });

        // Same UTXO in same draft should fail
        await expect(
          tx.draftUtxoLock.create({
            data: { draftId: draft.id, utxoId: utxo.id },
          })
        ).rejects.toThrow();
      });
    });

    it('should enforce UTXO can only be in one draft', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id);
        const draft1 = await createTestDraft(tx, wallet.id, user.id);
        const draft2 = await createTestDraft(tx, wallet.id, user.id);

        await tx.draftUtxoLock.create({
          data: { draftId: draft1.id, utxoId: utxo.id },
        });

        // Same UTXO in different draft should fail
        await expect(
          tx.draftUtxoLock.create({
            data: { draftId: draft2.id, utxoId: utxo.id },
          })
        ).rejects.toThrow();
      });
    });

    it('should cascade delete locks when draft is deleted', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id);
        const draft = await createTestDraft(tx, wallet.id, user.id);

        await tx.draftUtxoLock.create({
          data: { draftId: draft.id, utxoId: utxo.id },
        });

        await tx.draftTransaction.delete({
          where: { id: draft.id },
        });

        const locks = await tx.draftUtxoLock.findMany({
          where: { draftId: draft.id },
        });

        expect(locks).toHaveLength(0);
      });
    });
  });
});
