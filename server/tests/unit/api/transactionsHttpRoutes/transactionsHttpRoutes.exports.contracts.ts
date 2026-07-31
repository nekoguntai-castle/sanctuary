import { get as httpGet } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { expect, it } from "vitest";
import request from "supertest";

import { mockPrismaClient } from "../../../mocks/prisma";
import { app, walletId } from "./transactionsHttpRoutesTestHarness";
import { errorHandler } from '../../../../src/errors/errorHandler';
import { withTimeout } from '../../../../src/middleware/requestTimeout';
import { abortRequest } from '../../../../src/utils/requestAbort';
import { createExportRouter } from '../../../../src/api/transactions/walletTransactions/exportTransactions';
import { transactionExportPermits } from '../../../../src/services/transactionExport/exportPermit';

function mockExportRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const normalized = rows.map((row, index) => ({ id: row.id ?? `export-${index}`, ...row }));
  mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
    if (Object.keys(args.select ?? {}).length === 1 && args.select?.id) {
      return normalized
        .slice(args.skip, args.skip + args.take)
        .map(({ id }) => ({ id }));
    }
    const requested = new Set(args.where?.id?.in ?? []);
    return normalized.filter(row => requested.has(row.id));
  });
  return normalized;
}

export function registerTransactionHttpExportTests(): void {
  it("exports transactions in JSON format with sanitized filename", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "My Wallet!",
    });
    mockExportRows([
      {
        txid: "e".repeat(64),
        type: "received",
        amount: BigInt(100000),
        balanceAfter: BigInt(100000),
        fee: BigInt(0),
        confirmations: 3,
        label: "Salary",
        memo: "",
        counterpartyAddress: "tb1qincoming",
        blockHeight: BigInt(850000),
        blockTime: new Date("2025-01-01T00:00:00.000Z"),
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        transactionLabels: [],
      },
    ]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({
        format: "json",
        startDate: "2025-01-01",
        endDate: "2025-01-31",
      });

    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("application/json");
    expect(response.header["content-disposition"]).toContain("My_Wallet_");
    expect(response.body[0]).toMatchObject({
      txid: "e".repeat(64),
      amountSats: 100000,
      balanceAfterSats: 100000,
    });
    const findManyArg = mockPrismaClient.transaction.findMany.mock.calls[0][0];
    expect(findManyArg.where.blockTime.gte).toBeInstanceOf(Date);
    expect(findManyArg.where.blockTime.lte).toBeInstanceOf(Date);
  });

  it("exports transactions in CSV format and escapes commas", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "CSV Wallet",
    });
    mockExportRows([
      {
        txid: "f".repeat(64),
        type: "sent",
        amount: BigInt(-5000),
        balanceAfter: BigInt(95000),
        fee: BigInt(100),
        confirmations: 1,
        label: "Payment",
        memo: "note,with,comma",
        counterpartyAddress: "tb1qrecipient",
        blockHeight: BigInt(849999),
        blockTime: new Date("2025-01-02T00:00:00.000Z"),
        createdAt: new Date("2025-01-02T00:00:00.000Z"),
        transactionLabels: [],
      },
    ]);

    const response = await request(app).get(
      `/api/v1/wallets/${walletId}/transactions/export`,
    );

    expect(response.status).toBe(200);
    expect(response.header["content-type"]).toContain("text/csv");
    expect(response.text).toContain("Transaction ID");
    expect(response.text).toContain('"note,with,comma"');
  });

  it("exports CSV using default wallet filename and createdAt fallback for null fields", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    mockExportRows([
      {
        txid: "4".repeat(64),
        type: "received",
        amount: BigInt(0),
        balanceAfter: null,
        fee: null,
        confirmations: 0,
        label: null,
        memo: null,
        counterpartyAddress: null,
        blockHeight: null,
        blockTime: null,
        createdAt: new Date("2025-01-05T00:00:00.000Z"),
        transactionLabels: [],
      },
    ]);

    const response = await request(app).get(
      `/api/v1/wallets/${walletId}/transactions/export`,
    );

    expect(response.status).toBe(200);
    expect(response.header["content-disposition"]).toContain(
      "wallet_transactions_",
    );
    const dataRow = response.text.split("\n")[1];
    expect(dataRow).toContain("2025-01-05T00:00:00.000Z");
    expect(dataRow).toContain(",,");
  });

  it("preserves zero nullable numerics in JSON exports while retaining genuine nulls", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: "Zero Wallet" });
    const baseRow = {
      type: "sent",
      amount: BigInt(0),
      confirmations: 0,
      label: null,
      memo: null,
      counterpartyAddress: null,
      blockTime: null,
      createdAt: new Date("2025-01-06T00:00:00.000Z"),
      transactionLabels: [],
    };
    mockExportRows([
      {
        ...baseRow,
        txid: "5".repeat(64),
        balanceAfter: BigInt(0),
        fee: BigInt(0),
        blockHeight: BigInt(0),
      },
      {
        ...baseRow,
        txid: "6".repeat(64),
        balanceAfter: null,
        fee: null,
        blockHeight: null,
      },
    ]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: "json" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        balanceAfterBtc: 0,
        balanceAfterSats: 0,
        feeSats: 0,
        blockHeight: 0,
      }),
      expect.objectContaining({
        balanceAfterBtc: null,
        balanceAfterSats: null,
        feeSats: null,
        blockHeight: null,
      }),
    ]);
  });

  it("writes literal zero CSV columns and leaves only null numeric columns blank", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: "Zero CSV" });
    const baseRow = {
      type: "sent",
      amount: BigInt(0),
      confirmations: 0,
      label: null,
      memo: null,
      counterpartyAddress: null,
      blockTime: null,
      createdAt: new Date("2025-01-07T00:00:00.000Z"),
      transactionLabels: [],
    };
    mockExportRows([
      {
        ...baseRow,
        txid: "7".repeat(64),
        balanceAfter: BigInt(0),
        fee: BigInt(0),
        blockHeight: BigInt(0),
      },
      {
        ...baseRow,
        txid: "8".repeat(64),
        balanceAfter: null,
        fee: null,
        blockHeight: null,
      },
    ]);

    const response = await request(app).get(
      `/api/v1/wallets/${walletId}/transactions/export`,
    );

    expect(response.status).toBe(200);
    const [, zeroRow, nullRow] = response.text.trimEnd().split("\n");
    expect(zeroRow.split(",").slice(5, 8)).toEqual(["0", "0", "0"]);
    expect(zeroRow.split(",")[12]).toBe("0");
    expect(nullRow.split(",").slice(5, 8)).toEqual(["", "", ""]);
    expect(nullRow.split(",")[12]).toBe("");
  });

  it("returns error when transaction export fails", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Err Wallet",
    });
    mockPrismaClient.transaction.findMany.mockRejectedValue(
      new Error("export failed"),
    );

    const response = await request(app).get(
      `/api/v1/wallets/${walletId}/transactions/export`,
    );

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(transactionExportPermits.active).toBe(0);
  });

  it("pages through large export result sets without loading all rows at once", async () => {
    // Simulate a result set larger than a single page. Repository uses
    // pageSize 500 internally; return 500 rows on page 1 and 3 on page 2
    // so the handler must iterate exactly twice.
    const makeRow = (n: number) => {
      const day = String((n % 28) + 1).padStart(2, "0");
      return {
        txid: String(n).padStart(64, "0"),
        type: "received",
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
    const rows = Array.from({ length: 503 }, (_, i) => makeRow(i + 1));
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Paged Wallet",
    });
    mockExportRows(rows);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: "json" });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(503);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(4);
    // Second call should page past the first 500 rows.
    expect(mockPrismaClient.transaction.findMany.mock.calls[1][0].skip).toBe(
      500,
    );
    expect(mockPrismaClient.transaction.findMany.mock.calls[1][0].take).toBe(
      500,
    );
  });

  it("pages through large CSV export result sets", async () => {
    const makeRow = (n: number) => ({
      txid: String(n).padStart(64, "1"),
      type: "received",
      amount: BigInt(n * 100),
      balanceAfter: BigInt(n * 100),
      fee: null,
      confirmations: 1,
      label: null,
      memo: null,
      counterpartyAddress: null,
      blockHeight: BigInt(850000 + n),
      blockTime: new Date("2025-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const rows = Array.from({ length: 501 }, (_, i) => makeRow(i + 1));
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Paged CSV Wallet",
    });
    mockExportRows(rows);

    const response = await request(app).get(
      `/api/v1/wallets/${walletId}/transactions/export`,
    );

    expect(response.status).toBe(200);
    expect(response.text.split("\n").filter(Boolean).length).toBe(502);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(4);
    expect(mockPrismaClient.transaction.findMany.mock.calls[1][0].skip).toBe(
      500,
    );
  });

  it("destroys the response when export fails after streaming starts", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      id: `broken-${i}`,
      txid: String(i + 1).padStart(64, "2"),
      type: "received",
      amount: BigInt(1000),
      balanceAfter: BigInt(1000),
      fee: null,
      confirmations: 1,
      label: null,
      memo: null,
      counterpartyAddress: null,
      blockHeight: BigInt(850000 + i),
      blockTime: new Date("2025-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    }));
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Broken Stream Wallet",
    });
    let fullPageCalls = 0;
    mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
      if (Object.keys(args.select ?? {}).length === 1) {
        return rows.slice(args.skip, args.skip + args.take).map(({ id }) => ({ id }));
      }
      fullPageCalls += 1;
      if (fullPageCalls === 2) throw new Error('page two failed');
      const requested = new Set(args.where.id.in);
      return rows.filter(row => requested.has(row.id));
    });

    let requestError: unknown;
    try {
      await request(app)
        .get(`/api/v1/wallets/${walletId}/transactions/export`)
        .query({ format: "json" });
    } catch (error) {
      requestError = error;
    }

    expect(requestError).toBeDefined();
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(4);
    expect(transactionExportPermits.active).toBe(0);
  });

  it("terminates export pagination when a page returns fewer rows than page size", async () => {
    // A page smaller than 500 is the end-of-results sentinel. The handler
    // must not issue a subsequent findMany call.
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Short Wallet",
    });
    mockExportRows([
      {
        txid: "a".repeat(64),
        type: "received",
        amount: BigInt(1000),
        balanceAfter: BigInt(1000),
        fee: null,
        confirmations: 6,
        label: null,
        memo: null,
        counterpartyAddress: null,
        blockHeight: BigInt(850100),
        blockTime: new Date("2025-02-01T00:00:00.000Z"),
        createdAt: new Date("2025-02-01T00:00:00.000Z"),
      },
    ] as any);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: "json" });

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(1);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(2);
    // Ensure paginated query shape: deterministic orderBy + skip/take.
    const call = mockPrismaClient.transaction.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ blockTime: "asc" }, { id: "asc" }]);
    expect(call.skip).toBe(0);
    expect(call.take).toBe(500);
    // transactionLabels include must NOT appear - dead join was dropped.
    expect(call.include).toBeUndefined();
    expect(call.select).toBeDefined();
  });

  it("streams an empty JSON array for wallets with no transactions", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Empty Wallet",
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: "json" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(1);
  });

  it("streams an empty CSV (headers only) for wallets with no transactions", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: "Empty CSV" });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const response = await request(app).get(
      `/api/v1/wallets/${walletId}/transactions/export`,
    );

    expect(response.status).toBe(200);
    const lines = response.text.split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Transaction ID");
  });

  it("wraps only ID capture in a short REPEATABLE READ transaction", async () => {
    // Snapshot isolation is what makes the paginated read safe under
    // concurrent wallet sync writes: without it, skip-based pagination
    // between pages would shift offsets and either duplicate or miss
    // rows. Unit tests can't verify PostgreSQL MVCC behavior, but they
    // can assert the handler configures the transaction correctly.
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Snapshot Wallet",
    });
    mockExportRows([
      {
        txid: "1".repeat(64),
        type: "received",
        amount: BigInt(1000),
        balanceAfter: BigInt(1000),
        fee: null,
        confirmations: 3,
        label: null,
        memo: null,
        counterpartyAddress: null,
        blockHeight: BigInt(850000),
        blockTime: new Date("2025-03-01T00:00:00.000Z"),
        createdAt: new Date("2025-03-01T00:00:00.000Z"),
      },
    ] as any);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: "json" });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
    // First arg is the callback; second arg carries the isolation + timeout config.
    const [, txOptions] = mockPrismaClient.$transaction.mock.calls[0];
    expect(txOptions).toBeDefined();
    expect(txOptions.isolationLevel).toBe("RepeatableRead");
    expect(typeof txOptions.timeout).toBe("number");
    expect(txOptions.timeout).toBe(30_000);
    expect(typeof txOptions.maxWait).toBe("number");
  });

  it('returns a reusable pre-header 429 permit contract when export capacity is saturated', async () => {
    const releaseA = transactionExportPermits.tryAcquire();
    const releaseB = transactionExportPermits.tryAcquire();
    try {
      const saturated = await request(app).get(`/api/v1/wallets/${walletId}/transactions/export`);
      expect(saturated.status).toBe(429);
      expect(saturated.header['retry-after']).toBe('5');
      expect(saturated.body).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfter: 5 } });

      releaseA?.();
      mockExportRows([]);
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Reusable' });
      const reused = await request(app).get(`/api/v1/wallets/${walletId}/transactions/export`);
      expect(reused.status).toBe(200);
      expect(transactionExportPermits.active).toBe(1);
    } finally {
      releaseA?.();
      releaseB?.();
    }
  });

  it('neutralizes formula prefixes and quotes carriage returns only in CSV', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Safe CSV' });
    mockExportRows([{
      txid: '9'.repeat(64), type: 'sent', amount: BigInt(-5), balanceAfter: BigInt(0),
      fee: BigInt(1), confirmations: 1, label: '=1+1', memo: '@cmd\rnext',
      counterpartyAddress: null, blockHeight: BigInt(1), blockTime: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }]);

    const csv = await request(app).get(`/api/v1/wallets/${walletId}/transactions/export`);
    expect(csv.text).toContain("'=1+1");
    expect(csv.text).toContain('"\'@cmd\rnext"');
    expect(csv.text).toContain(',-5,');
  });

  it('keeps captured membership/order across concurrent insert, delete, and update', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Concurrent changes' });
    const rows = mockExportRows([
      {
        id: 'first', txid: 'a'.repeat(64), type: 'received', amount: BigInt(1),
        balanceAfter: BigInt(1), fee: null, confirmations: 1, label: null, memo: null,
        counterpartyAddress: null, blockHeight: null, blockTime: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'deleted', txid: 'b'.repeat(64), type: 'received', amount: BigInt(2),
        balanceAfter: BigInt(3), fee: null, confirmations: 1, label: null, memo: null,
        counterpartyAddress: null, blockHeight: null, blockTime: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'last', txid: 'c'.repeat(64), type: 'received', amount: BigInt(3),
        balanceAfter: BigInt(6), fee: null, confirmations: 1, label: null, memo: null,
        counterpartyAddress: null, blockHeight: null, blockTime: null,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);
    let captured = false;
    mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
      if (Object.keys(args.select ?? {}).length === 1) {
        captured = true;
        return rows.map(({ id }) => ({ id }));
      }
      expect(captured).toBe(true);
      return [
        { ...rows[2], amount: BigInt(99) },
        {
          ...rows[0], id: 'inserted', txid: 'd'.repeat(64), amount: BigInt(4),
        },
        rows[0],
      ];
    });

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: 'json' });

    expect(response.status).toBe(200);
    expect(response.body.map((row: { txid: string }) => row.txid)).toEqual([
      'a'.repeat(64),
      'c'.repeat(64),
    ]);
    expect(response.body[1].amountSats).toBe(99);
  });

  it('releases its permit promptly when the client closes during a pending row fetch', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Closed response' });
    let settleRows!: (rows: unknown[]) => void;
    const pendingRows = new Promise<unknown[]>(resolve => {
      settleRows = resolve;
    });
    mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
      if (Object.keys(args.select ?? {}).length === 1) return [{ id: 'pending' }];
      return pendingRows;
    });
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      await new Promise<void>((resolve, reject) => {
        const client = httpGet(
          `http://127.0.0.1:${port}/api/v1/wallets/${walletId}/transactions/export?format=json`,
          response => {
            response.once('data', () => {
              client.destroy();
              resolve();
            });
          },
        );
        client.once('error', error => {
          if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
        });
      });

      await new Promise(resolve => setTimeout(resolve, 25));
      expect(transactionExportPermits.active).toBe(1);
      settleRows([]);
      await expect.poll(() => transactionExportPermits.active).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('retains its permit when capture is aborted until the pending ID query settles', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Aborted capture' });
    let markQueryStarted!: () => void;
    const queryStarted = new Promise<void>(resolve => {
      markQueryStarted = resolve;
    });
    let settleIds!: (ids: unknown[]) => void;
    const pendingIds = new Promise<unknown[]>(resolve => {
      settleIds = resolve;
    });
    mockPrismaClient.transaction.findMany.mockImplementation(async () => {
      markQueryStarted();
      return pendingIds;
    });
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    try {
      const client = httpGet(
        `http://127.0.0.1:${port}/api/v1/wallets/${walletId}/transactions/export`,
      );
      client.on('error', () => undefined);
      await queryStarted;
      client.destroy();
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(transactionExportPermits.active).toBe(1);
      settleIds([]);
      await expect.poll(() => transactionExportPermits.active).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('honors production request-timeout cancellation while response backpressure is pending', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Timed export' });
    mockExportRows(Array.from({ length: 32 }, (_, index) => ({
      id: `timed-${index}`,
      txid: String(index).padStart(64, '0'),
      type: 'received',
      amount: BigInt(index),
      balanceAfter: BigInt(index),
      fee: null,
      confirmations: 1,
      label: null,
      memo: 'x'.repeat(256 * 1024),
      counterpartyAddress: null,
      blockHeight: null,
      blockTime: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })));

    const timedApp = express();
    timedApp.use(withTimeout(75));
    timedApp.use('/api/v1', createExportRouter());
    timedApp.use(errorHandler);
    const server = timedApp.listen(0);
    const { port } = server.address() as AddressInfo;
    let response: import('node:http').IncomingMessage | undefined;
    let client: import('node:http').ClientRequest | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        client = httpGet(
          `http://127.0.0.1:${port}/api/v1/wallets/${walletId}/transactions/export?format=json`,
          incoming => {
            response = incoming;
            incoming.once('error', reject);
            incoming.once('data', () => {
              incoming.pause();
              resolve();
            });
          },
        );
        client.once('error', error => {
          if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
        });
      });

      await expect.poll(() => transactionExportPermits.active).toBe(1);
      await expect.poll(() => transactionExportPermits.active).toBe(0);
      expect(response?.complete).toBe(false);
    } finally {
      response?.destroy();
      client?.destroy();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('preserves the production 408 when timeout fires during pre-header capture', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Pre-header timeout' });
    mockPrismaClient.transaction.findMany.mockImplementation(() => (
      new Promise(resolve => setTimeout(() => resolve([]), 100))
    ));
    const timedApp = express();
    timedApp.use(withTimeout(25));
    timedApp.use('/api/v1', createExportRouter());
    timedApp.use(errorHandler);

    const response = await request(timedApp)
      .get(`/api/v1/wallets/${walletId}/transactions/export?format=json`);

    expect(response.status).toBe(408);
    expect(response.body).toMatchObject({
      error: 'Request Timeout',
      message: 'The request took too long to process',
      timeout: '25ms',
    });
    await expect.poll(() => transactionExportPermits.active).toBe(0);
  });

  it('preserves an ended 408 when timeout wins after export headers are configured', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ name: 'Header-window timeout' });
    mockExportRows([]);
    const timedApp = express();
    timedApp.use((req, res, next) => {
      const setHeader = res.setHeader.bind(res);
      let timedOut = false;
      res.setHeader = ((name: string, value: string | number | readonly string[]) => {
        const result = setHeader(name, value);
        if (!timedOut && name.toLowerCase() === 'content-disposition') {
          timedOut = true;
          abortRequest(req, 'timeout');
          res.status(408).json({ error: 'Request Timeout', timeout: 'simulated' });
        }
        return result;
      }) as typeof res.setHeader;
      next();
    });
    timedApp.use('/api/v1', createExportRouter());
    timedApp.use(errorHandler);

    const response = await request(timedApp)
      .get(`/api/v1/wallets/${walletId}/transactions/export?format=json`);

    expect(response.status).toBe(408);
    expect(response.body).toEqual({ error: 'Request Timeout', timeout: 'simulated' });
    await expect.poll(() => transactionExportPermits.active).toBe(0);
  });
}
