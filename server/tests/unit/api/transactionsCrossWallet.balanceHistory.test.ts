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

describe('GET /transactions/balance-history', () => {
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

  it('GET /transactions/balance-history returns flat line when no wallets are accessible', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/transactions/balance-history')
      .query({ timeframe: '1W', totalBalance: '1000' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'Start', value: 1000, timestamp: expect.any(String) },
      { name: 'Now', value: 1000, timestamp: expect.any(String) },
    ]);
  });

  it('GET /transactions/balance-history reconstructs running balances from bucket deltas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-05T12:30:00.000Z'));
    try {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
      (mockPrismaClient as any).$queryRaw.mockResolvedValue([
        { bucket: new Date('2026-01-01T09:00:00.000Z'), amount: BigInt(100) },
        { bucket: new Date('2026-01-02T17:00:00.000Z'), amount: BigInt(-50) },
      ]);

      const response = await request(app)
        .get('/api/v1/transactions/balance-history')
        .query({ timeframe: '1W', totalBalance: '1000' });

      expect(response.status).toBe(200);
      // Each point is the balance AT its timestamp, so the client can place it
      // on a real time axis in the reader's own timezone. Server-rendered
      // labels (UTC, server locale, only for buckets that had activity) were
      // why the 1D/1W/1M axes showed no usable dates.
      expect(response.body).toEqual([
        { name: 'Start', value: 950, timestamp: '2025-12-29T12:30:00.000Z' },
        // Stamped at the bucket's END: the value is the balance once the
        // bucket settled, so stamping its start would show it an hour early.
        { name: '2026-01-01T10:00:00.000Z', value: 1050, timestamp: '2026-01-01T10:00:00.000Z' },
        { name: '2026-01-02T18:00:00.000Z', value: 1000, timestamp: '2026-01-02T18:00:00.000Z' },
        { name: 'Now', value: 1000, timestamp: '2026-01-05T12:30:00.000Z' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('GET /transactions/balance-history places a bucket that opened before the period after the opening point', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-05T12:30:00.000Z'));
    try {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
      // date_trunc('hour') of the first in-range row lands before startDate.
      (mockPrismaClient as any).$queryRaw.mockResolvedValue([
        { bucket: new Date('2026-01-04T12:00:00.000Z'), amount: BigInt(10) },
      ]);

      const response = await request(app)
        .get('/api/v1/transactions/balance-history')
        .query({ timeframe: '1D', totalBalance: '100' });

      expect(response.body.map((p: any) => p.timestamp)).toEqual([
        '2026-01-04T12:30:00.000Z',
        '2026-01-04T13:00:00.000Z',
        '2026-01-05T12:30:00.000Z',
      ]);
      expect(response.body.map((p: any) => p.value)).toEqual([90, 100, 100]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('GET /transactions/balance-history opens ALL at the first bucket rather than the epoch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-05T12:30:00.000Z'));
    try {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
      (mockPrismaClient as any).$queryRaw.mockResolvedValue([
        { bucket: new Date('2024-03-10T00:00:00.000Z'), amount: BigInt(500) },
      ]);

      const response = await request(app)
        .get('/api/v1/transactions/balance-history')
        .query({ timeframe: 'ALL', totalBalance: '500' });

      // The opening balance and the first deposit must not share an instant,
      // or a client holding the latest value at each time skips the opening.
      expect(response.body.slice(0, 2)).toEqual([
        { name: 'Start', value: 0, timestamp: '2024-03-10T00:00:00.000Z' },
        { name: '2024-03-11T00:00:00.000Z', value: 500, timestamp: '2024-03-11T00:00:00.000Z' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('GET /transactions/balance-history opens an empty ALL history at now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-05T12:30:00.000Z'));
    try {
      mockPrismaClient.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
      (mockPrismaClient as any).$queryRaw.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/transactions/balance-history')
        .query({ timeframe: 'ALL', totalBalance: '500' });

      expect(response.body.map((p: any) => p.timestamp)).toEqual([
        '2026-01-05T12:30:00.000Z',
        '2026-01-05T12:30:00.000Z',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('GET /transactions/balance-history defaults timeframe and totalBalance when omitted or invalid', async () => {
    mockPrismaClient.wallet.findMany.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/transactions/balance-history').query({ totalBalance: 'NaN' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { name: 'Start', value: 0, timestamp: expect.any(String) },
      { name: 'Now', value: 0, timestamp: expect.any(String) },
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
      { name: 'Start', value: 2500, timestamp: expect.any(String) },
      { name: 'Now', value: 2500, timestamp: expect.any(String) },
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
      { name: 'Start', value: 1500, timestamp: expect.any(String) },
      { name: 'Now', value: 1500, timestamp: expect.any(String) },
    ]);
  });

  it.each([
    // Hour and day buckets are fine enough for the client to regroup them
    // into the reader's local hours, days, weeks and months exactly.
    { timeframe: '1D', expectedUnit: 'hour', expectedDays: 1 },
    { timeframe: '1W', expectedUnit: 'hour', expectedDays: 7 },
    { timeframe: '1M', expectedUnit: 'hour', expectedDays: 30 },
    { timeframe: '1Y', expectedUnit: 'day', expectedDays: 365 },
    { timeframe: 'ALL', expectedUnit: 'day', expectedDays: null as number | null },
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

      // Opening point, the one bucket, and now.
      expect(response.body).toHaveLength(3);
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
});
