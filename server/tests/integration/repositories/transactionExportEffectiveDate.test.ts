import { transactionRepository } from '../../../src/repositories';
import type { PrismaTxClient } from '../../../src/models/prisma';
import {
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
} from './setup';

const PAGE_SIZE = 500;
const inside = new Date('2025-01-15T12:00:00.000Z');

describeIfDatabase('transaction export effective-date paging', () => {
  setupRepositoryTests();

  it('pages live confirmed and pending rows by effective UTC date without gaps', async () => {
    await withTestTransaction(async tx => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const activeRows = Array.from({ length: 501 }, (_, index) => ({
        id: `export-active-${String(index).padStart(4, '0')}`,
        txid: index.toString(16).padStart(64, '0'),
        walletId: wallet.id,
        type: 'received',
        amount: 1n,
        confirmations: 1,
        blockHeight: 900_000,
        blockTime: inside,
        createdAt: inside,
        rbfStatus: 'active',
      }));
      await tx.transaction.createMany({
        data: [
          ...activeRows,
          {
            id: 'export-pending',
            txid: 'f'.repeat(64),
            walletId: wallet.id,
            type: 'received',
            amount: 2n,
            confirmations: 0,
            blockHeight: null,
            blockTime: null,
            createdAt: inside,
            rbfStatus: 'active',
          },
          {
            id: 'export-replaced',
            txid: 'e'.repeat(64),
            walletId: wallet.id,
            type: 'sent',
            amount: -3n,
            confirmations: 0,
            blockHeight: null,
            blockTime: null,
            createdAt: inside,
            rbfStatus: 'replaced',
          },
          {
            id: 'export-end-boundary',
            txid: 'd'.repeat(64),
            walletId: wallet.id,
            type: 'received',
            amount: 4n,
            balanceAfter: 40n,
            fee: 1n,
            confirmations: 2,
            blockHeight: 900_001,
            blockTime: new Date('2025-01-31T23:59:59.999Z'),
            createdAt: inside,
            rbfStatus: 'confirmed',
          },
          {
            id: 'export-outside',
            txid: 'c'.repeat(64),
            walletId: wallet.id,
            type: 'received',
            amount: 5n,
            confirmations: 2,
            blockHeight: 900_002,
            blockTime: new Date('2025-02-01T00:00:00.000Z'),
            createdAt: inside,
            rbfStatus: 'confirmed',
          },
          {
            id: 'export-pending-outside',
            txid: 'b'.repeat(64),
            walletId: wallet.id,
            type: 'received',
            amount: 6n,
            confirmations: 0,
            blockHeight: null,
            blockTime: null,
            createdAt: new Date('2025-02-01T00:00:00.000Z'),
            rbfStatus: 'active',
          },
        ],
      });

      const rows = [];
      const startedAt = Date.now();
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await transactionRepository.findExportRowPage(
          wallet.id,
          {
            gte: new Date('2025-01-15T00:00:00.000Z'),
            lte: new Date('2025-01-31T23:59:59.999Z'),
          },
          offset,
          PAGE_SIZE,
          tx as unknown as PrismaTxClient,
        );
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      expect(Date.now() - startedAt).toBeLessThan(30_000);
      expect(rows).toHaveLength(503);
      expect(new Set(rows.map(row => row.id)).size).toBe(503);
      expect(rows.map(row => row.id)).not.toContain('export-replaced');
      expect(rows.map(row => row.id)).not.toContain('export-outside');
      expect(rows.map(row => row.id)).not.toContain('export-pending-outside');
      expect(rows.map(row => row.id)).toContain('export-pending');
      expect(rows.at(-1)?.id).toBe('export-end-boundary');
      const pending = rows.find(row => row.id === 'export-pending');
      expect(pending).toMatchObject({
        amount: 2n,
        blockHeight: null,
        blockTime: null,
        createdAt: inside,
      });
      const boundary = rows.at(-1);
      expect(boundary?.amount).toBe(4n);
      expect(boundary?.balanceAfter).toBe(40n);
      expect(boundary?.fee).toBe(1n);
      expect(boundary?.blockHeight).toBe(900_001);
      expect(boundary?.blockTime).toEqual(new Date('2025-01-31T23:59:59.999Z'));
      expect(rows.slice(0, -1).map(row => row.id)).toEqual(
        [...rows.slice(0, -1).map(row => row.id)].sort(),
      );
    });
  });
});
