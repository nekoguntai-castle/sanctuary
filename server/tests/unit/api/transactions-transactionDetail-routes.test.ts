import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
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
import transactionDetailRouter from '../../../src/api/transactions/transactionDetail';

describe('Transactions Detail Routes', () => {
  let app: Express;

  beforeAll(() => {
    vi.stubGlobal('fetch', mockFetch as any);

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice' };
      next();
    });
    app.use('/api/v1', transactionDetailRouter);
    app.use(errorHandler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  it('returns raw transaction hex directly from database when available', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      rawTx: '020000000001deadbeef',
      wallet: { network: 'mainnet' },
    });

    const response = await request(app).get('/api/v1/transactions/tx-1/raw');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hex: '020000000001deadbeef' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches raw tx from mempool testnet endpoint when not stored in db', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      rawTx: null,
      wallet: { network: 'testnet' },
    });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '020000000001testnethex',
    });

    const response = await request(app).get('/api/v1/transactions/tx-test/raw');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mempool.space/testnet/api/tx/tx-test/hex',
      expect.any(Object)
    );
    expect(response.body).toEqual({ hex: '020000000001testnethex' });
  });

  it('defaults to mainnet endpoint and returns 404 when external lookup fails', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const response = await request(app).get('/api/v1/transactions/missing/raw');

    expect(response.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mempool.space/api/tx/missing/hex',
      expect.any(Object)
    );
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('returns 500 when raw transaction lookup throws', async () => {
    mockPrismaClient.transaction.findFirst.mockRejectedValue(new Error('db offline'));

    const response = await request(app).get('/api/v1/transactions/tx-err/raw');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns serialized transaction details with numeric bigint fields and labels', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      txid: 'tx-1',
      amount: BigInt(-12000),
      fee: BigInt(150),
      balanceAfter: BigInt(88000),
      blockHeight: BigInt(850100),
      wallet: {
        id: 'wallet-1',
        name: 'Main Wallet',
        type: 'watch-only',
      },
      address: {
        id: 'addr-1',
        address: 'tb1qexample',
      },
      transactionLabels: [
        { label: { id: 'label-1', name: 'Rent', color: '#f00' } },
        { label: { id: 'label-2', name: 'Bills', color: '#0f0' } },
      ],
      inputs: [
        { id: 'in-1', inputIndex: 0, amount: BigInt(12150) },
      ],
      outputs: [
        { id: 'out-1', outputIndex: 0, amount: BigInt(12000) },
        { id: 'out-2', outputIndex: 1, amount: BigInt(0) },
      ],
    });

    const response = await request(app).get('/api/v1/transactions/tx-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'tx-1',
      txid: 'tx-1',
      amount: -12000,
      fee: 150,
      balanceAfter: 88000,
      blockHeight: 850100,
      labels: [
        { id: 'label-1', name: 'Rent', color: '#f00' },
        { id: 'label-2', name: 'Bills', color: '#0f0' },
      ],
    });
    expect(response.body.inputs[0].amount).toBe(12150);
    expect(response.body.outputs[0].amount).toBe(12000);
  });

  it('preserves null fee, balanceAfter, and blockHeight during serialization', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      id: 'tx-null',
      txid: 'tx-null',
      amount: BigInt(5000),
      fee: null,
      balanceAfter: null,
      blockHeight: null,
      wallet: { id: 'wallet-1', name: 'Main Wallet', type: 'watch-only' },
      address: null,
      transactionLabels: [],
      inputs: [],
      outputs: [],
    });

    const response = await request(app).get('/api/v1/transactions/tx-null');

    expect(response.status).toBe(200);
    expect(response.body.fee).toBeNull();
    expect(response.body.balanceAfter).toBeNull();
    expect(response.body.blockHeight).toBeNull();
    expect(response.body.labels).toEqual([]);
  });

  it('returns 404 when transaction details are not found', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/transactions/missing');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('returns 500 when transaction detail lookup fails unexpectedly', async () => {
    mockPrismaClient.transaction.findFirst.mockRejectedValue(new Error('query failed'));

    const response = await request(app).get('/api/v1/transactions/tx-err');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
