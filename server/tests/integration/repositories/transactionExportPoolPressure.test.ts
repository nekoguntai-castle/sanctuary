import express, { type Express } from 'express';
import { get as httpGet, type ClientRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { errorHandler } from '../../../src/errors/errorHandler';
import { resolvePrismaTransactionTimeoutOptions } from '../../../src/models/prismaTransactionOptions';
import { transactionExportPermits } from '../../../src/services/transactionExport/exportPermit';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const WALLET_ID = 'pool-pressure-wallet';
const ROW_COUNT = 80;
const LARGE_MEMO = 'x'.repeat(512 * 1024);

async function withinOneSecond<T>(operation: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('unrelated DB work could not acquire the one-connection pool')),
          1_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function exportRows(ids: string[]) {
  return ids.map((id, index) => ({
    id,
    txid: String(index).padStart(64, '0'),
    type: 'received',
    amount: BigInt(index + 1),
    balanceAfter: BigInt(index + 1),
    fee: null,
    confirmations: 1,
    label: null,
    memo: LARGE_MEMO,
    counterpartyAddress: null,
    blockHeight: null,
    blockTime: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }));
}

describeWithDatabase('transaction export pool pressure', () => {
  let prisma: PrismaClient;
  let app: Express;
  let server: Server;
  const ids = Array.from({ length: ROW_COUNT }, (_, index) => `export-${index}`);
  const rows = exportRows(ids);

  beforeAll(async () => {
    const transactionOptions = resolvePrismaTransactionTimeoutOptions(process.env);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl!, max: 1 }),
      ...(transactionOptions === undefined ? {} : { transactionOptions }),
    });
    await prisma.$connect();

    vi.doMock('../../../src/middleware/walletAccess', () => ({
      requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
        req.walletId = req.params.walletId;
        next();
      },
    }));
    vi.doMock('../../../src/repositories', () => ({
      walletRepository: {
        findByIdWithSelect: vi.fn().mockResolvedValue({ name: 'Pool pressure' }),
      },
      transactionRepository: {
        withExportCaptureTransaction: (fn: (tx: any) => Promise<unknown>, options: any) => (
          prisma.$transaction(fn, { ...options, isolationLevel: 'RepeatableRead' })
        ),
        findExportRowPage: async (
          _walletId: string,
          _dateFilter: unknown,
          skip: number,
          take: number,
          tx: any,
        ) => {
          await tx.$queryRaw`SELECT 1`;
          return rows.slice(skip, skip + take);
        },
      },
    }));
    const { createExportRouter } = await import(
      '../../../src/api/transactions/walletTransactions/exportTransactions'
    );
    app = express();
    app.use(createExportRouter());
    app.use(errorHandler);
    server = app.listen(0);
  });

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
    await prisma?.$disconnect();
    vi.doUnmock('../../../src/repositories');
    vi.doUnmock('../../../src/middleware/walletAccess');
  });

  it('lets unrelated DB work use the sole connection while the real response is paused', async () => {
    const { port } = server.address() as AddressInfo;
    let request!: ClientRequest;
    let response!: IncomingMessage;
    await new Promise<void>((resolve, reject) => {
      request = httpGet(
        `http://127.0.0.1:${port}/wallets/${WALLET_ID}/transactions/export?format=json`,
        incoming => {
          response = incoming;
          incoming.once('data', () => {
            incoming.pause();
            resolve();
          });
        },
      );
      request.once('error', reject);
    });

    try {
      expect(transactionExportPermits.active).toBe(1);
      const unrelated = prisma.$queryRaw<Array<{ value: number }>>`SELECT 2 AS value`;
      await expect(withinOneSecond(unrelated)).resolves.toEqual([{ value: 2 }]);
      expect(response.complete).toBe(false);
    } finally {
      response.destroy();
      request.destroy();
      await expect.poll(() => transactionExportPermits.active).toBe(0);
    }
  });
});
