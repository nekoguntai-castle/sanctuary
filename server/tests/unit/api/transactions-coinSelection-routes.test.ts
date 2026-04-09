import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const {
  mockSelectUtxos,
  mockCompareStrategies,
  mockGetRecommendedStrategy,
} = vi.hoisted(() => ({
  mockSelectUtxos: vi.fn(),
  mockCompareStrategies: vi.fn(),
  mockGetRecommendedStrategy: vi.fn(),
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

vi.mock('../../../src/services/utxoSelectionService', () => ({
  selectUtxos: mockSelectUtxos,
  compareStrategies: mockCompareStrategies,
  getRecommendedStrategy: mockGetRecommendedStrategy,
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
import coinSelectionRouter from '../../../src/api/transactions/coinSelection';

describe('Transactions Coin Selection Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', coinSelectionRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockSelectUtxos.mockResolvedValue({
      selected: [
        { id: 'utxo-1', txid: 'tx-1', vout: 0, amount: BigInt(2000), confirmations: 10 },
      ],
      totalAmount: BigInt(2000),
      estimatedFee: BigInt(120),
      changeAmount: BigInt(380),
      inputCount: 1,
      strategy: 'efficiency',
      warnings: [],
      privacyImpact: { score: 70, level: 'medium' },
    });

    mockCompareStrategies.mockResolvedValue({
      privacy: {
        selected: [{ id: 'utxo-p', txid: 'tx-p', vout: 1, amount: BigInt(3000) }],
        totalAmount: BigInt(3000),
        estimatedFee: BigInt(150),
        changeAmount: BigInt(850),
        inputCount: 1,
        strategy: 'privacy',
        warnings: ['Potential linkage reduced'],
        privacyImpact: { score: 90, level: 'high' },
      },
      efficiency: {
        selected: [{ id: 'utxo-e', txid: 'tx-e', vout: 0, amount: BigInt(2500) }],
        totalAmount: BigInt(2500),
        estimatedFee: BigInt(100),
        changeAmount: BigInt(400),
        inputCount: 1,
        strategy: 'efficiency',
        warnings: [],
        privacyImpact: { score: 50, level: 'low' },
      },
    });

    mockGetRecommendedStrategy.mockReturnValue({
      strategy: 'privacy',
      reason: 'Many UTXOs and high fee environment',
    });

    mockPrismaClient.uTXO.count.mockResolvedValue(12);
  });

  it('selects UTXOs and serializes bigint fields', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/select')
      .send({ amount: '1500', feeRate: '2.5', strategy: 'efficiency', scriptType: 'p2wpkh' });

    expect(response.status).toBe(200);
    expect(mockSelectUtxos).toHaveBeenCalledWith({
      walletId: 'wallet-1',
      targetAmount: BigInt('1500'),
      feeRate: 2.5,
      strategy: 'efficiency',
      scriptType: 'p2wpkh',
    });
    expect(response.body).toMatchObject({
      totalAmount: 2000,
      estimatedFee: 120,
      changeAmount: 380,
      inputCount: 1,
      strategy: 'efficiency',
      warnings: [],
      privacyImpact: { score: 70, level: 'medium' },
    });
    expect(response.body.selected[0].amount).toBe(2000);
  });

  it('returns 400 when amount or feeRate is missing on select', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/select')
      .send({ amount: '1500' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('amount and feeRate are required');
  });

  it('returns 400 when feeRate is invalid on select', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/select')
      .send({ amount: '1500', feeRate: '0' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('feeRate must be a positive number');
  });

  it('returns 400 for invalid select strategy', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/select')
      .send({ amount: '1500', feeRate: '1.1', strategy: 'random' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid strategy');
  });

  it('handles select service failures with api error handler', async () => {
    mockSelectUtxos.mockRejectedValue(new Error('selection failed'));

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/select')
      .send({ amount: '1500', feeRate: '1.1' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  it('compares selection strategies and serializes per-strategy results', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/compare-strategies')
      .send({ amount: '1750', feeRate: '4.2', scriptType: 'p2tr' });

    expect(response.status).toBe(200);
    expect(mockCompareStrategies).toHaveBeenCalledWith('wallet-1', BigInt('1750'), 4.2, 'p2tr');
    expect(response.body.privacy.totalAmount).toBe(3000);
    expect(response.body.efficiency.estimatedFee).toBe(100);
    expect(response.body.privacy.selected[0].amount).toBe(3000);
  });

  it('validates compare-strategies inputs', async () => {
    const missingResponse = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/compare-strategies')
      .send({ amount: '1750' });
    const feeRateResponse = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/compare-strategies')
      .send({ amount: '1750', feeRate: '-5' });

    expect(missingResponse.status).toBe(400);
    expect(feeRateResponse.status).toBe(400);
    expect(feeRateResponse.body.message).toBe('feeRate must be a positive number');
  });

  it('handles compare-strategies failures with api error handler', async () => {
    mockCompareStrategies.mockRejectedValue(new Error('compare failed'));

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/utxos/compare-strategies')
      .send({ amount: '1750', feeRate: '2.2' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('An unexpected error occurred');
  });

  it('returns recommended strategy with defaults and custom query flags', async () => {
    const defaultResponse = await request(app)
      .get('/api/v1/wallets/wallet-1/utxos/recommended-strategy');

    expect(defaultResponse.status).toBe(200);
    expect(mockPrismaClient.uTXO.count).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-1',
        spent: false,
        frozen: false,
      },
    });
    expect(mockGetRecommendedStrategy).toHaveBeenCalledWith(12, 10, false);
    expect(defaultResponse.body).toMatchObject({
      strategy: 'privacy',
      reason: 'Many UTXOs and high fee environment',
      utxoCount: 12,
      feeRate: 10,
    });

    const customResponse = await request(app)
      .get('/api/v1/wallets/wallet-1/utxos/recommended-strategy')
      .query({ feeRate: '22.5', prioritizePrivacy: 'true' });

    expect(customResponse.status).toBe(200);
    expect(mockGetRecommendedStrategy).toHaveBeenCalledWith(12, 22.5, true);
  });

  it('handles recommended strategy lookup failures', async () => {
    mockPrismaClient.uTXO.count.mockRejectedValue(new Error('count failed'));

    const response = await request(app)
      .get('/api/v1/wallets/wallet-1/utxos/recommended-strategy');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('An unexpected error occurred');
  });
});
