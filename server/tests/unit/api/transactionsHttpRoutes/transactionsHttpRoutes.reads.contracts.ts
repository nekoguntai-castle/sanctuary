import { expect, it } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import {
  app,
  mockAuditLogFromRequest,
  mockBroadcastAndSave,
  mockCreateBatchTransaction,
  mockCreateTransaction,
  mockEstimateTransaction,
  mockEvaluatePolicies,
  mockFetch,
  mockGetCachedBlockHeight,
  mockGetPSBTInfo,
  mockRecalculateWalletBalances,
  mockRecordUsage,
  mockValidateAddress,
  mockWalletCacheGet,
  mockWalletCacheSet,
  mockWalletFindById,
  walletId,
} from './transactionsHttpRoutesTestHarness';

export function registerTransactionHttpReadTests(): void {
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

  it('pages through large export result sets without loading all rows at once', async () => {
    // Simulate a result set larger than a single page. Repository uses
    // pageSize 500 internally; return 500 rows on page 1 and 3 on page 2
    // so the handler must iterate exactly twice.
    const makeRow = (n: number) => {
      const day = String((n % 28) + 1).padStart(2, '0');
      return {
        txid: String(n).padStart(64, '0'),
        type: 'received',
        amount: BigInt(n * 100),
        balanceAfter: BigInt(n * 100),
        fee: BigInt(0),
        confirmations: 1,
        label: null,
        memo: null,
        counterpartyAddress: null,
        blockHeight: BigInt(850000 + n),
        blockTime: new Date(`2025-01-${day}T00:00:00.000Z`),
        createdAt: new Date(`2025-01-${day}T00:00:00.000Z`),
      };
    };
    const firstPage = Array.from({ length: 500 }, (_, i) => makeRow(i + 1));
    const secondPage = Array.from({ length: 3 }, (_, i) => makeRow(501 + i));
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Paged Wallet' });
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce(firstPage as any)
      .mockResolvedValueOnce(secondPage as any);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: 'json' });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(503);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(2);
    // Second call should page past the first 500 rows.
    expect(mockPrismaClient.transaction.findMany.mock.calls[1][0].skip).toBe(500);
    expect(mockPrismaClient.transaction.findMany.mock.calls[1][0].take).toBe(500);
  });

  it('terminates export pagination when a page returns fewer rows than page size', async () => {
    // A page smaller than 500 is the end-of-results sentinel. The handler
    // must not issue a subsequent findMany call.
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Short Wallet' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: 'a'.repeat(64),
        type: 'received',
        amount: BigInt(1000),
        balanceAfter: BigInt(1000),
        fee: null,
        confirmations: 6,
        label: null,
        memo: null,
        counterpartyAddress: null,
        blockHeight: BigInt(850100),
        blockTime: new Date('2025-02-01T00:00:00.000Z'),
        createdAt: new Date('2025-02-01T00:00:00.000Z'),
      },
    ] as any);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: 'json' });

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(1);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(1);
    // Ensure paginated query shape: deterministic orderBy + skip/take.
    const call = mockPrismaClient.transaction.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ blockTime: 'asc' }, { id: 'asc' }]);
    expect(call.skip).toBe(0);
    expect(call.take).toBe(500);
    // transactionLabels include must NOT appear — dead join was dropped.
    expect(call.include).toBeUndefined();
    expect(call.select).toBeDefined();
  });

  it('streams an empty JSON array for wallets with no transactions', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Empty Wallet' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: 'json' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(1);
  });

  it('streams an empty CSV (headers only) for wallets with no transactions', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Empty CSV' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const response = await request(app).get(`/api/v1/wallets/${walletId}/transactions/export`);

    expect(response.status).toBe(200);
    const lines = response.text.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Transaction ID');
  });

  it('wraps the streamed export in a REPEATABLE READ transaction for snapshot safety', async () => {
    // Snapshot isolation is what makes the paginated read safe under
    // concurrent wallet sync writes: without it, skip-based pagination
    // between pages would shift offsets and either duplicate or miss
    // rows. Unit tests can't verify PostgreSQL MVCC behavior, but they
    // can assert the handler configures the transaction correctly.
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Snapshot Wallet' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        txid: '1'.repeat(64),
        type: 'received',
        amount: BigInt(1000),
        balanceAfter: BigInt(1000),
        fee: null,
        confirmations: 3,
        label: null,
        memo: null,
        counterpartyAddress: null,
        blockHeight: BigInt(850000),
        blockTime: new Date('2025-03-01T00:00:00.000Z'),
        createdAt: new Date('2025-03-01T00:00:00.000Z'),
      },
    ] as any);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: 'json' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
    // First arg is the callback; second arg carries the isolation + timeout config.
    const [, txOptions] = mockPrismaClient.$transaction.mock.calls[0];
    expect(txOptions).toBeDefined();
    expect(txOptions.isolationLevel).toBe('RepeatableRead');
    expect(typeof txOptions.timeout).toBe('number');
    expect(txOptions.timeout).toBeGreaterThanOrEqual(60_000);
    expect(typeof txOptions.maxWait).toBe('number');
  });
}
