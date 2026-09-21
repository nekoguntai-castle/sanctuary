import prisma, { type PrismaTxClient } from '../../models/prisma';
import { Prisma } from '../../generated/prisma/client';
import { liveTransactionSql } from './visibility';

export interface ExportTransactionRow {
  id: string;
  txid: string;
  type: string;
  amount: bigint;
  balanceAfter: bigint | null;
  fee: bigint | null;
  confirmations: number;
  label: string | null;
  memo: string | null;
  counterpartyAddress: string | null;
  blockHeight: number | null;
  blockTime: Date | null;
  createdAt: Date;
}

export async function findExportRowPage(
  walletId: string,
  dateFilter: { gte?: Date; lte?: Date } | undefined,
  skip: number,
  take: number,
  client: PrismaTxClient | typeof prisma = prisma,
): Promise<ExportTransactionRow[]> {
  // Export dates follow the UI's effective-date contract: confirmed rows use
  // blockTime and pending rows fall back to createdAt. Replaced RBF records are
  // durable audit history rather than live ledger entries and stay out of user
  // exports. Prisma cannot filter or order by the computed date expression, so
  // keep the projection explicit here.
  const effectiveDate = Prisma.sql`COALESCE(transaction."blockTime", transaction."createdAt")`;
  return client.$queryRaw<ExportTransactionRow[]>(Prisma.sql`
    SELECT transaction."id",
           transaction."txid",
           transaction."type",
           transaction."amount",
           transaction."balanceAfter",
           transaction."fee",
           transaction."confirmations",
           transaction."label",
           transaction."memo",
           transaction."counterpartyAddress",
           transaction."blockHeight",
           transaction."blockTime",
           transaction."createdAt"
    FROM "transactions" transaction
    WHERE transaction."walletId" = ${walletId}
      AND ${liveTransactionSql(Prisma.sql`transaction."rbfStatus"`)}
      ${dateFilter?.gte ? Prisma.sql`AND ${effectiveDate} >= ${dateFilter.gte}` : Prisma.empty}
      ${dateFilter?.lte ? Prisma.sql`AND ${effectiveDate} <= ${dateFilter.lte}` : Prisma.empty}
    ORDER BY ${effectiveDate} ASC, transaction."id" ASC
    LIMIT ${take}
    OFFSET ${skip}
  `);
}

export async function withExportCaptureTransaction<T>(
  fn: (tx: PrismaTxClient) => Promise<T>,
  options: { maxWait: number; timeout: number }
): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: options.maxWait,
    timeout: options.timeout,
  });
}
