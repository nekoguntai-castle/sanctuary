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

const TXID_WITH_RAW = 'a'.repeat(64);
const TXID_TESTNET = 'b'.repeat(64);
const TXID_MISSING = 'c'.repeat(64);
const TXID_ERROR = 'd'.repeat(64);
const TXID_DETAIL = 'e'.repeat(64);
const TXID_NULL_FIELDS = 'f'.repeat(64);
const TXID_ZERO_FIELDS = '8'.repeat(64);

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
    mockPrismaClient.walletUser.findFirst.mockResolvedValue({
      id: 'wallet-user-1',
      walletId: 'wallet-1',
      userId: 'user-1',
      role: 'viewer',
    });
  });

  it('returns raw transaction hex directly from database when available', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([{
      id: 'tx-raw',
      walletId: 'wallet-1',
      rawTx: '020000000001deadbeef',
      wallet: { network: 'mainnet' },
    }]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_WITH_RAW}/raw`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hex: '020000000001deadbeef' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches raw tx from mempool testnet endpoint when not stored in db', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([{
      id: 'tx-testnet',
      walletId: 'wallet-1',
      rawTx: null,
      wallet: { network: 'testnet' },
    }]);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '020000000001testnethex',
    });

    const response = await request(app).get(`/api/v1/transactions/${TXID_TESTNET}/raw`);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://mempool.space/testnet/api/tx/${TXID_TESTNET}/hex`,
      expect.any(Object)
    );
    expect(response.body).toEqual({ hex: '020000000001testnethex' });
  });

  it('fetches regtest raw tx from the local-compatible mempool endpoint', async () => {
    const txid = '9'.repeat(64);
    mockPrismaClient.transaction.findMany.mockResolvedValue([{
      id: 'tx-regtest',
      walletId: 'wallet-1',
      rawTx: null,
      wallet: { network: 'regtest' },
    }]);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '020000000001regtesthex',
    });

    const response = await request(app).get(`/api/v1/transactions/${txid}/raw`);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://mempool.space/api/tx/${txid}/hex`,
      expect.any(Object)
    );
    expect(response.body).toEqual({ hex: '020000000001regtesthex' });
  });

  it('defaults to mainnet endpoint and returns 404 when external lookup fails', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const response = await request(app).get(`/api/v1/transactions/${TXID_MISSING}/raw`);

    expect(response.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledWith(
      `https://mempool.space/api/tx/${TXID_MISSING}/hex`,
      expect.any(Object)
    );
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('returns 500 when raw transaction lookup throws', async () => {
    mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('db offline'));

    const response = await request(app).get(`/api/v1/transactions/${TXID_ERROR}/raw`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('rejects malformed txids before external raw transaction lookup', async () => {
    const response = await request(app).get('/api/v1/transactions/not-a-txid/raw');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns serialized transaction details with numeric bigint fields and labels', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([{
      id: 'tx-1',
      walletId: 'wallet-1',
      txid: TXID_DETAIL,
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
    }]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_DETAIL}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'tx-1',
      txid: TXID_DETAIL,
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
    mockPrismaClient.transaction.findMany.mockResolvedValue([{
      id: 'tx-null',
      walletId: 'wallet-1',
      txid: TXID_NULL_FIELDS,
      amount: BigInt(5000),
      fee: null,
      balanceAfter: null,
      blockHeight: null,
      wallet: { id: 'wallet-1', name: 'Main Wallet', type: 'watch-only' },
      address: null,
      transactionLabels: [],
      inputs: [],
      outputs: [],
    }]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_NULL_FIELDS}`);

    expect(response.status).toBe(200);
    expect(response.body.fee).toBeNull();
    expect(response.body.balanceAfter).toBeNull();
    expect(response.body.blockHeight).toBeNull();
    expect(response.body.labels).toEqual([]);
  });

  it('preserves zero fee, balanceAfter, and blockHeight on legacy detail lookup', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([{
      id: 'tx-zero-legacy',
      walletId: 'wallet-1',
      txid: TXID_ZERO_FIELDS,
      amount: BigInt(0),
      fee: BigInt(0),
      balanceAfter: BigInt(0),
      blockHeight: BigInt(0),
      wallet: { id: 'wallet-1', name: 'Main Wallet', type: 'watch-only' },
      address: null,
      transactionLabels: [],
      inputs: [],
      outputs: [],
    }]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_ZERO_FIELDS}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      amount: 0,
      fee: 0,
      balanceAfter: 0,
      blockHeight: 0,
    });
  });

  it('returns 404 when transaction details are not found', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_MISSING}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('rejects malformed txids before transaction detail lookup', async () => {
    const response = await request(app).get('/api/v1/transactions/not-a-txid');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
  });

  it('returns 500 when transaction detail lookup fails unexpectedly', async () => {
    mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('query failed'));

    const response = await request(app).get(`/api/v1/transactions/${TXID_ERROR}`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns 409 without fetching bytes when legacy raw lookup is ambiguous', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'tx-a', walletId: 'wallet-1', rawTx: 'raw-a', wallet: { network: 'mainnet' } },
      { id: 'tx-b', walletId: 'wallet-2', rawTx: 'raw-b', wallet: { network: 'testnet4' } },
    ]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_WITH_RAW}/raw`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
    expect(response.body).not.toHaveProperty('hex');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 409 without transaction data when legacy detail lookup is ambiguous', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'tx-a', walletId: 'wallet-1' },
      { id: 'tx-b', walletId: 'wallet-2' },
    ]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_DETAIL}`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
    expect(response.body).not.toHaveProperty('txid');
  });

  it('adds deprecation headers to legacy success responses without changing JSON', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([{
      id: 'tx-raw',
      walletId: 'wallet-1',
      rawTx: '020000000001deadbeef',
      wallet: { network: 'mainnet' },
    }]);

    const response = await request(app).get(`/api/v1/transactions/${TXID_WITH_RAW}/raw`);

    expect(response.body).toEqual({ hex: '020000000001deadbeef' });
    expect(response.headers.deprecation).toBe('true');
    expect(response.headers.sunset).toBe('Sat, 31 Jul 2027 00:00:00 GMT');
    expect(response.headers.link).toContain(`/wallets/wallet-1/transactions/${TXID_WITH_RAW}/raw`);
  });

  it('returns wallet-scoped transaction detail and constrains the persisted lookup', async () => {
    mockPrismaClient.transaction.findUnique.mockResolvedValue({
      id: 'tx-scoped',
      txid: TXID_DETAIL,
      walletId: 'wallet-1',
      amount: BigInt(5000),
      fee: null,
      balanceAfter: null,
      blockHeight: null,
      wallet: { id: 'wallet-1', name: 'Wallet One', type: 'watch-only' },
      address: null,
      transactionLabels: [],
      inputs: [],
      outputs: [],
    });

    const response = await request(app)
      .get(`/api/v1/wallets/wallet-1/transactions/${TXID_DETAIL}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'tx-scoped', walletId: 'wallet-1' });
    expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { txid_walletId: { txid: TXID_DETAIL, walletId: 'wallet-1' } },
    }));
  });

  it('preserves zero fee, balanceAfter, and blockHeight on wallet-scoped detail lookup', async () => {
    mockPrismaClient.transaction.findUnique.mockResolvedValue({
      id: 'tx-zero-scoped',
      txid: TXID_ZERO_FIELDS,
      walletId: 'wallet-1',
      amount: BigInt(0),
      fee: BigInt(0),
      balanceAfter: BigInt(0),
      blockHeight: BigInt(0),
      wallet: { id: 'wallet-1', name: 'Wallet One', type: 'watch-only' },
      address: null,
      transactionLabels: [],
      inputs: [],
      outputs: [],
    });

    const response = await request(app)
      .get(`/api/v1/wallets/wallet-1/transactions/${TXID_ZERO_FIELDS}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      amount: 0,
      fee: 0,
      balanceAfter: 0,
      blockHeight: 0,
    });
  });

  it('returns 404 when a transaction is absent from the requested wallet', async () => {
    mockPrismaClient.transaction.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/v1/wallets/wallet-1/transactions/${TXID_MISSING}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('uses the authorized wallet network for scoped raw external fallback', async () => {
    mockPrismaClient.transaction.findUnique.mockResolvedValue(null);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet4' });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '020000000001scoped',
    });

    const response = await request(app)
      .get(`/api/v1/wallets/wallet-1/transactions/${TXID_TESTNET}/raw`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hex: '020000000001scoped' });
    expect(mockFetch).toHaveBeenCalledWith(
      `https://mempool.space/testnet4/api/tx/${TXID_TESTNET}/hex`,
      expect.any(Object),
    );
  });

  it('returns 404 when the authorized wallet disappears before scoped raw lookup', async () => {
    mockPrismaClient.transaction.findUnique.mockResolvedValue(null);
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/v1/wallets/wallet-1/transactions/${TXID_MISSING}/raw`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('denies scoped routes when the user lacks wallet view access', async () => {
    mockPrismaClient.walletUser.findFirst.mockResolvedValue(null);
    mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get(`/api/v1/wallets/wallet-denied/transactions/${TXID_DETAIL}`);

    expect(response.status).toBe(403);
    expect(mockPrismaClient.transaction.findUnique).not.toHaveBeenCalled();
  });
});
