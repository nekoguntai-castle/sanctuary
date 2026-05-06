/**
 * UTXO Repository Integration Tests
 *
 * Tests the UTXO repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestUtxo,
  TestScenarioBuilder,
  generateTxid,
  generateTestnetAddress,
  assertCount,
} from './setup';

describeIfDatabase('UTXORepository Integration Tests', () => {
  setupRepositoryTests();

  describe('create', () => {
    it('should create a UTXO with all fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const txid = generateTxid();
        const address = generateTestnetAddress();

        const utxo = await createTestUtxo(tx, wallet.id, {
          txid,
          vout: 0,
          address,
          amount: BigInt(100000),
          scriptPubKey: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
          confirmations: 6,
          blockHeight: 100000,
          spent: false,
          frozen: false,
        });

        expect(utxo.txid).toBe(txid);
        expect(utxo.vout).toBe(0);
        expect(utxo.address).toBe(address);
        expect(utxo.amount).toBe(BigInt(100000));
        expect(utxo.confirmations).toBe(6);
        expect(utxo.spent).toBe(false);
        expect(utxo.frozen).toBe(false);
      });
    });

    it('should enforce unique txid:vout within one wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const txid = generateTxid();

        await createTestUtxo(tx, wallet.id, { txid, vout: 0 });

        await expect(
          createTestUtxo(tx, wallet.id, { txid, vout: 0 })
        ).rejects.toThrow();
      });
    });

    it('should allow same txid:vout in separate wallet network scopes', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const testnet3Wallet = await createTestWallet(tx, user.id, { network: 'testnet3' });
        const testnet4Wallet = await createTestWallet(tx, user.id, { network: 'testnet4' });
        const txid = generateTxid();
        const address = generateTestnetAddress();

        const testnet3Utxo = await createTestUtxo(tx, testnet3Wallet.id, {
          txid,
          vout: 0,
          address,
        });
        const testnet4Utxo = await createTestUtxo(tx, testnet4Wallet.id, {
          txid,
          vout: 0,
          address,
        });

        expect(testnet3Utxo.walletId).toBe(testnet3Wallet.id);
        expect(testnet4Utxo.walletId).toBe(testnet4Wallet.id);
      });
    });

    it('should allow same txid with different vout', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const txid = generateTxid();

        const utxo0 = await createTestUtxo(tx, wallet.id, { txid, vout: 0 });
        const utxo1 = await createTestUtxo(tx, wallet.id, { txid, vout: 1 });

        expect(utxo0.vout).toBe(0);
        expect(utxo1.vout).toBe(1);
      });
    });
  });

  describe('createMany', () => {
    it('should create multiple UTXOs in batch', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const utxoData = Array.from({ length: 10 }, (_, i) => ({
          walletId: wallet.id,
          txid: generateTxid(),
          vout: 0,
          address: generateTestnetAddress(),
          amount: BigInt((i + 1) * 10000),
          scriptPubKey: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
          confirmations: 6,
          spent: false,
          frozen: false,
        }));

        await tx.uTXO.createMany({ data: utxoData });

        await assertCount(tx, 'uTXO', 10, { walletId: wallet.id });
      });
    });
  });

  describe('findByWalletId', () => {
    it('should find all UTXOs for a wallet', async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withUtxos(5)
          .build();

        const utxos = await tx.uTXO.findMany({
          where: { walletId: scenario.wallet!.id },
        });

        expect(utxos).toHaveLength(5);
      });
    });
  });

  describe('markSpent', () => {
    it('should mark UTXO as spent', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id, { spent: false });
        const spendingTxid = generateTxid();

        expect(utxo.spent).toBe(false);

        const updated = await tx.uTXO.update({
          where: { id: utxo.id },
          data: {
            spent: true,
            spentTxid: spendingTxid,
          },
        });

        expect(updated.spent).toBe(true);
        expect(updated.spentTxid).toBe(spendingTxid);
      });
    });
  });

  describe('markUnspent', () => {
    it('should mark UTXO as unspent (for reorg handling)', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const spendingTxid = generateTxid();

        const utxo = await createTestUtxo(tx, wallet.id, {
          spent: true,
          spentTxid: spendingTxid,
        });

        const updated = await tx.uTXO.update({
          where: { id: utxo.id },
          data: {
            spent: false,
            spentTxid: null,
          },
        });

        expect(updated.spent).toBe(false);
        expect(updated.spentTxid).toBeNull();
      });
    });
  });

  describe('findUnspent', () => {
    it('should find only unspent UTXOs', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestUtxo(tx, wallet.id, { spent: false });
        await createTestUtxo(tx, wallet.id, { spent: false });
        await createTestUtxo(tx, wallet.id, { spent: true });

        const unspent = await tx.uTXO.findMany({
          where: {
            walletId: wallet.id,
            spent: false,
          },
        });

        expect(unspent).toHaveLength(2);
        expect(unspent.every((u) => !u.spent)).toBe(true);
      });
    });

    it('should exclude frozen UTXOs when requested', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestUtxo(tx, wallet.id, { spent: false, frozen: false });
        await createTestUtxo(tx, wallet.id, { spent: false, frozen: true });
        await createTestUtxo(tx, wallet.id, { spent: false, frozen: false });

        const spendable = await tx.uTXO.findMany({
          where: {
            walletId: wallet.id,
            spent: false,
            frozen: false,
          },
        });

        expect(spendable).toHaveLength(2);
        expect(spendable.every((u) => !u.frozen)).toBe(true);
      });
    });
  });

  describe('calculateBalance', () => {
    it('should calculate balance from unspent UTXOs', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestUtxo(tx, wallet.id, { amount: BigInt(100000), spent: false });
        await createTestUtxo(tx, wallet.id, { amount: BigInt(50000), spent: false });
        await createTestUtxo(tx, wallet.id, { amount: BigInt(25000), spent: false });
        await createTestUtxo(tx, wallet.id, { amount: BigInt(10000), spent: true }); // Excluded

        const result = await tx.uTXO.aggregate({
          where: {
            walletId: wallet.id,
            spent: false,
          },
          _sum: { amount: true },
        });

        expect(result._sum.amount).toBe(BigInt(175000));
      });
    });

    it('should return zero for empty wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const result = await tx.uTXO.aggregate({
          where: {
            walletId: wallet.id,
            spent: false,
          },
          _sum: { amount: true },
        });

        expect(result._sum.amount).toBeNull();
      });
    });
  });

  describe('deleteByWalletId', () => {
    it('should delete all UTXOs for a wallet', async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser()
          .withWallet()
          .withUtxos(10)
          .build();

        await assertCount(tx, 'uTXO', 10, { walletId: scenario.wallet!.id });

        const result = await tx.uTXO.deleteMany({
          where: { walletId: scenario.wallet!.id },
        });

        expect(result.count).toBe(10);
        await assertCount(tx, 'uTXO', 0, { walletId: scenario.wallet!.id });
      });
    });
  });

  describe('freeze/unfreeze', () => {
    it('should freeze a UTXO', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id, { frozen: false });

        const updated = await tx.uTXO.update({
          where: { id: utxo.id },
          data: { frozen: true },
        });

        expect(updated.frozen).toBe(true);
      });
    });

    it('should unfreeze a UTXO', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id, { frozen: true });

        const updated = await tx.uTXO.update({
          where: { id: utxo.id },
          data: { frozen: false },
        });

        expect(updated.frozen).toBe(false);
      });
    });

    it('should count frozen UTXOs', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestUtxo(tx, wallet.id, { frozen: true });
        await createTestUtxo(tx, wallet.id, { frozen: true });
        await createTestUtxo(tx, wallet.id, { frozen: false });

        const frozenCount = await tx.uTXO.count({
          where: {
            walletId: wallet.id,
            frozen: true,
          },
        });

        expect(frozenCount).toBe(2);
      });
    });
  });

  describe('confirmation tracking', () => {
    it('should find UTXOs by confirmation count', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestUtxo(tx, wallet.id, { confirmations: 0 }); // Unconfirmed
        await createTestUtxo(tx, wallet.id, { confirmations: 3 });
        await createTestUtxo(tx, wallet.id, { confirmations: 6 });
        await createTestUtxo(tx, wallet.id, { confirmations: 100 });

        const confirmed = await tx.uTXO.findMany({
          where: {
            walletId: wallet.id,
            confirmations: { gte: 6 },
          },
        });

        expect(confirmed).toHaveLength(2);
      });
    });

    it('should update confirmation count', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id, { confirmations: 0 });

        const updated = await tx.uTXO.update({
          where: { id: utxo.id },
          data: { confirmations: 6 },
        });

        expect(updated.confirmations).toBe(6);
      });
    });
  });

  describe('dust detection', () => {
    it('should find dust UTXOs (below threshold)', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const dustThreshold = BigInt(546);

        await createTestUtxo(tx, wallet.id, { amount: BigInt(100) }); // Dust
        await createTestUtxo(tx, wallet.id, { amount: BigInt(500) }); // Dust
        await createTestUtxo(tx, wallet.id, { amount: BigInt(1000) }); // Normal
        await createTestUtxo(tx, wallet.id, { amount: BigInt(10000) }); // Normal

        const dustUtxos = await tx.uTXO.findMany({
          where: {
            walletId: wallet.id,
            amount: { lt: dustThreshold },
          },
        });

        expect(dustUtxos).toHaveLength(2);
      });
    });
  });

  describe('coin control queries', () => {
    it('should find UTXOs by address', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const targetAddress = generateTestnetAddress();

        await createTestUtxo(tx, wallet.id, { address: targetAddress });
        await createTestUtxo(tx, wallet.id, { address: targetAddress });
        await createTestUtxo(tx, wallet.id, { address: generateTestnetAddress() });

        const utxosAtAddress = await tx.uTXO.findMany({
          where: {
            walletId: wallet.id,
            address: targetAddress,
          },
        });

        expect(utxosAtAddress).toHaveLength(2);
      });
    });

    it('should order UTXOs by amount for selection', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestUtxo(tx, wallet.id, { amount: BigInt(50000) });
        await createTestUtxo(tx, wallet.id, { amount: BigInt(10000) });
        await createTestUtxo(tx, wallet.id, { amount: BigInt(100000) });

        const utxos = await tx.uTXO.findMany({
          where: { walletId: wallet.id },
          orderBy: { amount: 'desc' },
        });

        expect(utxos[0].amount).toBe(BigInt(100000));
        expect(utxos[1].amount).toBe(BigInt(50000));
        expect(utxos[2].amount).toBe(BigInt(10000));
      });
    });
  });

  describe('batch updates', () => {
    it('should update confirmations for multiple UTXOs', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const blockHeight = 100000;

        await createTestUtxo(tx, wallet.id, { blockHeight, confirmations: 0 });
        await createTestUtxo(tx, wallet.id, { blockHeight, confirmations: 0 });
        await createTestUtxo(tx, wallet.id, { blockHeight: null, confirmations: 0 });

        // Update all UTXOs at specific block height
        const result = await tx.uTXO.updateMany({
          where: {
            walletId: wallet.id,
            blockHeight,
          },
          data: { confirmations: 10 },
        });

        expect(result.count).toBe(2);

        const updated = await tx.uTXO.findMany({
          where: { walletId: wallet.id, confirmations: 10 },
        });
        expect(updated).toHaveLength(2);
      });
    });
  });
});
