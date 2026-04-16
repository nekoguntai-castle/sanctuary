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
  uTXO: { aggregate: vi.fn(), findMany: vi.fn() },
  transaction: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn() },
  address: { findMany: vi.fn() },
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
});
