import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const {
  mockCalculateWalletPrivacy,
  mockCalculateUtxoPrivacy,
  mockCalculateSpendPrivacy,
  mockCheckWalletAccess,
} = vi.hoisted(() => ({
  mockCalculateWalletPrivacy: vi.fn(),
  mockCalculateUtxoPrivacy: vi.fn(),
  mockCalculateSpendPrivacy: vi.fn(),
  mockCheckWalletAccess: vi.fn(),
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

vi.mock('../../../src/services/privacyService', () => ({
  calculateWalletPrivacy: mockCalculateWalletPrivacy,
  calculateUtxoPrivacy: mockCalculateUtxoPrivacy,
  calculateSpendPrivacy: mockCalculateSpendPrivacy,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { errorHandler } from '../../../src/errors/errorHandler';
import privacyRouter from '../../../src/api/transactions/privacy';

describe('Transactions Privacy Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      if (req.headers['x-no-user'] !== 'true') {
        req.user = { userId: 'user-1', username: 'alice' };
      }
      next();
    });
    app.use('/api/v1', privacyRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockCalculateWalletPrivacy.mockResolvedValue({
      utxos: [
        { id: 'utxo-1', amount: BigInt(12000), score: 80 },
        { id: 'utxo-2', amount: BigInt(8000), score: 45 },
      ],
      summary: {
        averageScore: 62,
        highRiskCount: 1,
      },
    });

    mockCalculateUtxoPrivacy.mockResolvedValue({
      utxoId: 'utxo-1',
      score: 70,
      reasons: ['common-input-ownership'],
    });

    mockCalculateSpendPrivacy.mockResolvedValue({
      score: 50,
      warning: 'Spending together may link clusters',
    });

    mockCheckWalletAccess.mockResolvedValue({ hasAccess: true });

    mockPrismaClient.uTXO.findUnique.mockResolvedValue({ walletId: 'wallet-1' });
    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      { id: 'utxo-1' },
      { id: 'utxo-2' },
    ] as any);
  });

  it('returns wallet privacy analysis and serializes bigint utxo amounts', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/privacy');

    expect(response.status).toBe(200);
    expect(mockCalculateWalletPrivacy).toHaveBeenCalledWith('wallet-1');
    expect(response.body.summary).toEqual({ averageScore: 62, highRiskCount: 1 });
    expect(response.body.utxos[0].amount).toBe(12000);
    expect(response.body.utxos[1].amount).toBe(8000);
  });

  it('handles wallet privacy analysis failures', async () => {
    mockCalculateWalletPrivacy.mockRejectedValue(new Error('service unavailable'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/privacy');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 401 for utxo privacy lookup without authenticated user', async () => {
    const response = await request(app)
      .get('/api/v1/utxos/utxo-1/privacy')
      .set('x-no-user', 'true');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 404 when requested utxo privacy target does not exist', async () => {
    mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/utxos/missing/privacy');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when user lacks access to utxo wallet', async () => {
    mockCheckWalletAccess.mockResolvedValue({ hasAccess: false });

    const response = await request(app).get('/api/v1/utxos/utxo-1/privacy');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns single-utxo privacy score when access is granted', async () => {
    const response = await request(app).get('/api/v1/utxos/utxo-1/privacy');

    expect(response.status).toBe(200);
    expect(mockCheckWalletAccess).toHaveBeenCalledWith('wallet-1', 'user-1');
    expect(mockCalculateUtxoPrivacy).toHaveBeenCalledWith('utxo-1');
    expect(response.body).toMatchObject({
      utxoId: 'utxo-1',
      score: 70,
    });
  });

  it('handles unexpected single-utxo privacy errors', async () => {
    mockCalculateUtxoPrivacy.mockRejectedValue(new Error('compute failure'));

    const response = await request(app).get('/api/v1/utxos/utxo-1/privacy');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates spend-analysis utxoIds payload type', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/privacy/spend-analysis')
      .send({ utxoIds: 'not-an-array' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('utxoIds must be an array');
  });

  it('returns 400 when spend-analysis utxos do not all belong to wallet', async () => {
    mockPrismaClient.uTXO.count.mockResolvedValueOnce(1);

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/privacy/spend-analysis')
      .send({ utxoIds: ['utxo-1', 'utxo-2'] });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Some UTXOs not found');
  });

  it('analyzes spend privacy for wallet-owned utxos', async () => {
    mockPrismaClient.uTXO.count.mockResolvedValueOnce(2);

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/privacy/spend-analysis')
      .send({ utxoIds: ['utxo-1', 'utxo-2'] });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.uTXO.count).toHaveBeenCalledWith({
      where: {
        id: { in: ['utxo-1', 'utxo-2'] },
        walletId: 'wallet-1',
      },
    });
    expect(mockCalculateSpendPrivacy).toHaveBeenCalledWith(['utxo-1', 'utxo-2']);
    expect(response.body).toEqual({
      score: 50,
      warning: 'Spending together may link clusters',
    });
  });

  it('handles spend-analysis failures with api error response', async () => {
    mockPrismaClient.uTXO.count.mockRejectedValueOnce(new Error('db error'));

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/privacy/spend-analysis')
      .send({ utxoIds: ['utxo-1', 'utxo-2'] });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
