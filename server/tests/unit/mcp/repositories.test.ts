import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

const prisma = vi.hoisted(() => ({
  mcpApiKey: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  feeEstimate: { findFirst: vi.fn() },
  priceData: { findFirst: vi.fn() },
  wallet: { findMany: vi.fn(), findFirst: vi.fn() },
  uTXO: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  transaction: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
  address: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  draftTransaction: { count: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: prisma,
}));

import * as apiKeyRepository from '../../../src/repositories/mcpApiKeyRepository';
import * as readRepository from '../../../src/repositories/mcpReadRepository';

describe('MCP repositories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates, lists, finds, revokes, and updates MCP API key metadata', async () => {
    prisma.mcpApiKey.create.mockResolvedValue({ id: 'key-1' });
    await expect(apiKeyRepository.create({
      userId: 'user-1',
      name: 'Local',
      keyHash: 'hash',
      keyPrefix: 'mcp_hash',
    })).resolves.toEqual({ id: 'key-1' });
    expect(prisma.mcpApiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        createdByUserId: null,
        name: 'Local',
        keyHash: 'hash',
        keyPrefix: 'mcp_hash',
        scope: Prisma.DbNull,
        expiresAt: null,
      }),
    });

    prisma.mcpApiKey.findUnique.mockResolvedValue({ id: 'key-1' });
    await apiKeyRepository.findByKeyHash('hash');
    expect(prisma.mcpApiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: 'hash' },
      include: { user: { select: { id: true, username: true, isAdmin: true } } },
    });

    await apiKeyRepository.findById('key-1');
    expect(prisma.mcpApiKey.findUnique).toHaveBeenLastCalledWith({ where: { id: 'key-1' } });

    await apiKeyRepository.findMany();
    expect(prisma.mcpApiKey.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, username: true, isAdmin: true } } },
    });

    prisma.mcpApiKey.update.mockResolvedValue({ id: 'key-1', revokedAt: expect.any(Date) });
    await apiKeyRepository.revoke('key-1');
    expect(prisma.mcpApiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { revokedAt: expect.any(Date) },
    });

    const staleBefore = new Date('2026-04-16T00:00:00.000Z');
    await apiKeyRepository.updateLastUsedIfStale('key-1', staleBefore, { lastUsedIp: '127.0.0.1' });
    expect(prisma.mcpApiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'key-1',
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }],
      },
      data: {
        lastUsedAt: expect.any(Date),
        lastUsedIp: '127.0.0.1',
        lastUsedAgent: null,
      },
    });
  });

  it('wraps MCP read queries with explicit ordering, includes, and limits', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(readRepository.checkDatabase()).resolves.toBe(true);
    prisma.$queryRaw.mockRejectedValueOnce(new Error('down'));
    await expect(readRepository.checkDatabase()).resolves.toBe(false);

    await readRepository.getLatestFeeEstimate();
    expect(prisma.feeEstimate.findFirst).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });

    await readRepository.getLatestPrice('USD');
    expect(prisma.priceData.findFirst).toHaveBeenCalledWith({
      where: { currency: 'USD' },
      orderBy: { createdAt: 'desc' },
    });

    await readRepository.getWalletBalance('wallet-1');
    expect(prisma.uTXO.aggregate).toHaveBeenCalledTimes(3);
    expect(prisma.uTXO.aggregate).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', spent: false, confirmations: { gt: 0 } },
      _count: { id: true },
      _sum: { amount: true },
    });

    await readRepository.findWalletTransactions('wallet-1', { limit: 20, offset: 5 });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { walletId: 'wallet-1' },
      include: { transactionLabels: { include: { label: true } } },
      take: 20,
      skip: 5,
    }));

    await readRepository.findWalletTransactionDetail('wallet-1', 'txid');
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { walletId: 'wallet-1', txid: 'txid' },
      include: expect.objectContaining({
        inputs: { orderBy: { inputIndex: 'asc' } },
        outputs: { orderBy: { outputIndex: 'asc' } },
      }),
    }));

    await readRepository.queryTransactions({ walletId: 'wallet-1' }, 10);
    expect(prisma.transaction.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { walletId: 'wallet-1' },
      take: 10,
    }));

    await readRepository.queryUtxos({ walletId: 'wallet-1' }, 10);
    expect(prisma.uTXO.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { walletId: 'wallet-1' },
      include: { draftLock: { include: { draft: { select: { id: true, label: true } } } } },
      orderBy: { amount: 'desc' },
      take: 10,
    }));

    await readRepository.searchAddresses({ walletId: 'wallet-1' }, 10);
    expect(prisma.address.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
      include: { addressLabels: { include: { label: true } } },
      orderBy: { index: 'asc' },
      take: 10,
    });

    await readRepository.countDrafts('wallet-1');
    expect(prisma.draftTransaction.count).toHaveBeenCalledWith({ where: { walletId: 'wallet-1' } });

    const cutoff = new Date('2026-04-01T00:00:00.000Z');
    await readRepository.aggregateFees('wallet-1', cutoff);
    expect(prisma.transaction.aggregate).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', fee: { gt: 0 }, blockTime: { gte: cutoff } },
      _count: { id: true },
      _sum: { fee: true },
      _avg: { fee: true },
    });
  });

  it('wraps expanded assistant read queries with scope filters and aggregate boundaries', async () => {
    await expect(
      readRepository.getDashboardSummary('user-1', { walletIds: [], limit: 10 })
    ).resolves.toEqual({ wallets: [], balances: [], transactionCounts: [], pendingCounts: [] });
    expect(prisma.wallet.findMany).not.toHaveBeenCalled();

    prisma.wallet.findMany.mockResolvedValueOnce([]);
    await expect(
      readRepository.getDashboardSummary('user-1', { limit: 5, network: 'signet' })
    ).resolves.toEqual({ wallets: [], balances: [], transactionCounts: [], pendingCounts: [] });
    expect(prisma.wallet.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        network: 'signet',
        OR: [
          { users: { some: { userId: 'user-1' } } },
          { group: { members: { some: { userId: 'user-1' } } } },
        ],
      }),
      take: 5,
    }));
    expect(prisma.uTXO.groupBy).not.toHaveBeenCalled();
    expect(prisma.transaction.groupBy).not.toHaveBeenCalled();

    vi.clearAllMocks();
    prisma.wallet.findMany.mockResolvedValueOnce([{ id: 'wallet-1' }]);
    prisma.uTXO.groupBy.mockResolvedValueOnce([{ walletId: 'wallet-1', _count: { id: 2 } }]);
    prisma.transaction.groupBy
      .mockResolvedValueOnce([{ walletId: 'wallet-1', _count: { id: 3 } }])
      .mockResolvedValueOnce([{ walletId: 'wallet-1', _count: { id: 1 } }]);

    await expect(
      readRepository.getDashboardSummary('user-1', { walletIds: ['wallet-1'], limit: 10 })
    ).resolves.toMatchObject({
      wallets: [{ id: 'wallet-1' }],
      balances: [{ walletId: 'wallet-1' }],
      transactionCounts: [{ walletId: 'wallet-1' }],
      pendingCounts: [{ walletId: 'wallet-1' }],
    });
    expect(prisma.wallet.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['wallet-1'] },
        OR: [
          { users: { some: { userId: 'user-1' } } },
          { group: { members: { some: { userId: 'user-1' } } } },
        ],
      }),
      take: 10,
    }));
    expect(prisma.uTXO.groupBy).toHaveBeenCalledWith({
      by: ['walletId'],
      where: { walletId: { in: ['wallet-1'] }, spent: false },
      _count: { id: true },
      _sum: { amount: true },
    });
    expect(prisma.transaction.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['walletId'],
      where: {
        walletId: { in: ['wallet-1'] },
        rbfStatus: { not: 'replaced' },
        OR: [{ blockHeight: 0 }, { blockHeight: null }],
      },
      _count: { id: true },
    });

    await readRepository.findWalletDetailSummary('wallet-1', 'user-1');
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'wallet-1',
        OR: [
          { users: { some: { userId: 'user-1' } } },
          { group: { members: { some: { userId: 'user-1' } } } },
        ],
      }),
      include: expect.objectContaining({
        devices: expect.objectContaining({ orderBy: { signerIndex: 'asc' } }),
        users: { select: { role: true } },
      }),
    }));
  });

  it('wraps transaction, UTXO, and address parity read queries', async () => {
    prisma.transaction.groupBy.mockResolvedValueOnce([{ type: 'received', _count: { id: 1 } }]);
    prisma.transaction.aggregate.mockResolvedValueOnce({ _count: { id: 1 }, _sum: { fee: 10n } });
    prisma.transaction.findFirst.mockResolvedValueOnce({ balanceAfter: 100n });
    await expect(readRepository.getTransactionStats('wallet-1')).resolves.toEqual({
      typeStats: [{ type: 'received', _count: { id: 1 } }],
      feeStats: { _count: { id: 1 }, _sum: { fee: 10n } },
      lastTransaction: { balanceAfter: 100n },
    });
    expect(prisma.transaction.groupBy).toHaveBeenCalledWith({
      by: ['type'],
      where: { walletId: 'wallet-1' },
      _count: { id: true },
      _sum: { amount: true },
    });
    expect(prisma.transaction.aggregate).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', type: { in: ['sent', 'consolidation'] }, fee: { gt: 0 } },
      _count: { id: true },
      _sum: { fee: true },
    });

    await readRepository.findPendingTransactions('wallet-1', 5);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        walletId: 'wallet-1',
        rbfStatus: { not: 'replaced' },
        OR: [{ blockHeight: 0 }, { blockHeight: null }],
      },
      take: 5,
    }));

    await readRepository.getUtxoSummary('wallet-1');
    expect(prisma.uTXO.aggregate).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', spent: false, frozen: false, confirmations: { gt: 0 }, draftLock: null },
      _count: { id: true },
      _sum: { amount: true },
    });
    expect(prisma.uTXO.aggregate).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', spent: false, draftLock: { isNot: null } },
      _count: { id: true },
      _sum: { amount: true },
    });

    prisma.address.count.mockResolvedValueOnce(8).mockResolvedValueOnce(3).mockResolvedValueOnce(5);
    prisma.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: 1200n } });
    prisma.$queryRaw.mockResolvedValueOnce([{ used: true, balance: 900n }]);
    await expect(readRepository.getAddressSummary('wallet-1')).resolves.toEqual({
      totalCount: 8,
      usedCount: 3,
      unusedCount: 5,
      totalBalance: { _sum: { amount: 1200n } },
      usedBalances: [{ used: true, balance: 900n }],
    });
    expect(prisma.address.count).toHaveBeenCalledWith({ where: { walletId: 'wallet-1' } });

    prisma.address.findFirst.mockResolvedValueOnce(null);
    await expect(
      readRepository.findAddressDetail('wallet-1', { address: 'bc1qmissing' })
    ).resolves.toBeNull();

    prisma.address.findFirst.mockResolvedValueOnce({ id: 'addr-1', address: 'bc1qfound' });
    prisma.uTXO.aggregate.mockResolvedValueOnce({ _count: { id: 2 }, _sum: { amount: 500n } });
    await expect(
      readRepository.findAddressDetail('wallet-1', { addressId: 'addr-1' })
    ).resolves.toEqual({
      address: { id: 'addr-1', address: 'bc1qfound' },
      balance: { _count: { id: 2 }, _sum: { amount: 500n } },
    });
    expect(prisma.address.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { walletId: 'wallet-1', id: 'addr-1' },
    }));
    expect(prisma.uTXO.aggregate).toHaveBeenLastCalledWith({
      where: { walletId: 'wallet-1', address: 'bc1qfound', spent: false },
      _count: { id: true },
      _sum: { amount: true },
    });
  });
});
