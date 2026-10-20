/**
 * UTXO age Integration Test
 *
 * UTXO age (tax long/short-term split, age milestones) must come from the
 * confirming transaction's block time, not the DB insert time: a fresh sync
 * stamps every coin with createdAt = now.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  createTestUser,
  createTestWallet,
  createTestTransaction,
  createTestUtxo,
  getTestPrisma,
} from './setup';
import { intelligenceRepository, utxoRepository } from '../../../src/repositories';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

describeIfDatabase('UTXO age (block-time based) Integration Tests', () => {
  setupRepositoryTests();

  it('classifies and windows UTXOs by confirming block time', async () => {
    const client = await getTestPrisma();
    const user = await createTestUser(client);
    const wallet = await createTestWallet(client, user.id);
    const sats = {
      A: BigInt(1), B: BigInt(10), C: BigInt(100), D: BigInt(1_000),
      E: BigInt(10_000), F: BigInt(100_000), G: BigInt(1_000_000),
    };
    const txid = (c: string) => c.repeat(64);

    try {
      // A: old block time but createdAt = now (fresh sync)
      await createTestTransaction(client, wallet.id, { txid: txid('a'), blockTime: daysAgo(400) });
      await createTestUtxo(client, wallet.id, { txid: txid('a'), amount: sats.A });
      // B: recent
      await createTestTransaction(client, wallet.id, { txid: txid('b'), blockTime: daysAgo(10) });
      await createTestUtxo(client, wallet.id, { txid: txid('b'), amount: sats.B });
      // C: unconfirmed (tx row without blockTime)
      await client.transaction.create({
        data: {
          walletId: wallet.id, txid: txid('c'), type: 'received', amount: sats.C,
          fee: BigInt(0), confirmations: 0, blockHeight: null, blockTime: null,
        },
      });
      await createTestUtxo(client, wallet.id, { txid: txid('c'), amount: sats.C, confirmations: 0, blockHeight: null });
      // D: ~350 days old
      await createTestTransaction(client, wallet.id, { txid: txid('d'), blockTime: daysAgo(350) });
      await createTestUtxo(client, wallet.id, { txid: txid('d'), amount: sats.D });
      // E: spent, old
      await createTestTransaction(client, wallet.id, { txid: txid('e'), blockTime: daysAgo(400) });
      await createTestUtxo(client, wallet.id, { txid: txid('e'), amount: sats.E, spent: true });
      // F: no transaction row at all
      await createTestUtxo(client, wallet.id, { txid: txid('f'), amount: sats.F });
      // G: only an RBF-replaced transaction row
      await createTestTransaction(client, wallet.id, {
        txid: txid('9'), blockTime: daysAgo(400), rbfStatus: 'replaced',
      });
      await createTestUtxo(client, wallet.id, { txid: txid('9'), amount: sats.G });

      const dist = await intelligenceRepository.getUtxoAgeDistribution(wallet.id, 365);
      expect(dist.longTerm.count).toBe(1);
      expect(dist.longTerm.totalSats).toBe(sats.A);
      expect(dist.shortTerm.count).toBe(5);
      expect(dist.shortTerm.totalSats).toBe(sats.B + sats.C + sats.D + sats.F + sats.G);

      const win = await utxoRepository.aggregateByDateWindow(wallet.id, daysAgo(352), daysAgo(348));
      expect(win._count._all).toBe(1);
      expect(win._sum.amount).toBe(sats.D);

      // Unconfirmed / orphaned / replaced coins never fall in a block-time window
      const wide = await utxoRepository.aggregateByDateWindow(wallet.id, daysAgo(1000), new Date(Date.now() + DAY_MS));
      expect(wide._count._all).toBe(3);
      expect(wide._sum.amount).toBe(sats.A + sats.B + sats.D);
    } finally {
      await client.uTXO.deleteMany({ where: { walletId: wallet.id } });
      await client.transaction.deleteMany({ where: { walletId: wallet.id } });
      await client.wallet.delete({ where: { id: wallet.id } });
      await client.user.delete({ where: { id: user.id } });
    }
  });
});
