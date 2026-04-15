import prisma, { type PrismaTxClient } from '../../models/prisma';

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

export async function findExportPage(
  walletId: string,
  dateFilter: { gte?: Date; lte?: Date } | undefined,
  skip: number,
  take: number,
  client: PrismaTxClient | typeof prisma = prisma,
): Promise<ExportTransactionRow[]> {
  return client.transaction.findMany({
    where: {
      walletId,
      ...(dateFilter && Object.keys(dateFilter).length > 0 ? { blockTime: dateFilter } : {}),
    },
    select: {
      id: true,
      txid: true,
      type: true,
      amount: true,
      balanceAfter: true,
      fee: true,
      confirmations: true,
      label: true,
      memo: true,
      counterpartyAddress: true,
      blockHeight: true,
      blockTime: true,
      createdAt: true,
    },
    orderBy: [{ blockTime: 'asc' }, { id: 'asc' }],
    skip,
    take,
  });
}
