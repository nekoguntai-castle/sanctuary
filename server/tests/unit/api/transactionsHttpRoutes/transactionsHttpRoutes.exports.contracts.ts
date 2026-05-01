import { expect, it } from "vitest";
import request from "supertest";

import { mockPrismaClient } from "../../../mocks/prisma";
import { app, walletId } from "./transactionsHttpRoutesTestHarness";

export function registerTransactionHttpExportTests(): void {
  it("exports transactions in JSON format with sanitized filename", async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "My Wallet!",
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
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
    mockPrismaClient.transaction.findMany.mockResolvedValue([
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
    mockPrismaClient.transaction.findMany.mockResolvedValue([
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
    const firstPage = Array.from({ length: 500 }, (_, i) => makeRow(i + 1));
    const secondPage = Array.from({ length: 3 }, (_, i) => makeRow(501 + i));
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Paged Wallet",
    });
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce(firstPage as any)
      .mockResolvedValueOnce(secondPage as any);

    const response = await request(app)
      .get(`/api/v1/wallets/${walletId}/transactions/export`)
      .query({ format: "json" });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(503);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(2);
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
    const firstPage = Array.from({ length: 500 }, (_, i) => makeRow(i + 1));
    const secondPage = [makeRow(501)];
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Paged CSV Wallet",
    });
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce(firstPage as any)
      .mockResolvedValueOnce(secondPage as any);

    const response = await request(app).get(
      `/api/v1/wallets/${walletId}/transactions/export`,
    );

    expect(response.status).toBe(200);
    expect(response.text.split("\n").filter(Boolean).length).toBe(502);
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrismaClient.transaction.findMany.mock.calls[1][0].skip).toBe(
      500,
    );
  });

  it("destroys the response when export fails after streaming starts", async () => {
    const firstPage = Array.from({ length: 500 }, (_, i) => ({
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
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce(firstPage as any)
      .mockRejectedValueOnce(new Error("page two failed"));

    let requestError: unknown;
    try {
      await request(app)
        .get(`/api/v1/wallets/${walletId}/transactions/export`)
        .query({ format: "json" });
    } catch (error) {
      requestError = error;
    }

    expect(requestError).toBeDefined();
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(2);
  });

  it("terminates export pagination when a page returns fewer rows than page size", async () => {
    // A page smaller than 500 is the end-of-results sentinel. The handler
    // must not issue a subsequent findMany call.
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Short Wallet",
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
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
    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(1);
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

  it("wraps the streamed export in a REPEATABLE READ transaction for snapshot safety", async () => {
    // Snapshot isolation is what makes the paginated read safe under
    // concurrent wallet sync writes: without it, skip-based pagination
    // between pages would shift offsets and either duplicate or miss
    // rows. Unit tests can't verify PostgreSQL MVCC behavior, but they
    // can assert the handler configures the transaction correctly.
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      name: "Snapshot Wallet",
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
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
    expect(txOptions.timeout).toBeGreaterThanOrEqual(60_000);
    expect(typeof txOptions.maxWait).toBe("number");
  });
}
