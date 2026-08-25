/**
 * Transaction Repository Tests
 *
 * Tests for transaction data access layer operations including
 * pagination, filtering, and transaction management.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    transaction: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { transactionRepository } from '../../../src/repositories/transactionRepository';

describe('Transaction Repository', () => {
  const mockTransaction = {
    id: 'tx-123',
    txid: 'abc123def456',
    walletId: 'wallet-456',
    type: 'receive',
    amount: BigInt(100000),
    fee: BigInt(500),
    blockHeight: 800000,
    blockTime: new Date('2025-01-01'),
    confirmations: 6,
    label: null,
    memo: null,
    balanceAfter: BigInt(500000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deleteByWalletId', () => {
    it('should delete all transactions for a wallet', async () => {
      (prisma.transaction.deleteMany as Mock).mockResolvedValue({ count: 50 });

      const count = await transactionRepository.deleteByWalletId('wallet-456');

      expect(count).toBe(50);
      expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
      });
    });

    it('should return 0 when no transactions to delete', async () => {
      (prisma.transaction.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const count = await transactionRepository.deleteByWalletId('empty-wallet');

      expect(count).toBe(0);
    });
  });

  describe('deleteByWalletIds', () => {
    it('should delete transactions for multiple wallets', async () => {
      (prisma.transaction.deleteMany as Mock).mockResolvedValue({ count: 100 });

      const count = await transactionRepository.deleteByWalletIds(['wallet-1', 'wallet-2']);

      expect(count).toBe(100);
      expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
        where: { walletId: { in: ['wallet-1', 'wallet-2'] } },
      });
    });
  });

  describe('findByWalletId', () => {
    it('should find transactions for wallet', async () => {
      const transactions = [mockTransaction, { ...mockTransaction, id: 'tx-456' }];
      (prisma.transaction.findMany as Mock).mockResolvedValue(transactions);

      const result = await transactionRepository.findByWalletId('wallet-456');

      expect(result).toHaveLength(2);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        skip: undefined,
        take: undefined,
        orderBy: { blockTime: 'desc' },
      });
    });

    it('should support pagination options', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([mockTransaction]);

      await transactionRepository.findByWalletId('wallet-456', {
        skip: 10,
        take: 20,
      });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        skip: 10,
        take: 20,
        orderBy: { blockTime: 'desc' },
      });
    });

    it('should support custom ordering', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([mockTransaction]);

      await transactionRepository.findByWalletId('wallet-456', {
        orderBy: { amount: 'desc' },
      });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { amount: 'desc' },
        })
      );
    });
  });

  describe('findByWalletIdWithDetails', () => {
    it('should merge filters while keeping the scoped wallet id authoritative', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([mockTransaction]);

      await transactionRepository.findByWalletIdWithDetails('wallet-456', {
        where: {
          walletId: 'attacker-wallet',
          rbfStatus: { not: 'replaced' },
        },
        include: {
          transactionLabels: true,
        },
      });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          rbfStatus: { not: 'replaced' },
          walletId: 'wallet-456',
        },
        include: {
          transactionLabels: true,
        },
        orderBy: { blockTime: 'desc' },
        take: undefined,
        skip: undefined,
      });
    });
  });

  describe('findByWalletIdsWithDetails', () => {
    it('should merge filters while keeping the scoped wallet id list authoritative', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([mockTransaction]);

      await transactionRepository.findByWalletIdsWithDetails(['wallet-1', 'wallet-2'], {
        where: {
          walletId: 'attacker-wallet',
          type: 'sent',
        },
        take: 5,
      });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          type: 'sent',
          walletId: { in: ['wallet-1', 'wallet-2'] },
        },
        orderBy: { blockTime: 'desc' },
        take: 5,
      });
    });
  });

  describe('countByWalletId', () => {
    it('should return transaction count', async () => {
      (prisma.transaction.count as Mock).mockResolvedValue(42);

      const count = await transactionRepository.countByWalletId('wallet-456');

      expect(count).toBe(42);
      expect(prisma.transaction.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
      });
    });
  });

  describe('findByWalletIdPaginated', () => {
    it('should return paginated results', async () => {
      const transactions = Array.from({ length: 51 }, (_, i) => ({
        ...mockTransaction,
        id: `tx-${i}`,
        blockTime: new Date(`2025-01-${String(i + 1).padStart(2, '0')}`),
      }));

      (prisma.transaction.findMany as Mock).mockResolvedValue(transactions);
      (prisma.transaction.count as Mock).mockResolvedValue(100);

      const result = await transactionRepository.findByWalletIdPaginated('wallet-456', {
        limit: 50,
        includeCount: true,
      });

      expect(result.items).toHaveLength(50);
      expect(result.hasMore).toBe(true);
      expect(result.totalCount).toBe(100);
    });

    it('should use cursor-based pagination with forward direction', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([mockTransaction]);

      const cursor = { blockTime: new Date('2025-01-01'), id: 'tx-100' };
      await transactionRepository.findByWalletIdPaginated('wallet-456', {
        cursor,
        direction: 'forward',
      });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            walletId: 'wallet-456',
            OR: expect.any(Array),
          }),
          orderBy: [{ blockTime: 'desc' }, { id: 'desc' }],
        })
      );
    });

    it('should use cursor-based pagination with backward direction', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([
        { ...mockTransaction, id: 'tx-1' },
        { ...mockTransaction, id: 'tx-2' },
      ]);

      const cursor = { blockTime: new Date('2025-01-01'), id: 'tx-100' };
      await transactionRepository.findByWalletIdPaginated('wallet-456', {
        cursor,
        direction: 'backward',
      });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ blockTime: 'asc' }, { id: 'asc' }],
        })
      );
    });

    it('should cap limit at 200', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([]);

      await transactionRepository.findByWalletIdPaginated('wallet-456', { limit: 500 });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 201, // 200 + 1 for hasMore detection
        })
      );
    });

    it('should indicate no more results at end', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([mockTransaction]);

      const result = await transactionRepository.findByWalletIdPaginated('wallet-456', {
        limit: 50,
      });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should keep nextCursor null when last paged item has null blockTime', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([
        { ...mockTransaction, id: 'tx-null-time', blockTime: null },
        { ...mockTransaction, id: 'tx-extra', blockTime: new Date('2025-01-02') },
      ]);

      const result = await transactionRepository.findByWalletIdPaginated('wallet-456', {
        limit: 1,
      });

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('findByTxid', () => {
    it('should use the compound unique key to scope duplicate txids to a wallet', async () => {
      (prisma.transaction.findUnique as Mock).mockResolvedValue(mockTransaction);

      const result = await transactionRepository.findByTxid('abc123def456', 'wallet-456');

      expect(result).toEqual(mockTransaction);
      expect(prisma.transaction.findUnique).toHaveBeenCalledWith({
        where: {
          txid_walletId: {
            txid: 'abc123def456',
            walletId: 'wallet-456',
          },
        },
      });
    });

    it('should return null when transaction not found', async () => {
      (prisma.transaction.findUnique as Mock).mockResolvedValue(null);

      const result = await transactionRepository.findByTxid('nonexistent', 'wallet-456');

      expect(result).toBeNull();
    });

    it('forwards payload options without weakening the compound wallet scope', async () => {
      (prisma.transaction.findUnique as Mock).mockResolvedValue({
        ...mockTransaction,
        wallet: { id: 'wallet-456' },
      });

      await transactionRepository.findByTxid('abc123def456', 'wallet-456', {
        include: { wallet: true },
      });

      expect(prisma.transaction.findUnique).toHaveBeenCalledWith({
        where: {
          txid_walletId: {
            txid: 'abc123def456',
            walletId: 'wallet-456',
          },
        },
        include: { wallet: true },
      });
    });
  });

  describe('findAccessibleByTxidMatches', () => {
    it.each([
      { matches: [], expectedCount: 0 },
      { matches: [mockTransaction], expectedCount: 1 },
      {
        matches: [mockTransaction, { ...mockTransaction, id: 'tx-789', walletId: 'wallet-789' }],
        expectedCount: 2,
      },
    ])('returns $expectedCount accessible matches', async ({ matches, expectedCount }) => {
      (prisma.transaction.findMany as Mock).mockResolvedValue(matches);

      const result = await transactionRepository.findAccessibleByTxidMatches(
        'abc123def456',
        'user-123',
      );

      expect(result).toHaveLength(expectedCount);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          txid: 'abc123def456',
          wallet: {
            OR: [
              { users: { some: { userId: 'user-123' } } },
              { group: { members: { some: { userId: 'user-123' } } } },
            ],
          },
        },
        orderBy: [{ walletId: 'asc' }, { id: 'asc' }],
        take: 2,
      });
    });

    it('forwards select options while retaining the deterministic two-match bound', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([{ id: 'tx-123' }]);

      const result = await transactionRepository.findAccessibleByTxidMatches(
        'abc123def456',
        'user-123',
        { select: { id: true } },
      );

      expect(result).toEqual([{ id: 'tx-123' }]);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true },
          orderBy: [{ walletId: 'asc' }, { id: 'asc' }],
          take: 2,
        }),
      );
    });

    it('forwards include options while retaining the deterministic two-match bound', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([
        { ...mockTransaction, wallet: { id: 'wallet-456' } },
      ]);

      await transactionRepository.findAccessibleByTxidMatches(
        'abc123def456',
        'user-123',
        { include: { wallet: true } },
      );

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { wallet: true },
          orderBy: [{ walletId: 'asc' }, { id: 'asc' }],
          take: 2,
        }),
      );
    });
  });

  describe('findManyByTxids', () => {
    it('should find transactions by unique txids and wallet', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([mockTransaction]);

      const result = await transactionRepository.findManyByTxids(
        ['abc123def456', 'abc123def456', ''],
        'wallet-456',
      );

      expect(result).toEqual([mockTransaction]);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          txid: { in: ['abc123def456'] },
        },
      });
    });

    it('should skip the database when no txids are provided', async () => {
      const result = await transactionRepository.findManyByTxids([], 'wallet-456');

      expect(result).toEqual([]);
      expect(prisma.transaction.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findForBalanceHistory', () => {
    it('should find transactions for balance chart', async () => {
      const historyData = [
        { blockTime: new Date('2025-01-01'), balanceAfter: BigInt(100000) },
        { blockTime: new Date('2025-01-02'), balanceAfter: BigInt(200000) },
      ];
      (prisma.transaction.findMany as Mock).mockResolvedValue(historyData);

      const startDate = new Date('2024-12-01');
      const result = await transactionRepository.findForBalanceHistory('wallet-456', startDate);

      expect(result).toEqual(historyData);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          blockTime: { gte: startDate },
          type: { not: 'consolidation' },
        },
        select: {
          blockTime: true,
          balanceAfter: true,
        },
        orderBy: { blockTime: 'asc' },
      });
    });
  });

  describe('findWithLabels', () => {
    it('should find transactions with labels for export', async () => {
      const transactionsWithLabels = [
        {
          ...mockTransaction,
          label: 'Donation',
          transactionLabels: [
            { label: { id: 'label-1', name: 'Personal' } },
          ],
        },
      ];
      (prisma.transaction.findMany as Mock).mockResolvedValue(transactionsWithLabels);

      const result = await transactionRepository.findWithLabels('wallet-456');

      expect(result[0].label).toBe('Donation');
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          OR: [
            { label: { not: null } },
            { memo: { not: null } },
            { transactionLabels: { some: {} } },
          ],
        },
        include: {
          transactionLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    });
  });

  describe('findWalletIdsRequiringConfirmationUpdateAtHeight', () => {
    it.each([0, 101, 1.5])('rejects invalid page limit %s', async limit => {
      await expect(transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
        6,
        'mainnet',
        100,
        null,
        limit,
      )).rejects.toThrow('page limit is invalid');
      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });

    it.each(['', 'w'.repeat(201)])('rejects invalid page cursor %j', async cursor => {
      await expect(transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
        6,
        'mainnet',
        100,
        cursor,
      )).rejects.toThrow('wallet cursor is invalid');
      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });

    it.each([0, 60_001, 1.5])('rejects invalid query timeout %s', async timeoutMs => {
      await expect(transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
        6,
        'mainnet',
        100,
        null,
        100,
        timeoutMs,
      )).rejects.toThrow('query timeout is invalid');
      expect(prisma.transaction.groupBy).not.toHaveBeenCalled();
    });
  });

});
