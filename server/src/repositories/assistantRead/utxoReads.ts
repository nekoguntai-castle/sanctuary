import type { Prisma } from '../../generated/prisma/client';
import prisma from '../../models/prisma';

export async function getUtxoSummary(walletId: string) {
  const [total, spendable, frozen, unconfirmed, locked, spent] = await Promise.all([
    prisma.uTXO.aggregate({
      where: { walletId, spent: false },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, frozen: false, confirmations: { gt: 0 }, draftLock: null },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, frozen: true },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, confirmations: 0 },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false, draftLock: { isNot: null } },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: true },
      _count: { id: true },
      _sum: { amount: true },
    }),
  ]);

  return { total, spendable, frozen, unconfirmed, locked, spent };
}

export async function queryUtxos(where: Prisma.UTXOWhereInput, limit: number) {
  return prisma.uTXO.findMany({
    where,
    include: {
      draftLock: {
        include: {
          draft: { select: { id: true, label: true } },
        },
      },
    },
    orderBy: { amount: 'desc' },
    take: limit,
  });
}
