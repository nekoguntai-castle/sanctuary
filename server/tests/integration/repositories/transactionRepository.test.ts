/**
 * Transaction Repository Integration Tests
 *
 * Tests the transaction repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestAddress,
  createTestTransaction,
  TestScenarioBuilder,
  generateTxid,
  assertCount,
} from './setup';
import { transactionRepository } from '../../../src/repositories';
import type { PrismaTxClient } from '../../../src/models/prisma';

describeIfDatabase('TransactionRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('findWithMissingFields', () => {
    it('ignores null fields that do not apply to the transaction type', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const address = await createTestAddress(tx, wallet.id);
        const received = await createTestTransaction(tx, wallet.id, { type: 'received' });
        const consolidation = await createTestTransaction(tx, wallet.id, { type: 'consolidation' });
        const receivedMissingCounterparty = await createTestTransaction(tx, wallet.id, {
          type: 'received',
        });
        const sentMissingFee = await createTestTransaction(tx, wallet.id, { type: 'sent' });

        await Promise.all([
          tx.transaction.update({
            where: { id: received.id },
            data: { addressId: address.id, fee: null, counterpartyAddress: address.address },
          }),
          tx.transaction.update({
            where: { id: consolidation.id },
            data: { addressId: null, counterpartyAddress: null },
          }),
          tx.transaction.update({
            where: { id: receivedMissingCounterparty.id },
            data: { addressId: address.id, counterpartyAddress: null },
          }),
          tx.transaction.update({
            where: { id: sentMissingFee.id },
            data: { addressId: address.id, fee: null, counterpartyAddress: address.address },
          }),
        ]);

        const result = await transactionRepository.findWithMissingFields(
          wallet.id,
          tx as unknown as PrismaTxClient,
        );

        expect(result.map(transaction => transaction.id).sort()).toEqual([
          receivedMissingCounterparty.id,
          sentMissingFee.id,
        ].sort());
      });
    });
  });

  describe('deleteByWalletId', () => {
    it('should delete all transactions for a wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestTransaction(tx, wallet.id);
        await createTestTransaction(tx, wallet.id);
        await createTestTransaction(tx, wallet.id);

        await assertCount(tx, 'transaction', 3, { walletId: wallet.id });

        const result = await tx.transaction.deleteMany({
          where: { walletId: wallet.id },
        });

        expect(result.count).toBe(3);
        await assertCount(tx, 'transaction', 0, { walletId: wallet.id });
      });
    });

    it('should not affect transactions from other wallets', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet1 = await createTestWallet(tx, user.id, { name: 'Wallet 1' });
        const wallet2 = await createTestWallet(tx, user.id, { name: 'Wallet 2' });

        await createTestTransaction(tx, wallet1.id);
        await createTestTransaction(tx, wallet1.id);
        await createTestTransaction(tx, wallet2.id);

        await tx.transaction.deleteMany({
          where: { walletId: wallet1.id },
        });

        await assertCount(tx, 'transaction', 0, { walletId: wallet1.id });
        await assertCount(tx, 'transaction', 1, { walletId: wallet2.id });
      });
    });
  });

  describe('deleteByWalletIds', () => {
    it('should delete transactions for multiple wallets', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet1 = await createTestWallet(tx, user.id);
        const wallet2 = await createTestWallet(tx, user.id);
        const wallet3 = await createTestWallet(tx, user.id);

        await createTestTransaction(tx, wallet1.id);
        await createTestTransaction(tx, wallet2.id);
        await createTestTransaction(tx, wallet3.id);

        const result = await tx.transaction.deleteMany({
          where: { walletId: { in: [wallet1.id, wallet2.id] } },
        });

        expect(result.count).toBe(2);
        await assertCount(tx, 'transaction', 1, { walletId: wallet3.id });
      });
    });
  });

  describe('findByWalletId', () => {
    it('should find all transactions for a wallet', async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withTransactions(5)
          .build();

        const transactions = await tx.transaction.findMany({
          where: { walletId: scenario.wallet!.id },
        });

        expect(transactions).toHaveLength(5);
      });
    });

    it('should support pagination', async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withTransactions(10)
          .build();

        const page1 = await tx.transaction.findMany({
          where: { walletId: scenario.wallet!.id },
          skip: 0,
          take: 3,
        });

        const page2 = await tx.transaction.findMany({
          where: { walletId: scenario.wallet!.id },
          skip: 3,
          take: 3,
        });

        expect(page1).toHaveLength(3);
        expect(page2).toHaveLength(3);

        // Pages should not overlap
        const page1Ids = page1.map((t) => t.id);
        const page2Ids = page2.map((t) => t.id);
        expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
      });
    });

    it('should support ordering by block time descending', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const now = new Date();
        await createTestTransaction(tx, wallet.id, {
          blockTime: new Date(now.getTime() - 3000),
        });
        await createTestTransaction(tx, wallet.id, {
          blockTime: new Date(now.getTime() - 1000),
        });
        await createTestTransaction(tx, wallet.id, {
          blockTime: new Date(now.getTime() - 2000),
        });

        const transactions = await tx.transaction.findMany({
          where: { walletId: wallet.id },
          orderBy: { blockTime: 'desc' },
        });

        // Should be ordered newest first
        for (let i = 0; i < transactions.length - 1; i++) {
          const current = transactions[i].blockTime?.getTime() || 0;
          const next = transactions[i + 1].blockTime?.getTime() || 0;
          expect(current).toBeGreaterThanOrEqual(next);
        }
      });
    });
  });

  describe('countByWalletId', () => {
    it('should return correct count', async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withTransactions(7)
          .build();

        const count = await tx.transaction.count({
          where: { walletId: scenario.wallet!.id },
        });

        expect(count).toBe(7);
      });
    });

    it('should return zero for wallet with no transactions', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const count = await tx.transaction.count({
          where: { walletId: wallet.id },
        });

        expect(count).toBe(0);
      });
    });
  });

  describe('findByTxid', () => {
    it('should find transaction by txid and wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const txid = generateTxid();

        await createTestTransaction(tx, wallet.id, { txid });

        const found = await tx.transaction.findFirst({
          where: { txid, walletId: wallet.id },
        });

        expect(found).not.toBeNull();
        expect(found?.txid).toBe(txid);
      });
    });

    it('should return null if txid not in wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet1 = await createTestWallet(tx, user.id);
        const wallet2 = await createTestWallet(tx, user.id);
        const txid = generateTxid();

        await createTestTransaction(tx, wallet1.id, { txid });

        const found = await tx.transaction.findFirst({
          where: { txid, walletId: wallet2.id },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findForBalanceHistory', () => {
    it('should find transactions since date for balance history', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

        // Create old transaction (before cutoff)
        await createTestTransaction(tx, wallet.id, {
          blockTime: new Date(twoWeeksAgo.getTime() - 1000),
        });

        // Create recent transactions
        await createTestTransaction(tx, wallet.id, {
          blockTime: new Date(oneWeekAgo.getTime() + 1000),
        });
        await createTestTransaction(tx, wallet.id, {
          blockTime: new Date(now.getTime() - 1000),
        });

        const history = await tx.transaction.findMany({
          where: {
            walletId: wallet.id,
            blockTime: { gte: oneWeekAgo },
            type: { not: 'consolidation' },
          },
          select: {
            blockTime: true,
            balanceAfter: true,
          },
          orderBy: { blockTime: 'asc' },
        });

        expect(history).toHaveLength(2);
      });
    });

    it('should exclude consolidation transactions', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const now = new Date();

        await createTestTransaction(tx, wallet.id, {
          type: 'received',
          blockTime: now,
        });
        await createTestTransaction(tx, wallet.id, {
          type: 'consolidation',
          blockTime: now,
        });

        const history = await tx.transaction.findMany({
          where: {
            walletId: wallet.id,
            type: { not: 'consolidation' },
          },
        });

        expect(history).toHaveLength(1);
        expect(history[0].type).toBe('received');
      });
    });
  });

  describe('transaction types', () => {
    it('should support sent transaction type', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const transaction = await createTestTransaction(tx, wallet.id, {
          type: 'sent',
          amount: BigInt(-50000),
        });

        expect(transaction.type).toBe('sent');
        expect(transaction.amount).toBe(BigInt(-50000));
      });
    });

    it('should support received transaction type', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const transaction = await createTestTransaction(tx, wallet.id, {
          type: 'received',
          amount: BigInt(100000),
        });

        expect(transaction.type).toBe('received');
        expect(transaction.amount).toBe(BigInt(100000));
      });
    });
  });

  describe('RBF tracking', () => {
    it('should track RBF status', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const transaction = await createTestTransaction(tx, wallet.id, {
          rbfStatus: 'active',
        });

        expect(transaction.rbfStatus).toBe('active');
      });
    });

    it('should track replaced transactions', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const originalTxid = generateTxid();
        const replacementTxid = generateTxid();

        // Original transaction
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            txid: originalTxid,
            type: 'sent',
            amount: BigInt(50000),
            rbfStatus: 'replaced',
            replacedByTxid: replacementTxid,
          },
        });

        // Replacement transaction
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            txid: replacementTxid,
            type: 'sent',
            amount: BigInt(50000),
            rbfStatus: 'active',
            replacementForTxid: originalTxid,
          },
        });

        // Find the chain
        const original = await tx.transaction.findFirst({
          where: { txid: originalTxid },
        });
        const replacement = await tx.transaction.findFirst({
          where: { txid: replacementTxid },
        });

        expect(original?.rbfStatus).toBe('replaced');
        expect(original?.replacedByTxid).toBe(replacementTxid);
        expect(replacement?.replacementForTxid).toBe(originalTxid);
      });
    });
  });

  describe('confirmation tracking', () => {
    it('should find pending transactions', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestTransaction(tx, wallet.id, { confirmations: 0 });
        await createTestTransaction(tx, wallet.id, { confirmations: 0 });
        await createTestTransaction(tx, wallet.id, { confirmations: 6 });

        const pending = await tx.transaction.findMany({
          where: {
            walletId: wallet.id,
            confirmations: 0,
          },
        });

        expect(pending).toHaveLength(2);
      });
    });

    it('should update confirmations', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const transaction = await createTestTransaction(tx, wallet.id, {
          confirmations: 0,
        });

        const updated = await tx.transaction.update({
          where: { id: transaction.id },
          data: { confirmations: 3 },
        });

        expect(updated.confirmations).toBe(3);
      });
    });
  });

  describe('labels and memos', () => {
    it('should store transaction label', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const transaction = await createTestTransaction(tx, wallet.id, {
          label: 'Payment for services',
        });

        expect(transaction.label).toBe('Payment for services');
      });
    });

    it('should store transaction memo', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const transaction = await createTestTransaction(tx, wallet.id, {
          memo: 'Invoice #12345',
        });

        expect(transaction.memo).toBe('Invoice #12345');
      });
    });

    it('should find transactions with labels', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestTransaction(tx, wallet.id, { label: 'Has label' });
        await createTestTransaction(tx, wallet.id, { label: null });
        await createTestTransaction(tx, wallet.id, { memo: 'Has memo' });

        const withLabels = await tx.transaction.findMany({
          where: {
            walletId: wallet.id,
            OR: [
              { label: { not: null } },
              { memo: { not: null } },
            ],
          },
        });

        expect(withLabels).toHaveLength(2);
      });
    });
  });

  describe('unique constraints', () => {
    it('should enforce unique txid per wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const txid = generateTxid();

        await createTestTransaction(tx, wallet.id, { txid });

        await expect(
          createTestTransaction(tx, wallet.id, { txid })
        ).rejects.toThrow();
      });
    });

    it('should allow same txid in different wallets', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet1 = await createTestWallet(tx, user.id);
        const wallet2 = await createTestWallet(tx, user.id);
        const txid = generateTxid();

        // Same txid in both wallets should work (shared transaction)
        const tx1 = await createTestTransaction(tx, wallet1.id, { txid });
        const tx2 = await createTestTransaction(tx, wallet2.id, { txid });

        expect(tx1.txid).toBe(txid);
        expect(tx2.txid).toBe(txid);
        expect(tx1.walletId).not.toBe(tx2.walletId);
      });
    });
  });
});
