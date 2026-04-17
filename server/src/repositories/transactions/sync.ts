import prisma from '../../models/prisma';
import type { Prisma } from '../../generated/prisma/client';

export async function findByWalletIdAndTxids<T extends Prisma.TransactionSelect>(
  walletId: string,
  txids: string[],
  select: T
) {
  return prisma.transaction.findMany({
    where: { walletId, txid: { in: txids } },
    select,
  });
}

export async function findPendingWithInputs(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: { some: {} },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function findConfirmedWithSharedInputs(
  walletId: string,
  inputPatterns: Array<{ txid: string; vout: number }>
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { gt: 0 },
      inputs: {
        some: {
          OR: inputPatterns.map(i => ({ txid: i.txid, vout: i.vout })),
        },
      },
    },
    select: {
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function updateRbfStatus(
  id: string,
  data: { rbfStatus?: string; replacedByTxid?: string | null }
): Promise<void> {
  await prisma.transaction.update({
    where: { id },
    data,
  });
}

export async function findPendingWithSharedInputs(
  walletId: string,
  inputPatterns: Array<{ txid: string; vout: number }>
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: {
        some: {
          OR: inputPatterns.map(p => ({ txid: p.txid, vout: p.vout })),
        },
      },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function findUnlinkedReplaced(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      rbfStatus: 'replaced',
      replacedByTxid: null,
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function createMany(
  data: Array<Record<string, unknown>>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transaction.createMany({
    data: data as Prisma.TransactionCreateManyInput[],
    skipDuplicates: options?.skipDuplicates,
  });
}

export async function create(
  data: Prisma.TransactionUncheckedCreateInput
) {
  return prisma.transaction.create({ data });
}

export async function createManyInputs(
  data: Array<Record<string, unknown>>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transactionInput.createMany({
    data: data as Prisma.TransactionInputCreateManyInput[],
    skipDuplicates: options?.skipDuplicates,
  });
}

export async function createManyOutputs(
  data: Array<Record<string, unknown>>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transactionOutput.createMany({
    data: data as Prisma.TransactionOutputCreateManyInput[],
    skipDuplicates: options?.skipDuplicates,
  });
}

export async function createManyTransactionLabels(
  data: Array<{ transactionId: string; labelId: string }>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transactionLabel.createMany({
    data,
    skipDuplicates: options?.skipDuplicates,
  });
}

export async function findAddressLabelsByAddressIds(addressIds: string[]) {
  return prisma.addressLabel.findMany({
    where: { addressId: { in: addressIds } },
  });
}

export async function findWithoutIO(
  walletId: string,
  txids: string[]
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      txid: { in: txids },
      inputs: { none: {} },
      outputs: { none: {} },
    },
    select: { id: true, txid: true, type: true },
  });
}

export async function batchUpdateRbfStatus(
  updates: Array<{ id: string; rbfStatus: string; replacedByTxid: string }>
): Promise<void> {
  /* v8 ignore next -- sync pipeline avoids empty RBF update batches */
  if (updates.length === 0) return;
  await prisma.$transaction(
    updates.map(u =>
      prisma.transaction.update({
        where: { id: u.id },
        data: { rbfStatus: u.rbfStatus, replacedByTxid: u.replacedByTxid },
      })
    )
  );
}

export async function findSentWithOutputs(walletId: string) {
  return prisma.transaction.findMany({
    where: { walletId, type: 'sent' },
    include: {
      outputs: {
        select: { id: true, address: true, isOurs: true },
      },
    },
  });
}

export async function updateTypeAndAmount(
  id: string,
  data: { type: string; amount: bigint }
): Promise<void> {
  await prisma.transaction.update({
    where: { id },
    data,
  });
}

export async function updateOutputsIsOurs(
  ids: string[],
  data: { isOurs: boolean; outputType: string }
): Promise<void> {
  /* v8 ignore next -- sync pipeline avoids empty output update batches */
  if (ids.length === 0) return;
  await prisma.transactionOutput.updateMany({
    where: { id: { in: ids } },
    data,
  });
}

export async function findForBalanceRecalculation(walletId: string) {
  return prisma.transaction.findMany({
    where: { walletId },
    orderBy: [
      { blockTime: 'asc' },
      { createdAt: 'asc' },
    ],
    select: { id: true, amount: true },
  });
}

export async function batchUpdateBalances(
  updates: Array<{ id: string; balanceAfter: bigint }>,
  batchSize: number = 500
): Promise<void> {
  await batchUpdateByIds(
    updates.map(u => ({ id: u.id, data: { balanceAfter: u.balanceAfter } })),
    batchSize
  );
}

export async function findBelowConfirmationThreshold(
  walletId: string,
  threshold: number
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: threshold },
      blockHeight: { not: null },
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });
}

export async function findWithMissingFields(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      OR: [
        { blockHeight: null },
        { addressId: null },
        { blockTime: null },
        { fee: null },
        { counterpartyAddress: null },
      ],
    },
    select: {
      id: true,
      txid: true,
      type: true,
      amount: true,
      fee: true,
      blockHeight: true,
      blockTime: true,
      confirmations: true,
      addressId: true,
      counterpartyAddress: true,
    },
  });
}

export async function batchUpdateByIds(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
  batchSize: number
): Promise<void> {
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    await prisma.$transaction(
      chunk.map(u =>
        prisma.transaction.update({
          where: { id: u.id },
          data: u.data,
        })
      )
    );
  }
}
