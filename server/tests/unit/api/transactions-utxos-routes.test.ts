import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const { mockCheckWalletAccess, mockGetParsed } = vi.hoisted(() => ({
  mockCheckWalletAccess: vi.fn(),
  mockGetParsed: vi.fn(),
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId;
    next();
  },
}));

vi.mock('../../../src/services/accessControl', () => ({
  checkWalletAccess: mockCheckWalletAccess,
}));

vi.mock('../../../src/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repositories')>();
  return {
    ...actual,
    systemSettingRepository: {
      ...actual.systemSettingRepository,
      getParsed: mockGetParsed,
    },
  };
});

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { errorHandler } from '../../../src/errors/errorHandler';
import utxosRouter from '../../../src/api/transactions/utxos';

describe('Transactions UTXO Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice' };
      next();
    });
    app.use('/api/v1', utxosRouter);
    app.use(errorHandler);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockCheckWalletAccess.mockResolvedValue({ canEdit: true });

    mockGetParsed.mockResolvedValue(2);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { amount: BigInt(0) },
    });
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);
  });

  it('lists unpaged UTXOs, applies default threshold fallback, and sets truncation headers', async () => {
    const txBlockTime = new Date('2025-01-03T00:00:00.000Z');
    const fallbackCreatedAt = new Date('2025-01-02T00:00:00.000Z');

    // getParsed returns the default value (3) for invalid input
    mockGetParsed.mockResolvedValue(3);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { amount: BigInt(1500) },
    });
    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      {
        id: 'utxo-1',
        txid: 'tx-1',
        vout: 0,
        walletId: 'wallet-1',
        amount: BigInt(1000),
        blockHeight: BigInt(850000),
        confirmations: 4,
        frozen: false,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        draftLock: null,
      },
      {
        id: 'utxo-2',
        txid: 'tx-2',
        vout: 1,
        walletId: 'wallet-1',
        amount: BigInt(500),
        blockHeight: null,
        confirmations: 2,
        frozen: false,
        createdAt: fallbackCreatedAt,
        draftLock: {
          draftId: 'draft-1',
          draft: { id: 'draft-1', label: 'Hold' },
        },
      },
    ] as any);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { txid: 'tx-1', blockTime: txBlockTime },
    ] as any);

    const response = await request(app).get('/api/v1/wallets/wallet-1/utxos');

    expect(response.status).toBe(200);
    expect(response.headers['x-result-limit']).toBe('1000');
    expect(response.headers['x-result-truncated']).toBe('false');
    expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1000,
        skip: 0,
      })
    );
    expect(response.body).toMatchObject({
      count: 2,
      totalBalance: 1500,
    });
    expect(response.body.utxos[0]).toMatchObject({
      id: 'utxo-1',
      amount: 1000,
      blockHeight: 850000,
      spendable: true,
      createdAt: txBlockTime.toISOString(),
    });
    expect(response.body.utxos[1]).toMatchObject({
      id: 'utxo-2',
      amount: 500,
      blockHeight: null,
      spendable: false,
      lockedByDraftId: 'draft-1',
      lockedByDraftLabel: 'Hold',
      createdAt: fallbackCreatedAt.toISOString(),
    });
  });

  it('uses explicit pagination params and omits unpaged response headers', async () => {
    mockGetParsed.mockResolvedValue(1);
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: { amount: BigInt(2500) },
    });
    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      {
        id: 'utxo-1',
        txid: 'tx-1',
        vout: 0,
        walletId: 'wallet-1',
        amount: BigInt(2500),
        blockHeight: BigInt(100),
        confirmations: 1,
        frozen: false,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        draftLock: null,
      },
    ] as any);

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/utxos')
      .query({ limit: '5', offset: '2' });

    expect(response.status).toBe(200);
    expect(response.headers['x-result-limit']).toBeUndefined();
    expect(response.headers['x-result-truncated']).toBeUndefined();
    expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        skip: 2,
      })
    );
  });

  it('marks unpaged responses as truncated when default limit is reached', async () => {
    const baseUtxo = {
      id: 'utxo',
      txid: 'tx-1',
      vout: 0,
      walletId: 'wallet-1',
      amount: BigInt(1),
      blockHeight: BigInt(1),
      confirmations: 10,
      frozen: false,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      draftLock: null,
    };
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({
      _count: { _all: 1000 },
      _sum: { amount: BigInt(1000) },
    });
    mockPrismaClient.uTXO.findMany.mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) => ({
        ...baseUtxo,
        id: `utxo-${index}`,
      })) as any
    );

    const response = await request(app).get('/api/v1/wallets/wallet-1/utxos');

    expect(response.status).toBe(200);
    expect(response.headers['x-result-truncated']).toBe('true');
    expect(response.body.utxos).toHaveLength(1000);
  });

  it('returns 500 when fetching UTXOs fails', async () => {
    mockPrismaClient.uTXO.aggregate.mockRejectedValue(new Error('db down'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/utxos');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('rejects freeze requests with non-boolean frozen value', async () => {
    const response = await request(app)
      .patch('/api/v1/utxos/utxo-1/freeze')
      .send({ frozen: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('frozen must be a boolean');
  });

  it('returns 404 when UTXO to freeze is not found', async () => {
    mockPrismaClient.uTXO.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .patch('/api/v1/utxos/missing/freeze')
      .send({ frozen: true });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('UTXO not found');
    expect(mockCheckWalletAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when user does not have edit access', async () => {
    mockPrismaClient.uTXO.findFirst.mockResolvedValue({
      id: 'utxo-1',
      walletId: 'wallet-1',
      txid: 'tx-1',
      vout: 0,
      wallet: { users: [{ userId: 'user-1' }] },
    } as any);
    mockCheckWalletAccess.mockResolvedValue({ canEdit: false });

    const response = await request(app)
      .patch('/api/v1/utxos/utxo-1/freeze')
      .send({ frozen: true });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('do not have permission');
  });

  it('freezes and unfreezes UTXOs when user has edit access', async () => {
    mockPrismaClient.uTXO.findFirst.mockResolvedValue({
      id: 'utxo-1',
      walletId: 'wallet-1',
      txid: 'tx-1',
      vout: 0,
      wallet: { users: [{ userId: 'user-1' }] },
    } as any);

    mockPrismaClient.uTXO.update
      .mockResolvedValueOnce({
        id: 'utxo-1',
        txid: 'tx-1',
        vout: 0,
        frozen: true,
      })
      .mockResolvedValueOnce({
        id: 'utxo-1',
        txid: 'tx-1',
        vout: 0,
        frozen: false,
      });

    const freezeResponse = await request(app)
      .patch('/api/v1/utxos/utxo-1/freeze')
      .send({ frozen: true });
    const unfreezeResponse = await request(app)
      .patch('/api/v1/utxos/utxo-1/freeze')
      .send({ frozen: false });

    expect(freezeResponse.status).toBe(200);
    expect(freezeResponse.body).toMatchObject({
      id: 'utxo-1',
      frozen: true,
      message: 'UTXO frozen successfully',
    });

    expect(unfreezeResponse.status).toBe(200);
    expect(unfreezeResponse.body).toMatchObject({
      id: 'utxo-1',
      frozen: false,
      message: 'UTXO unfrozen successfully',
    });
    expect(mockCheckWalletAccess).toHaveBeenCalledWith('wallet-1', 'user-1');
  });

  it('returns 500 when freezing UTXO fails unexpectedly', async () => {
    mockPrismaClient.uTXO.findFirst.mockRejectedValue(new Error('query failed'));

    const response = await request(app)
      .patch('/api/v1/utxos/utxo-1/freeze')
      .send({ frozen: true });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
