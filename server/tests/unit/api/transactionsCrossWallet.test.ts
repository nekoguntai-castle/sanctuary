import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const mocks = vi.hoisted(() => ({
  getCachedBlockHeight: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
}));

// The activity summary is cached. Mocked so cases stay independent of one
// another, and so the caching itself can be asserted rather than assumed.
vi.mock('../../../src/services/cache', () => ({
  walletCache: {
    get: mocks.cacheGet,
    set: mocks.cacheSet,
  },
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: mocks.getCachedBlockHeight,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import crossWalletRouter from '../../../src/api/transactions/crossWallet';
import { errorHandler } from '../../../src/errors/errorHandler';

describe('transactions cross-wallet routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1' };
      next();
    });
    app.use('/api/v1', crossWalletRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mocks.getCachedBlockHeight.mockReturnValue(850000);
    mocks.cacheGet.mockResolvedValue(null);
    mocks.cacheSet.mockResolvedValue(undefined);
    (mockPrismaClient as any).$queryRaw = vi.fn().mockResolvedValue([]);
  });

  it('GET /transactions/recent returns empty array when user has no wallets', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/transactions/recent');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET /transactions/recent serializes transactions with dynamic confirmations and labels', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet', network: 'mainnet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        txid: 'a'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-12000),
        fee: BigInt(220),
        balanceAfter: BigInt(88000),
        blockHeight: BigInt(849990),
        confirmations: 0,
        blockTime: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        address: { address: 'bc1qdest', derivationPath: "m/84'/0'/0'/0/1" },
        transactionLabels: [{ label: { id: 'l1', name: 'Rent', color: '#f00' } }],
        rbfStatus: null,
      },
    ]);
    mocks.getCachedBlockHeight.mockReturnValue(850000);

    const response = await request(app).get('/api/v1/transactions/recent').query({ limit: '5' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      amount: -12000,
      fee: 220,
      balanceAfter: 88000,
      blockHeight: 849990,
      confirmations: 11,
      walletName: 'Main Wallet',
    });
    expect(response.body[0].labels).toEqual([{ id: 'l1', name: 'Rent', color: '#f00' }]);
  });

  it('GET /transactions/recent filters by requested wallet IDs and falls back to stored confirmations', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet', network: 'mainnet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-2',
        txid: 'd'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-5000),
        fee: BigInt(120),
        balanceAfter: BigInt(95000),
        blockHeight: BigInt(849995),
        confirmations: 6,
        blockTime: new Date('2026-01-02T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        address: null,
        transactionLabels: [],
        rbfStatus: null,
      },
      {
        id: 'tx-3',
        txid: 'e'.repeat(64),
        walletId: 'wallet-missing-network-map',
        type: 'received',
        amount: BigInt(2500),
        fee: BigInt(0),
        balanceAfter: BigInt(97500),
        blockHeight: BigInt(849996),
        confirmations: 9,
        blockTime: new Date('2026-01-03T00:00:00.000Z'),
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        address: null,
        transactionLabels: [],
        rbfStatus: null,
      },
    ]);
    mocks.getCachedBlockHeight.mockReturnValue(0);

    const response = await request(app)
      .get('/api/v1/transactions/recent')
      .query({ walletIds: 'wallet-1,wallet-2,,', limit: '3' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['wallet-1', 'wallet-2'] },
        }),
      })
    );
    expect(response.body[0].confirmations).toBe(6);
    expect(response.body[1].confirmations).toBe(9);
  });

  it('GET /transactions/recent returns zero confirmations for transactions without valid block height', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet', network: 'mainnet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-4',
        txid: 'f'.repeat(64),
        walletId: 'wallet-1',
        type: 'received',
        amount: BigInt(4000),
        fee: BigInt(0),
        balanceAfter: BigInt(104000),
        blockHeight: BigInt(0),
        confirmations: 11,
        blockTime: null,
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        address: null,
        transactionLabels: [],
        rbfStatus: null,
      },
    ]);
    mocks.getCachedBlockHeight.mockReturnValue(850000);

    const response = await request(app).get('/api/v1/transactions/recent');

    expect(response.status).toBe(200);
    expect(response.body[0].confirmations).toBe(0);
  });

  it('GET /transactions/pending returns mempool entries sorted by fee rate', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: 'b'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-5000),
        fee: BigInt(300),
        rawTx: 'aa'.repeat(120),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        txid: 'c'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-7000),
        fee: BigInt(100),
        rawTx: 'aa'.repeat(200),
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    ]);

    const response = await request(app).get('/api/v1/transactions/pending');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].txid).toBe('b'.repeat(64));
    expect(response.body[0].feeRate).toBeGreaterThan(response.body[1].feeRate);
  });

  it('GET /transactions/pending uses fee and size fallbacks for edge-case pending transactions', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: '7'.repeat(64),
        walletId: 'wallet-1',
        type: 'received',
        amount: BigInt(2000),
        fee: null,
        rawTx: null,
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
      },
      {
        txid: '8'.repeat(64),
        walletId: 'wallet-1',
        type: 'sent',
        amount: BigInt(-2000),
        fee: BigInt(500),
        rawTx: { length: -1 } as any,
        createdAt: new Date('2026-01-05T00:00:01.000Z'),
      },
    ]);

    const response = await request(app).get('/api/v1/transactions/pending');

    expect(response.status).toBe(200);
    const nullRawTx = response.body.find((tx: any) => tx.txid === '7'.repeat(64));
    const nonPositiveSize = response.body.find((tx: any) => tx.txid === '8'.repeat(64));

    expect(nullRawTx).toMatchObject({
      fee: 0,
      size: 200,
      feeRate: 0,
    });
    expect(nonPositiveSize).toMatchObject({
      fee: 500,
      size: 0,
      feeRate: 0,
    });
  });

  it('GET /transactions/pending returns empty array when no wallets are accessible', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/transactions/pending');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET /transactions/pending returns 500 on query failure', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet' },
    ]);
    mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('transaction query failed'));

    const response = await request(app).get('/api/v1/transactions/pending');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal',
    });
  });

  it('GET /transactions/balance-history returns flat line when no wallets are accessible', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1000' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'Start', value: 1000 },
      { name: 'Now', value: 1000 },
    ]);
  });

  it('GET /transactions/balance-history reconstructs running balances from bucket deltas', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    (mockPrismaClient as any).$queryRaw.mockResolvedValue([
      { bucket: new Date('2026-01-01T00:00:00.000Z'), amount: BigInt(100) },
      { bucket: new Date('2026-01-02T00:00:00.000Z'), amount: BigInt(-50) },
    ]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1000' });

    expect(response.status).toBe(200);
    expect(response.body.map((p: any) => p.value)).toEqual([950, 1050, 1000]);
  });

  it('GET /transactions/balance-history defaults timeframe and totalBalance when omitted or invalid', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/transactions/balance-history').query({ totalBalance: 'NaN' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'Start', value: 0 },
      { name: 'Now', value: 0 },
    ]);
  });

  it('GET /transactions/balance-history filters to requested wallet IDs', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-2' }]);
    (mockPrismaClient as any).$queryRaw.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ walletIds: 'wallet-2,wallet-3', totalBalance: '2500' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['wallet-2', 'wallet-3'] },
        }),
      })
    );
    expect(response.body).toEqual([
      { name: 'Start', value: 2500 },
      { name: 'Now', value: 2500 },
    ]);
  });

  it('GET /transactions/balance-history returns flat line when there are no bucketed deltas', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    (mockPrismaClient as any).$queryRaw.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1500' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'Start', value: 1500 },
      { name: 'Now', value: 1500 },
    ]);
  });

  it.each([
    { timeframe: '1D', expectedUnit: 'hour', expectedDays: 1 },
    { timeframe: '1M', expectedUnit: 'day', expectedDays: 30 },
    { timeframe: '1Y', expectedUnit: 'week', expectedDays: 365 },
    { timeframe: 'ALL', expectedUnit: 'month', expectedDays: null as number | null },
  ])(
    'GET /transactions/balance-history uses correct bucket config for $timeframe',
    async ({ timeframe, expectedUnit, expectedDays }) => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
      (mockPrismaClient as any).$queryRaw.mockResolvedValue([
        { bucket: new Date('2026-01-01T00:00:00.000Z'), amount: BigInt(0) },
      ]);

      const before = Date.now();
      const response = await request(app)
        .get('/api/v1/transactions/balance-history')
        .query({ timeframe, totalBalance: '2000' });
      const after = Date.now();

      expect(response.status).toBe(200);
      expect((mockPrismaClient as any).$queryRaw).toHaveBeenCalledTimes(1);

      // $queryRaw tagged template: first arg is TemplateStringsArray, rest are interpolated values
      const callArgs = (mockPrismaClient as any).$queryRaw.mock.calls[0];

      // date_trunc is now baked into the template string (no Prisma.raw())
      const templateStrings = callArgs[0] as TemplateStringsArray;
      const fullTemplate = templateStrings.join('?');
      expect(fullTemplate).toContain(`date_trunc('${expectedUnit}'`);

      // callArgs[1] is walletIds, callArgs[2] is startDate
      const startDate = callArgs[2] as Date;
      expect(startDate).toBeInstanceOf(Date);

      if (expectedDays === null) {
        expect(startDate.getTime()).toBe(0);
      } else {
        const expectedMs = expectedDays * 24 * 60 * 60 * 1000;
        expect(startDate.getTime()).toBeGreaterThanOrEqual(before - expectedMs - 1500);
        expect(startDate.getTime()).toBeLessThanOrEqual(after - expectedMs + 1500);
      }

      expect(response.body).toHaveLength(2);
    }
  );

  it('GET /transactions/balance-history returns 500 when aggregation query fails', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    (mockPrismaClient as any).$queryRaw.mockRejectedValue(new Error('aggregation failed'));

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1000' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal',
    });
  });

  it('GET /transactions/recent populates isFrozen and isLocked from UTXO state', async () => {
    const txid1 = 'a'.repeat(64);
    const txid2 = 'b'.repeat(64);

    mockPrismaClient.wallet.findMany.mockResolvedValue([
      { id: 'wallet-1', name: 'Main Wallet', network: 'mainnet' },
    ]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-frozen',
        txid: txid1,
        walletId: 'wallet-1',
        type: 'received',
        amount: BigInt(50000),
        fee: BigInt(0),
        balanceAfter: BigInt(50000),
        blockHeight: BigInt(849990),
        confirmations: 0,
        blockTime: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        address: null,
        transactionLabels: [],
        rbfStatus: null,
      },
      {
        id: 'tx-locked',
        txid: txid2,
        walletId: 'wallet-1',
        type: 'received',
        amount: BigInt(30000),
        fee: BigInt(0),
        balanceAfter: BigInt(80000),
        blockHeight: BigInt(849991),
        confirmations: 0,
        blockTime: new Date('2026-01-02T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        address: null,
        transactionLabels: [],
        rbfStatus: null,
      },
    ]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      {
        walletId: 'wallet-1',
        txid: txid1,
        frozen: true,
        draftLock: null,
      },
      {
        walletId: 'wallet-1',
        txid: txid2,
        frozen: false,
        draftLock: {
          draft: { label: 'Pending Send' },
        },
      },
    ]);
    mocks.getCachedBlockHeight.mockReturnValue(850000);

    const response = await request(app).get('/api/v1/transactions/recent');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);

    const frozenTx = response.body.find((tx: any) => tx.txid === txid1);
    const lockedTx = response.body.find((tx: any) => tx.txid === txid2);

    expect(frozenTx.isFrozen).toBe(true);
    expect(frozenTx.isLocked).toBe(false);

    expect(lockedTx.isFrozen).toBe(false);
    expect(lockedTx.isLocked).toBe(true);
    expect(lockedTx.lockedByDraftLabel).toBe('Pending Send');
  });

  describe('GET /transactions/recent paging', () => {
    const singleWallet = () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1', name: 'Main Wallet', network: 'mainnet' },
      ]);
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
    };

    const findManyArgs = () => mockPrismaClient.transaction.findMany.mock.calls[0][0];

    it('defaults to the first page', async () => {
      singleWallet();

      const response = await request(app).get('/api/v1/transactions/recent');

      expect(response.status).toBe(200);
      expect(findManyArgs()).toMatchObject({ take: 10, skip: 0 });
    });

    it('passes a requested offset through to the query', async () => {
      singleWallet();

      const response = await request(app)
        .get('/api/v1/transactions/recent')
        .query({ limit: '5', offset: '10' });

      expect(response.status).toBe(200);
      expect(findManyArgs()).toMatchObject({ take: 5, skip: 10 });
    });

    it('clamps a negative offset to the first page rather than erroring', async () => {
      singleWallet();

      const response = await request(app)
        .get('/api/v1/transactions/recent')
        .query({ offset: '-25' });

      expect(response.status).toBe(200);
      expect(findManyArgs()).toMatchObject({ skip: 0 });
    });

    it('falls back to the first page for a non-numeric offset', async () => {
      singleWallet();

      const response = await request(app)
        .get('/api/v1/transactions/recent')
        .query({ offset: 'not-a-number' });

      expect(response.status).toBe(200);
      expect(findManyArgs()).toMatchObject({ skip: 0 });
    });

    it('keeps the 50-row ceiling while paging', async () => {
      singleWallet();

      const response = await request(app)
        .get('/api/v1/transactions/recent')
        .query({ limit: '500', offset: '5' });

      expect(response.status).toBe(200);
      expect(findManyArgs()).toMatchObject({ take: 50, skip: 5 });
    });

    it('orders by a total key so paging cannot repeat or skip a row', async () => {
      singleWallet();

      await request(app).get('/api/v1/transactions/recent').query({ offset: '10' });

      // Without the trailing id, rows sharing blockTime and createdAt have no
      // defined relative order, and the same offset can return different rows
      // between requests.
      expect(findManyArgs().orderBy).toEqual([
        { blockTime: { sort: 'desc', nulls: 'first' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
    });

    it('returns a short final page without complaint', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1', name: 'Main Wallet', network: 'mainnet' },
      ]);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-last',
          txid: 'b'.repeat(64),
          walletId: 'wallet-1',
          type: 'received',
          amount: BigInt(5000),
          fee: BigInt(0),
          balanceAfter: BigInt(5000),
          blockHeight: BigInt(849999),
          confirmations: 0,
          blockTime: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          address: null,
          transactionLabels: [],
          rbfStatus: null,
        },
      ]);
      mocks.getCachedBlockHeight.mockReturnValue(850000);

      const response = await request(app)
        .get('/api/v1/transactions/recent')
        .query({ limit: '10', offset: '40' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    });

    it('applies the offset alongside a wallet filter', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-2', name: 'Second', network: 'mainnet' },
      ]);
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/transactions/recent')
        .query({ walletIds: 'wallet-2', offset: '3' });

      expect(response.status).toBe(200);
      expect(findManyArgs()).toMatchObject({
        skip: 3,
        where: expect.objectContaining({ walletId: { in: ['wallet-2'] } }),
      });
    });
  });

  it('returns 500 when wallet lookup fails for recent transactions', async () => {
    mockPrismaClient.wallet.findMany.mockRejectedValue(new Error('database down'));

    const response = await request(app).get('/api/v1/transactions/recent');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal',
    });
  });

  describe('GET /transactions/activity-summary', () => {
    const groupByArgs = () => (mockPrismaClient.transaction.groupBy as any).mock.calls[0][0];

    it('returns zeroes when the user has no wallets', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/transactions/activity-summary');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0, receivedSats: 0, sentSats: 0, latestAt: null });
      // No wallets means nothing to aggregate — don't touch the database.
      expect(mockPrismaClient.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('reports both directions as positive magnitudes without netting them', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([
        {
          type: 'received',
          _count: { id: 3 },
          _sum: { amount: BigInt(120_000) },
          _max: { blockTime: new Date('2026-08-01T10:00:00.000Z') },
        },
        {
          // Sends are stored negative; the summary reports the magnitude.
          type: 'sent',
          _count: { id: 2 },
          _sum: { amount: BigInt(-120_000) },
          _max: { blockTime: new Date('2026-08-03T12:00:00.000Z') },
        },
      ]);

      const response = await request(app).get('/api/v1/transactions/activity-summary');

      expect(response.status).toBe(200);
      // Equal in and out is five real transactions, not an empty period. A
      // single netted total would render this as zero.
      expect(response.body).toEqual({
        count: 5,
        receivedSats: 120_000,
        sentSats: 120_000,
        latestAt: '2026-08-03T12:00:00.000Z',
      });
    });

    it('counts types it does not attribute to a direction', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([
        {
          type: 'consolidation',
          _count: { id: 4 },
          _sum: { amount: BigInt(0) },
          _max: { blockTime: new Date('2026-08-02T00:00:00.000Z') },
        },
      ]);

      const response = await request(app).get('/api/v1/transactions/activity-summary');

      expect(response.body).toMatchObject({ count: 4, receivedSats: 0, sentSats: 0 });
    });

    it('handles a group with no rows and no block time', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([
        { type: 'received', _count: { id: 0 }, _sum: { amount: null }, _max: { blockTime: null } },
      ]);

      const response = await request(app).get('/api/v1/transactions/activity-summary');

      expect(response.body).toEqual({ count: 0, receivedSats: 0, sentSats: 0, latestAt: null });
    });

    it('excludes unconfirmed transactions, matching the balance-history filter', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app).get('/api/v1/transactions/activity-summary').query({ timeframe: '1M' });

      // Without this the summary would describe a different set of
      // transactions from the chart rendered directly above it.
      expect(groupByArgs().where.blockTime).toMatchObject({ not: null });
      expect(groupByArgs().where.blockTime.gte).toBeInstanceOf(Date);
    });

    it('aggregates only the wallets the user may access, not the ones requested', async () => {
      // The requested set and the authorized set must DIFFER, or the assertion
      // cannot tell "used the authorized wallets" from "used the raw query
      // param" — and the second of those is a total access-control bypass.
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-2' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app)
        .get('/api/v1/transactions/activity-summary')
        .query({ walletIds: 'wallet-2,wallet-belonging-to-someone-else' });

      expect(groupByArgs().where.walletId).toEqual({ in: ['wallet-2'] });

      // And the repository was asked to intersect the requested ids with the
      // caller's access clause, rather than trusting the ids outright.
      const walletQuery = (mockPrismaClient.wallet.findMany as any).mock.calls[0][0];
      expect(walletQuery.where.id).toEqual({
        in: ['wallet-2', 'wallet-belonging-to-someone-else'],
      });
      expect(walletQuery.where.OR).toBeDefined();
    });

    it('returns zeroes when every requested wallet belongs to someone else', async () => {
      // The repository returns nothing because the access clause filtered them
      // all out. Indistinguishable from "no such wallet", which is correct —
      // an error here would be an existence oracle.
      mockPrismaClient.wallet.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/transactions/activity-summary')
        .query({ walletIds: 'someone-elses-wallet' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0, receivedSats: 0, sentSats: 0, latestAt: null });
      expect(mockPrismaClient.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('keys the cache per user so one caller cannot read totals belonging to another', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app).get('/api/v1/transactions/activity-summary');

      // The user segment is what makes the shared cache tenant-safe; a
      // stringContaining check on the suffix alone would not notice it going
      // missing.
      expect(mocks.cacheGet).toHaveBeenCalledWith(
        expect.stringMatching(/^activity-summary:user-1:/)
      );
    });

    it('falls back to the default period for an unrecognised timeframe', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app)
        .get('/api/v1/transactions/activity-summary')
        .query({ timeframe: 'not-a-timeframe' });

      // Unvalidated, this fell through to epoch and returned all-time figures
      // under a one-week label — and minted a cache key from caller-controlled
      // input, letting an attacker churn a shared, size-capped cache.
      expect(mocks.cacheGet).toHaveBeenCalledWith(expect.stringContaining(':1W:'));
      const start = groupByArgs().where.blockTime.gte as Date;
      expect(start.getTime()).toBeGreaterThan(new Date(0).getTime());
    });

    it('still answers when the cache is unavailable', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);
      mocks.cacheGet.mockRejectedValue(new Error('cache down'));
      mocks.cacheSet.mockRejectedValue(new Error('cache down'));

      const response = await request(app).get('/api/v1/transactions/activity-summary');

      // A cache fault must not take down a read endpoint that does not need
      // the cache to answer correctly.
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0, receivedSats: 0, sentSats: 0, latestAt: null });
    });

    it('narrows the window for a shorter timeframe', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app).get('/api/v1/transactions/activity-summary').query({ timeframe: '1D' });
      const dayStart = groupByArgs().where.blockTime.gte as Date;

      (mockPrismaClient.transaction.groupBy as any).mockClear();
      await request(app).get('/api/v1/transactions/activity-summary').query({ timeframe: '1Y' });
      const yearStart = groupByArgs().where.blockTime.gte as Date;

      expect(dayStart.getTime()).toBeGreaterThan(yearStart.getTime());
    });

    it('serves a cached summary without re-aggregating', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      mocks.cacheGet.mockResolvedValue({
        count: 7,
        receivedSats: 1,
        sentSats: 2,
        latestAt: null,
      });

      const response = await request(app).get('/api/v1/transactions/activity-summary');

      expect(response.body).toMatchObject({ count: 7 });
      expect(mockPrismaClient.transaction.groupBy).not.toHaveBeenCalled();
    });

    it('caches a freshly computed summary', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app).get('/api/v1/transactions/activity-summary');

      expect(mocks.cacheSet).toHaveBeenCalledWith(
        expect.stringContaining('activity-summary:user-1:1W:'),
        expect.objectContaining({ count: 0 }),
        30
      );
    });

    it('keys the cache on the wallet set regardless of the order given', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-b' },
        { id: 'wallet-a' },
      ] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app)
        .get('/api/v1/transactions/activity-summary')
        .query({ walletIds: 'wallet-b,wallet-a' });

      expect(mocks.cacheGet).toHaveBeenCalledWith(expect.stringContaining('wallet-a,wallet-b'));
    });

    it('treats an all-empty walletIds list as no filter at all', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      await request(app).get('/api/v1/transactions/activity-summary').query({ walletIds: ',,,' });

      // Filtering to nothing must mean "every accessible wallet", not "an
      // empty id filter" — the latter would silently return zeroes.
      const walletQuery = (mockPrismaClient.wallet.findMany as any).mock.calls[0][0];
      expect(walletQuery.where.id).toBeUndefined();
    });

    it('caps how many wallet ids one request may name', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockResolvedValue([]);

      const ids = Array.from({ length: 500 }, (_, i) => `w-${i}`).join(',');
      await request(app).get('/api/v1/transactions/activity-summary').query({ walletIds: ids });

      // Unbounded, this list flows into a Prisma `in` clause and into the
      // cache key, letting one request build an arbitrarily large query.
      const walletQuery = (mockPrismaClient.wallet.findMany as any).mock.calls[0][0];
      expect(walletQuery.where.id.in.length).toBe(200);
    });

    it('returns 500 when the aggregate fails', async () => {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }] as any);
      (mockPrismaClient.transaction.groupBy as any).mockRejectedValue(new Error('database down'));

      const response = await request(app).get('/api/v1/transactions/activity-summary');

      expect(response.status).toBe(500);
    });
  });
});
