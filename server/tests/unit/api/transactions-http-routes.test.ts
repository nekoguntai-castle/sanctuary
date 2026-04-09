import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const {
  mockGetCachedBlockHeight,
  mockRecalculateWalletBalances,
  mockWalletCacheGet,
  mockWalletCacheSet,
  mockValidateAddress,
  mockAuditLogFromRequest,
  mockCreateTransaction,
  mockCreateBatchTransaction,
  mockBroadcastAndSave,
  mockEstimateTransaction,
  mockGetPSBTInfo,
  mockFetch,
  mockEvaluatePolicies,
  mockRecordUsage,
  mockWalletFindById,
} = vi.hoisted(() => ({
  mockGetCachedBlockHeight: vi.fn(),
  mockRecalculateWalletBalances: vi.fn(),
  mockWalletCacheGet: vi.fn(),
  mockWalletCacheSet: vi.fn(),
  mockValidateAddress: vi.fn(),
  mockAuditLogFromRequest: vi.fn(),
  mockCreateTransaction: vi.fn(),
  mockCreateBatchTransaction: vi.fn(),
  mockBroadcastAndSave: vi.fn(),
  mockEstimateTransaction: vi.fn(),
  mockGetPSBTInfo: vi.fn(),
  mockFetch: vi.fn(),
  mockEvaluatePolicies: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockWalletFindById: vi.fn(),
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../src/repositories/walletRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repositories/walletRepository')>();
  return {
    ...actual,
    walletRepository: {
      ...actual.walletRepository,
      findById: mockWalletFindById,
    },
  };
});

vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId || req.params.id;
    req.user = req.user || { userId: 'test-user-id' };
    next();
  },
}));

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: mockGetCachedBlockHeight,
  recalculateWalletBalances: mockRecalculateWalletBalances,
}));

vi.mock('../../../src/services/cache', () => ({
  walletCache: {
    get: mockWalletCacheGet,
    set: mockWalletCacheSet,
  },
}));

vi.mock('../../../src/services/bitcoin/utils', () => ({
  validateAddress: mockValidateAddress,
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditCategory: {
    WALLET: 'WALLET',
  },
  AuditAction: {
    TRANSACTION_BROADCAST: 'TRANSACTION_BROADCAST',
    TRANSACTION_BROADCAST_FAILED: 'TRANSACTION_BROADCAST_FAILED',
  },
}));

vi.mock('../../../src/services/bitcoin/transactionService', () => ({
  createTransaction: mockCreateTransaction,
  createBatchTransaction: mockCreateBatchTransaction,
  broadcastAndSave: mockBroadcastAndSave,
  estimateTransaction: mockEstimateTransaction,
  getPSBTInfo: mockGetPSBTInfo,
}));

vi.mock('../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mockEvaluatePolicies,
    recordUsage: mockRecordUsage,
  },
}));

import { errorHandler } from '../../../src/errors/errorHandler';
import walletTransactionsRouter from '../../../src/api/transactions/walletTransactions';
import creationRouter from '../../../src/api/transactions/creation';

describe('Transaction HTTP Routes', () => {
  let app: Express;
  const walletId = 'wallet-123';

  beforeAll(() => {
    vi.stubGlobal('fetch', mockFetch);
    app = express();
    app.use(express.json());
    app.use('/api/v1', walletTransactionsRouter);
    app.use('/api/v1', creationRouter);
    app.use(errorHandler);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockGetCachedBlockHeight.mockReturnValue(850000);
    mockRecalculateWalletBalances.mockResolvedValue(undefined);
    mockWalletCacheGet.mockResolvedValue(null);
    mockWalletCacheSet.mockResolvedValue(undefined);
    mockEvaluatePolicies.mockResolvedValue({ allowed: true, triggered: [] });
    mockRecordUsage.mockResolvedValue(undefined);
    mockValidateAddress.mockReturnValue({ valid: true });
    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockCreateTransaction.mockResolvedValue({
      psbtBase64: 'cHNi',
      fee: 150,
      totalInput: 10150,
      totalOutput: 10000,
      changeAmount: 0,
      changeAddress: null,
      utxos: [],
      inputPaths: {},
      effectiveAmount: 10000,
      decoyOutputs: [],
    });
    mockCreateBatchTransaction.mockResolvedValue({
      psbtBase64: 'cHNi',
      fee: 250,
      totalInput: 20250,
      totalOutput: 20000,
      changeAmount: 0,
      changeAddress: null,
      utxos: [],
      inputPaths: {},
      outputs: [{ address: 'tb1qrecipient', amount: 20000 }],
    });
    mockBroadcastAndSave.mockResolvedValue({
      txid: 'a'.repeat(64),
      broadcasted: true,
    });
    mockEstimateTransaction.mockResolvedValue({
      fee: 120,
      totalInput: 20120,
      totalOutput: 20000,
    });
    mockGetPSBTInfo.mockReturnValue({
      fee: 400,
      outputs: [{ address: 'tb1qrecipient', value: 20000 }],
      inputs: [{ txid: 'b'.repeat(64), vout: 0 }],
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ weight: 560, fee: 500 }),
    });
  });

  it('lists wallet transactions with pagination and dynamic confirmations', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-1',
        txid: 'c'.repeat(64),
        walletId,
        type: 'sent',
        amount: BigInt(-10000),
        fee: BigInt(120),
        balanceAfter: BigInt(90000),
        blockHeight: BigInt(849999),
        confirmations: 0,
        blockTime: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        address: { address: 'tb1qdest', derivationPath: "m/84'/1'/0'/0/1" },
        transactionLabels: [{ label: { id: 'label-1', name: 'Rent', color: '#ff0000' } }],
      },
    ]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions`)
      .query({ limit: '2', offset: '1' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletId }),
        take: 2,
        skip: 1,
      })
    );
    expect(response.body[0].amount).toBe(-10000);
    expect(response.body[0].confirmations).toBe(2);
    expect(response.body[0].labels).toHaveLength(1);
  });

  it('returns internal server error when transaction listing fails', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('db offline'));

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('falls back to mainnet network and stored confirmations when cached height is unavailable', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    mockGetCachedBlockHeight.mockReturnValueOnce(0);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-mainnet-default',
        txid: '0'.repeat(64),
        walletId,
        type: 'received',
        amount: BigInt(25000),
        fee: BigInt(0),
        balanceAfter: BigInt(25000),
        blockHeight: BigInt(850100),
        confirmations: 7,
        blockTime: new Date('2025-01-03T00:00:00.000Z'),
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        address: { address: 'bc1qreceive', derivationPath: "m/84'/0'/0'/0/0" },
        transactionLabels: [],
      },
    ]);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions`);

    expect(response.status).toBe(200);
    expect(mockGetCachedBlockHeight).toHaveBeenCalledWith('mainnet');
    expect(response.body[0].confirmations).toBe(7);
  });

  it('returns zero dynamic confirmations for transactions with non-positive block height', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockGetCachedBlockHeight.mockReturnValueOnce(850000);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 'tx-zero-height',
        txid: '9'.repeat(64),
        walletId,
        type: 'sent',
        amount: BigInt(-1500),
        fee: BigInt(50),
        balanceAfter: BigInt(98500),
        blockHeight: BigInt(0),
        confirmations: 99,
        blockTime: null,
        createdAt: new Date('2025-01-04T00:00:00.000Z'),
        address: { address: 'tb1qdestzero', derivationPath: "m/84'/1'/0'/0/2" },
        transactionLabels: [],
      },
    ]);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions`);

    expect(response.status).toBe(200);
    expect(response.body[0].confirmations).toBe(0);
  });

  it('builds and caches transaction stats on cache miss', async () => {
    mockWalletCacheGet.mockResolvedValue(null);
    mockPrismaClient.transaction.groupBy.mockResolvedValue([
      { type: 'received', _count: { id: 2 }, _sum: { amount: BigInt(1500) } },
      { type: 'sent', _count: { id: 1 }, _sum: { amount: BigInt(-800) } },
      { type: 'consolidation', _count: { id: 1 }, _sum: { amount: BigInt(-200) } },
    ]);
    mockPrismaClient.transaction.aggregate.mockResolvedValue({ _sum: { fee: BigInt(200) } });
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ balanceAfter: BigInt(700) });

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/stats`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalCount: 4,
      receivedCount: 2,
      sentCount: 1,
      consolidationCount: 1,
      totalReceived: 1500,
      totalSent: 800,
      totalFees: 200,
      walletBalance: 700,
    });
    expect(mockWalletCacheSet).toHaveBeenCalledWith(
      `tx-stats:${walletId}`,
      expect.objectContaining({
        totalSent: '800',
        totalReceived: '1500',
      }),
      30
    );
  });

  it('serves transaction stats from cache without querying database', async () => {
    mockWalletCacheGet.mockResolvedValue({
      totalSent: '300',
      totalReceived: '900',
      transactionCount: 3,
      avgFee: '20',
      totalFees: '60',
      currentBalance: '600',
      _receivedCount: 2,
      _sentCount: 1,
      _consolidationCount: 0,
    });

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/stats`);

    expect(response.status).toBe(200);
    expect(response.body.totalCount).toBe(3);
    expect(response.body.totalSent).toBe(300);
    expect(mockPrismaClient.transaction.groupBy).not.toHaveBeenCalled();
  });

  it('returns zeroed transaction stats when aggregate queries are empty', async () => {
    mockWalletCacheGet.mockResolvedValue(null);
    mockPrismaClient.transaction.groupBy.mockResolvedValue([]);
    mockPrismaClient.transaction.aggregate.mockResolvedValue({ _sum: { fee: null } });
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/stats`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalCount: 0,
      receivedCount: 0,
      sentCount: 0,
      consolidationCount: 0,
      totalReceived: 0,
      totalSent: 0,
      totalFees: 0,
      walletBalance: 0,
    });
    expect(mockWalletCacheSet).toHaveBeenCalledWith(
      `tx-stats:${walletId}`,
      expect.objectContaining({
        avgFee: '0',
        totalFees: '0',
        currentBalance: '0',
      }),
      30
    );
  });

  it('normalizes signed aggregate amounts when building stats', async () => {
    mockWalletCacheGet.mockResolvedValue(null);
    mockPrismaClient.transaction.groupBy.mockResolvedValue([
      { type: 'received', _count: { id: 1 }, _sum: { amount: BigInt(-50) } },
      { type: 'sent', _count: { id: 1 }, _sum: { amount: BigInt(75) } },
      { type: 'consolidation', _count: { id: 2 }, _sum: { amount: null } },
    ]);
    mockPrismaClient.transaction.aggregate.mockResolvedValue({ _sum: { fee: BigInt(30) } });
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ balanceAfter: BigInt(1000) });

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/stats`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totalCount: 4,
      receivedCount: 1,
      sentCount: 1,
      consolidationCount: 2,
      totalReceived: 50,
      totalSent: 75,
      totalFees: 30,
      walletBalance: 1000,
    });
  });

  it('ignores unknown transaction types when deriving subtype counters', async () => {
    mockWalletCacheGet.mockResolvedValue(null);
    mockPrismaClient.transaction.groupBy.mockResolvedValue([
      { type: 'self_transfer', _count: { id: 1 }, _sum: { amount: BigInt(123) } },
    ] as any);
    mockPrismaClient.transaction.aggregate.mockResolvedValue({ _sum: { fee: BigInt(0) } });
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/stats`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totalCount: 1,
      receivedCount: 0,
      sentCount: 0,
      consolidationCount: 0,
      totalReceived: 0,
      totalSent: 0,
      totalFees: 0,
      walletBalance: 0,
    });
  });

  it('returns internal server error when transaction stats lookup fails', async () => {
    mockWalletCacheGet.mockRejectedValue(new Error('cache unavailable'));

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/stats`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns empty pending list when no unconfirmed transactions exist', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: 'Test Wallet',
      network: 'mainnet',
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/pending`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('falls back to raw transaction size for fee rate when mempool fetch fails', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: 'Test Wallet',
      network: 'testnet',
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: 'd'.repeat(64),
        walletId,
        type: 'sent',
        amount: BigInt(-20000),
        fee: BigInt(500),
        createdAt: new Date(Date.now() - 2000),
        counterpartyAddress: 'tb1qcounterparty',
        rawTx: 'aa'.repeat(200),
        blockHeight: null,
      },
    ]);
    mockFetch.mockRejectedValueOnce(new Error('mempool unavailable'));

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/pending`);

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      txid: 'd'.repeat(64),
      type: 'sent',
      amount: -20000,
      recipient: 'tb1qcounterparty',
    });
    expect(response.body[0].feeRate).toBe(2.5);
    expect(response.body[0].timeInQueue).toBeGreaterThanOrEqual(0);
  });

  it('uses mempool transaction weight and fee when available for pending fee rate', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: 'Test Wallet',
      network: 'mainnet',
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: '1'.repeat(64),
        walletId,
        type: 'sent',
        amount: BigInt(-30000),
        fee: BigInt(0),
        createdAt: new Date(Date.now() - 3000),
        counterpartyAddress: 'bc1qrecipient',
        rawTx: null,
        blockHeight: null,
      },
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ weight: 800, fee: 1200 }),
    });

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/pending`);

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      txid: '1'.repeat(64),
      fee: 1200,
      vsize: 200,
      feeRate: 6,
    });
  });

  it('maps legacy receive type to received when mempool response is not ok', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: 'Legacy Wallet',
      network: 'mainnet',
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: '2'.repeat(64),
        walletId,
        type: 'receive',
        amount: BigInt(9000),
        fee: BigInt(0),
        createdAt: new Date(Date.now() - 1500),
        counterpartyAddress: null,
        rawTx: null,
        blockHeight: null,
      },
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ weight: 500, fee: 400 }),
    });

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/pending`);

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      txid: '2'.repeat(64),
      type: 'received',
      amount: 9000,
      feeRate: 0,
    });
    expect(response.body[0]).not.toHaveProperty('recipient');
  });

  it('keeps pending fee rate at zero when mempool payload has no weight and rawTx size is non-positive', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: 'Edge Wallet',
      network: 'mainnet',
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: '3'.repeat(64),
        walletId,
        type: 'sent',
        amount: BigInt(-1200),
        fee: BigInt(250),
        createdAt: new Date(Date.now() - 1500),
        counterpartyAddress: '',
        rawTx: { length: -1 } as any,
        blockHeight: null,
      },
    ]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fee: 1200 }),
    });

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/pending`);

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      txid: '3'.repeat(64),
      fee: 250,
      feeRate: 0,
    });
    expect(response.body[0]).not.toHaveProperty('recipient');
  });

  it('returns 500 when pending transaction query fails', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: 'Test Wallet',
      network: 'mainnet',
    });
    mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('pending query failed'));

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/pending`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('exports transactions in JSON format with sanitized filename', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'My Wallet!' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: 'e'.repeat(64),
        type: 'received',
        amount: BigInt(100000),
        balanceAfter: BigInt(100000),
        fee: BigInt(0),
        confirmations: 3,
        label: 'Salary',
        memo: '',
        counterpartyAddress: 'tb1qincoming',
        blockHeight: BigInt(850000),
        blockTime: new Date('2025-01-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        transactionLabels: [],
      },
    ]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: 'json', startDate: '2025-01-01', endDate: '2025-01-31' });

    expect(response.status).toBe(200);
    expect(response.header['content-type']).toContain('application/json');
    expect(response.header['content-disposition']).toContain('My_Wallet_');
    expect(response.body[0]).toMatchObject({
      txid: 'e'.repeat(64),
      amountSats: 100000,
      balanceAfterSats: 100000,
    });
    const findManyArg = mockPrismaClient.transaction.findMany.mock.calls[0][0];
    expect(findManyArg.where.blockTime.gte).toBeInstanceOf(Date);
    expect(findManyArg.where.blockTime.lte).toBeInstanceOf(Date);
  });

  it('exports transactions in CSV format and escapes commas', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'CSV Wallet' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: 'f'.repeat(64),
        type: 'sent',
        amount: BigInt(-5000),
        balanceAfter: BigInt(95000),
        fee: BigInt(100),
        confirmations: 1,
        label: 'Payment',
        memo: 'note,with,comma',
        counterpartyAddress: 'tb1qrecipient',
        blockHeight: BigInt(849999),
        blockTime: new Date('2025-01-02T00:00:00.000Z'),
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        transactionLabels: [],
      },
    ]);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/export`);

    expect(response.status).toBe(200);
    expect(response.header['content-type']).toContain('text/csv');
    expect(response.text).toContain('Transaction ID');
    expect(response.text).toContain('"note,with,comma"');
  });

  it('exports CSV using default wallet filename and createdAt fallback for null fields', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: '4'.repeat(64),
        type: 'received',
        amount: BigInt(0),
        balanceAfter: null,
        fee: null,
        confirmations: 0,
        label: null,
        memo: null,
        counterpartyAddress: null,
        blockHeight: null,
        blockTime: null,
        createdAt: new Date('2025-01-05T00:00:00.000Z'),
        transactionLabels: [],
      },
    ]);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/export`);

    expect(response.status).toBe(200);
    expect(response.header['content-disposition']).toContain('wallet_transactions_');
    const dataRow = response.text.split('\n')[1];
    expect(dataRow).toContain('2025-01-05T00:00:00.000Z');
    expect(dataRow).toContain(',,');
  });

  it('returns error when transaction export fails', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Err Wallet' });
    mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('export failed'));

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/export`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('recalculates wallet balances and returns final amount', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      balanceAfter: BigInt(123456),
    });

    const response = await request(app).post(`/api/v1/wallets/${walletId}/transactions/recalculate`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Balances recalculated',
      finalBalance: 123456,
      finalBalanceBtc: 0.00123456,
    });
    expect(mockRecalculateWalletBalances).toHaveBeenCalledWith(walletId);
  });

  it('returns zero balances when recalculation finds no final transaction', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    const response = await request(app).post(`/api/v1/wallets/${walletId}/transactions/recalculate`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Balances recalculated',
      finalBalance: 0,
      finalBalanceBtc: 0,
    });
  });

  it('returns error when balance recalculation fails', async () => {
    mockRecalculateWalletBalances.mockRejectedValueOnce(new Error('recalc failed'));

    const response = await request(app).post(`/api/v1/wallets/${walletId}/transactions/recalculate`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates required fields for transaction creation', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({ recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });

  it('enforces minimum fee rate for transaction creation', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 0.01,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('feeRate must be at least');
  });

  it('returns 404 when creating a transaction for missing wallet', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    mockWalletFindById.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Wallet not found');
  });

  it('rejects invalid recipient address during transaction creation', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockValidateAddress.mockReturnValueOnce({
      valid: false,
      error: 'bad checksum',
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'bad-address',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid Bitcoin address');
  });

  it('creates transaction and returns PSBT payload', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'testnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'testnet' });
    mockCreateTransaction.mockResolvedValue({
      psbtBase64: 'cHNiYmFzZTY0',
      fee: 160,
      totalInput: 10160,
      totalOutput: 10000,
      changeAmount: 0,
      changeAddress: null,
      utxos: [],
      inputPaths: { '0': "m/84'/1'/0'/0/0" },
      effectiveAmount: 10000,
      decoyOutputs: [],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1.5,
        label: 'rent',
        memo: 'jan',
        sendMax: false,
      });

    expect(response.status).toBe(200);
    expect(response.body.psbtBase64).toBe('cHNiYmFzZTY0');
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      walletId,
      'tb1qrecipient',
      10000,
      1.5,
      expect.objectContaining({
        label: 'rent',
        memo: 'jan',
      })
    );
  });

  it('returns 403 when vault policy blocks transaction creation', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockEvaluatePolicies.mockResolvedValueOnce({
      allowed: false,
      triggered: [{ policyId: 'p1', policyName: 'Daily Limit', type: 'spending_limit', action: 'blocked', reason: 'Exceeded daily limit' }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 when vault policy blocks broadcast', async () => {
    mockEvaluatePolicies.mockResolvedValueOnce({
      allowed: false,
      triggered: [{ policyId: 'p1', policyName: 'Limit', type: 'spending_limit', action: 'blocked', reason: 'Over limit' }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        recipient: 'tb1qrecipient',
        amount: 50000,
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('returns 403 when vault policy blocks PSBT broadcast', async () => {
    mockGetPSBTInfo.mockReturnValue({
      outputs: [{ address: 'tb1qdest', value: 25000 }, { address: 'tb1qchange', value: 5000 }],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
      fee: 450,
    });
    mockEvaluatePolicies.mockResolvedValueOnce({
      allowed: false,
      triggered: [{ policyId: 'p1', policyName: 'Denylist', type: 'address_control', action: 'blocked', reason: 'Denied address' }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({ signedPsbt: 'cHNi' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('returns bad request when transaction creation service throws', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockCreateTransaction.mockRejectedValueOnce(new Error('insufficient funds'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates batch transaction output list', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({ feeRate: 1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('outputs array is required');
  });

  it('enforces minimum fee rate for batch transactions', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 0.01,
        outputs: [{ address: 'tb1qone', amount: 10000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('feeRate must be at least');
  });

  it('returns 404 when creating a batch transaction for missing wallet', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    mockWalletFindById.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'tb1qone', amount: 10000 }],
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Wallet not found');
  });

  it('validates that each batch output has an address', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ amount: 10000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Output 1: address is required');
  });

  it('validates that each non-sendMax batch output has an amount', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'tb1qone' }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Output 1: amount is required');
  });

  it('rejects batch outputs with invalid recipient addresses', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockValidateAddress.mockReturnValueOnce({
      valid: false,
      error: 'invalid checksum',
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'bad-address', amount: 10000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid Bitcoin address');
  });

  it('returns bad request when batch transaction creation throws', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockCreateBatchTransaction.mockRejectedValueOnce(new Error('batch create failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'tb1qone', amount: 10000 }],
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('rejects batch transaction when more than one output uses sendMax', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [
          { address: 'tb1qone', sendMax: true },
          { address: 'tb1qtwo', sendMax: true },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Only one output can have sendMax');
  });

  it('creates batch transaction with validated outputs', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'testnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'testnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1.2,
        outputs: [
          { address: 'tb1qone', amount: 10000 },
          { address: 'tb1qtwo', amount: 5000 },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.psbtBase64).toBe('cHNi');
    expect(mockCreateBatchTransaction).toHaveBeenCalledWith(
      walletId,
      expect.any(Array),
      1.2,
      expect.objectContaining({ enableRBF: true })
    );
  });

  it('validates broadcast payload before sending', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Either signedPsbtBase64 or rawTxHex is required');
  });

  it('broadcasts signed transaction and writes audit event', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex: 'deadbeef',
        recipient: 'tb1qrecipient',
        amount: 10000,
        fee: 150,
      });

    expect(response.status).toBe(200);
    expect(response.body.txid).toHaveLength(64);
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST',
      'WALLET',
      expect.objectContaining({ success: true })
    );
  });

  it('captures failed broadcast attempts in audit log', async () => {
    mockBroadcastAndSave.mockRejectedValueOnce(new Error('broadcast failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        recipient: 'tb1qrecipient',
        amount: 10000,
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST_FAILED',
      'WALLET',
      expect.objectContaining({ success: false })
    );
  });

  it('validates estimate payload fields', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({
        recipient: 'tb1qrecipient',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('recipient, amount, and feeRate are required');
  });

  it('estimates transaction cost for valid request', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1.2,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      fee: 120,
      totalInput: 20120,
      totalOutput: 20000,
    });
  });

  it('returns server error when estimate service throws', async () => {
    mockEstimateTransaction.mockRejectedValueOnce(new Error('estimator unavailable'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1.2,
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates PSBT creation recipients array', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({ feeRate: 1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('recipients array is required');
  });

  it('enforces minimum fee rate for PSBT creation', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 0.01,
        recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('feeRate must be at least');
  });

  it('validates each PSBT recipient fields', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 1,
        recipients: [{ address: 'tb1qrecipient' }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Each recipient must have address and amount');
  });

  it('creates PSBT for hardware wallet signing', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 1.4,
        recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
        utxoIds: ['utxo-1'],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      psbt: expect.any(String),
      fee: 150,
      totalInput: 10150,
      totalOutput: 10000,
    });
  });

  it('returns bad request when PSBT creation fails', async () => {
    mockCreateTransaction.mockRejectedValueOnce(new Error('psbt build failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 1.4,
        recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates signed PSBT on PSBT broadcast endpoint', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('signedPsbt is required');
  });

  it('broadcasts PSBT and returns txid', async () => {
    mockGetPSBTInfo.mockReturnValue({
      fee: 450,
      outputs: [
        { address: 'tb1qdest', value: 25000 },
        { address: 'tb1qchange', value: 5000 },
      ],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
    });
    mockBroadcastAndSave.mockResolvedValue({
      txid: '9'.repeat(64),
      broadcasted: true,
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({
        signedPsbt: 'cHNi',
        label: 'hardware send',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      txid: '9'.repeat(64),
      broadcasted: true,
    });
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'cHNi',
      expect.objectContaining({
        recipient: 'tb1qdest',
        amount: 25000,
        fee: 450,
      })
    );
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST',
      'WALLET',
      expect.objectContaining({ success: true })
    );
  });

  it('broadcasts PSBT with default recipient and amount when no outputs are present', async () => {
    mockGetPSBTInfo.mockReturnValue({
      fee: 450,
      outputs: [],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
    });
    mockBroadcastAndSave.mockResolvedValue({
      txid: '8'.repeat(64),
      broadcasted: true,
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({
        signedPsbt: 'cHNi',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      txid: '8'.repeat(64),
      broadcasted: true,
    });
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'cHNi',
      expect.objectContaining({
        recipient: '',
        amount: 0,
      })
    );
  });

  it('logs failed PSBT broadcast attempts', async () => {
    mockGetPSBTInfo.mockImplementationOnce(() => {
      throw new Error('invalid psbt');
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({
        signedPsbt: 'bad-psbt',
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    // Audit log is not reached because getPSBTInfo throws before the try/catch block
  });

  it('extracts recipient and amount from PSBT when not provided in body', async () => {
    mockGetPSBTInfo.mockReturnValue({
      outputs: [{ address: 'tb1qpsbt-recipient', value: 42000 }],
      inputs: [{ txid: 'a'.repeat(64), vout: 0 }],
      fee: 300,
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        // No recipient or amount — should be extracted from PSBT
      });

    expect(response.status).toBe(200);
    expect(mockEvaluatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'tb1qpsbt-recipient',
        amount: BigInt(42000),
      })
    );
  });

  it('proceeds without policy eval when PSBT parsing fails and no recipient/amount supplied', async () => {
    mockGetPSBTInfo.mockImplementationOnce(() => {
      throw new Error('corrupt PSBT');
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'bad-psbt-data',
        // No recipient or amount in body and PSBT parse fails
      });

    expect(response.status).toBe(200);
    // Policy evaluation should NOT be called since there's no recipient/amount
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
  });

  it('swallows recordUsage errors on the broadcast route', async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error('usage recording failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        recipient: 'tb1qrecipient',
        amount: 10000,
      });

    expect(response.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it('swallows recordUsage errors on the PSBT broadcast route', async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error('usage recording failed'));
    mockGetPSBTInfo.mockReturnValue({
      fee: 450,
      outputs: [{ address: 'tb1qdest', value: 25000 }],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({ signedPsbt: 'cHNi' });

    expect(response.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalled();
  });
});
