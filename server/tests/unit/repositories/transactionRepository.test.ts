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
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    transaction: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    transactionInput: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { transactionRepository } from '../../../src/repositories/transactionRepository';
import { withLiveTransactionWhere } from '../../../src/repositories/transactions/visibility';

describe('Transaction Repository', () => {
  it('preserves an existing scope conjunction in the live transaction fence', () => {
    expect(withLiveTransactionWhere(
      { type: 'sent' },
      { walletId: 'wallet-1', AND: { confirmations: { gt: 0 } } },
    )).toEqual({
      walletId: 'wallet-1',
      rbfStatus: { not: 'replaced' },
      AND: [{ confirmations: { gt: 0 } }, { type: 'sent' }],
    });
    expect(withLiveTransactionWhere(
      { type: 'received' },
      { AND: [{ walletId: 'wallet-1' }, { confirmations: 0 }] },
    )).toEqual({
      rbfStatus: { not: 'replaced' },
      AND: [{ walletId: 'wallet-1' }, { confirmations: 0 }, { type: 'received' }],
    });
  });

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
    (prisma.$transaction as Mock).mockImplementation(
      (callback: (client: typeof prisma) => unknown) => callback(prisma),
    );
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

  describe('cross-wallet live activity', () => {
    it('excludes replaced rows from grouped activity', async () => {
      (prisma.transaction.groupBy as Mock).mockResolvedValue([]);
      const startDate = new Date('2026-01-01T00:00:00.000Z');

      await transactionRepository.groupActivityByType(['wallet-1'], startDate);

      expect(prisma.transaction.groupBy).toHaveBeenCalledWith({
        by: ['type'],
        where: {
          walletId: { in: ['wallet-1'] },
          blockTime: { not: null, gte: startDate },
          rbfStatus: { not: 'replaced' },
        },
        _count: { id: true },
        _sum: { amount: true },
        _max: { blockTime: true },
      });
    });

    it.each(['hour', 'day', 'week', 'month'] as const)(
      'excludes replaced rows from %s balance buckets',
      async bucketUnit => {
        (prisma.$queryRaw as Mock).mockResolvedValue([]);

        await transactionRepository.getBucketedBalanceDeltas(
          ['wallet-1'],
          new Date('2026-01-01T00:00:00.000Z'),
          bucketUnit,
        );

        const call = (prisma.$queryRaw as Mock).mock.calls.at(-1) ?? [];
        const livePredicate = call.find(
          value => typeof value === 'object' && value !== null && 'strings' in value,
        ) as { strings?: string[] } | undefined;
        expect(livePredicate?.strings?.join('')).toContain('"rbfStatus" <> \'replaced\'');
      },
    );
  });

  describe('findByWalletId', () => {
    it('should find transactions for wallet', async () => {
      const transactions = [mockTransaction, { ...mockTransaction, id: 'tx-456' }];
      (prisma.transaction.findMany as Mock).mockResolvedValue(transactions);

      const result = await transactionRepository.findByWalletId('wallet-456');

      expect(result).toHaveLength(2);
      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', rbfStatus: { not: 'replaced' } },
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
        where: { walletId: 'wallet-456', rbfStatus: { not: 'replaced' } },
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
    it('applies the live scope when no optional filters are supplied', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([]);

      await transactionRepository.findByWalletIdWithDetails('wallet-456');

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          walletId: 'wallet-456',
          rbfStatus: { not: 'replaced' },
          AND: {},
        },
      }));
    });

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
          walletId: 'wallet-456',
          rbfStatus: { not: 'replaced' },
          AND: { walletId: 'attacker-wallet', rbfStatus: { not: 'replaced' } },
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
    it('applies the live scope when no optional filters are supplied', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([]);

      await transactionRepository.findByWalletIdsWithDetails(['wallet-1', 'wallet-2']);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          walletId: { in: ['wallet-1', 'wallet-2'] },
          rbfStatus: { not: 'replaced' },
          AND: {},
        },
      }));
    });

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
          walletId: { in: ['wallet-1', 'wallet-2'] },
          rbfStatus: { not: 'replaced' },
          AND: { walletId: 'attacker-wallet', type: 'sent' },
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
        where: { walletId: 'wallet-456', rbfStatus: { not: 'replaced' } },
      });
    });
  });

  describe('confirmation refresh candidates', () => {
    it('excludes replaced rows from the wallet-scoped shallow selector', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([]);

      await transactionRepository.findBelowConfirmationThreshold('wallet-456', 6);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          confirmations: { lt: 6 },
          blockHeight: { not: null },
          rbfStatus: { not: 'replaced' },
        },
        select: { id: true, txid: true, blockHeight: true, confirmations: true },
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
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          walletId: 'wallet-456',
          rbfStatus: { not: 'replaced' },
        }),
      }));
      expect(prisma.transaction.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', rbfStatus: { not: 'replaced' } },
      });
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
          rbfStatus: { not: 'replaced' },
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

  describe('findWalletIdsWithPendingConfirmations', () => {
    it('includes the persisted testnet alias for canonical testnet3 block events', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([{ walletId: 'legacy-wallet' }]);

      await expect(transactionRepository.findWalletIdsWithPendingConfirmations(
        6,
        'testnet3',
      )).resolves.toEqual(['legacy-wallet']);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          confirmations: { lt: 6 },
          rbfStatus: { not: 'replaced' },
          wallet: { network: { in: ['testnet3', 'testnet'] } },
        },
        select: { walletId: true },
        distinct: ['walletId'],
      });
    });

    it('retains the explicitly named all-network maintenance query', async () => {
      (prisma.transaction.findMany as Mock).mockResolvedValue([]);

      await transactionRepository.findWalletIdsWithPendingConfirmations(6);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: { confirmations: { lt: 6 }, rbfStatus: { not: 'replaced' } },
        select: { walletId: true },
        distinct: ['walletId'],
      });
    });
  });

  describe('findUnconfirmedTransactionForReplacement', () => {
    it('queries by txid, walletId, the unconfirmed filter, and the not-yet-replaced filter together, selecting the original amount/fee/type', async () => {
      (prisma.transaction.findFirst as Mock).mockResolvedValue({
        id: 'tx-1', label: 'L', amount: -9500n, fee: 500n, type: 'sent',
      });

      await expect(transactionRepository.findUnconfirmedTransactionForReplacement(
        'a'.repeat(64),
        'wallet-1',
      )).resolves.toEqual({ id: 'tx-1', label: 'L', amount: -9500n, fee: 500n, type: 'sent' });

      // This where-clause is the actual security boundary for RBF linkage: a
      // confirmed original, one on another wallet, or one already replaced
      // by a different transaction must not resolve here. `amount`, `fee`,
      // and `type` are selected so a verified replacement's reservation can
      // be reduced by the original's positive, fee-excluded external send
      // amount — NOT the raw signed `amount` column, which
      // persistTransaction.ts stores as -(external + fee)
      // (rbf-fee-bump-double-reserves-policy-usage-window).
      expect(prisma.transaction.findFirst).toHaveBeenCalledWith({
        where: {
          txid: 'a'.repeat(64),
          walletId: 'wallet-1',
          confirmations: 0,
          blockHeight: null,
          rbfStatus: { not: 'replaced' },
          replacedByTxid: null,
        },
        select: { id: true, label: true, amount: true, fee: true, type: true },
      });
    });

    it('resolves to null when no unconfirmed match exists on this wallet', async () => {
      (prisma.transaction.findFirst as Mock).mockResolvedValue(null);

      await expect(transactionRepository.findUnconfirmedTransactionForReplacement(
        'a'.repeat(64),
        'wallet-1',
      )).resolves.toBeNull();
    });
  });

  describe('linkReplacementIfUnreplaced', () => {
    it('performs a compare-and-swap update guarded by rbfStatus and replacedByTxid', async () => {
      (prisma.transaction.updateMany as Mock).mockResolvedValue({ count: 1 });

      await expect(transactionRepository.linkReplacementIfUnreplaced(
        'original-id',
        'wallet-1',
        'new-txid',
      )).resolves.toBe(true);

      expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'original-id',
          walletId: 'wallet-1',
          rbfStatus: { not: 'replaced' },
          replacedByTxid: null,
        },
        data: {
          rbfStatus: 'replaced',
          replacedByTxid: 'new-txid',
        },
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('resolves to false when zero rows update (a concurrent broadcast already linked it)', async () => {
      (prisma.transaction.updateMany as Mock).mockResolvedValue({ count: 0 });

      await expect(transactionRepository.linkReplacementIfUnreplaced(
        'original-id',
        'wallet-1',
        'new-txid',
      )).resolves.toBe(false);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('findInputOutpointsByTransactionId', () => {
    it('selects only txid and vout, scoped to the transaction id', async () => {
      (prisma.transactionInput.findMany as Mock).mockResolvedValue([
        { txid: 'b'.repeat(64), vout: 0 },
      ]);

      await expect(transactionRepository.findInputOutpointsByTransactionId('tx-1'))
        .resolves.toEqual([{ txid: 'b'.repeat(64), vout: 0 }]);

      expect(prisma.transactionInput.findMany).toHaveBeenCalledWith({
        where: { transactionId: 'tx-1' },
        select: { txid: true, vout: true },
      });
    });
  });

  describe('findLocallySpentOutpointKeys', () => {
    it('returns an empty set without querying when no keys are given', async () => {
      await expect(
        transactionRepository.findLocallySpentOutpointKeys('wallet-1', [])
      ).resolves.toEqual(new Set());

      expect(prisma.transactionInput.findMany).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the wallet, excludes replaced transactions, and matches by outpoint', async () => {
      const txid = 'c'.repeat(64);
      (prisma.transactionInput.findMany as Mock).mockResolvedValue([
        { txid, vout: 1 },
      ]);

      await expect(
        transactionRepository.findLocallySpentOutpointKeys('wallet-1', [`${txid}:1`, `${txid}:2`])
      ).resolves.toEqual(new Set([`${txid}:1`]));

      expect(prisma.transactionInput.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ txid, vout: 1 }, { txid, vout: 2 }],
          transaction: { walletId: 'wallet-1', rbfStatus: { not: 'replaced' } },
        },
        select: { txid: true, vout: true },
      });
    });

    it('chunks large key lists to bound each query', async () => {
      const keys = Array.from({ length: 501 }, (_, index) => `${'d'.repeat(64)}:${index}`);
      (prisma.transactionInput.findMany as Mock).mockResolvedValue([]);

      await transactionRepository.findLocallySpentOutpointKeys('wallet-1', keys);

      expect(prisma.transactionInput.findMany).toHaveBeenCalledTimes(2);
    });
  });

});
