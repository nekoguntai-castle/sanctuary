import type { Prisma } from '../../generated/prisma/client';
import prisma from '../../models/prisma';

const LABEL_DETAIL_ASSOCIATION_LIMIT = 50;
const LABEL_LIST_LIMIT = 201;

function clampLabelListLimit(limit: number | undefined): number | undefined {
  return limit === undefined ? undefined : Math.min(limit, LABEL_LIST_LIMIT);
}

export async function findWalletLabelsForAssistant(
  walletId: string,
  options?: { query?: string; limit?: number }
) {
  const where: Prisma.LabelWhereInput = {
    walletId,
    ...(options?.query ? { name: { contains: options.query, mode: 'insensitive' } } : {}),
  };

  return prisma.label.findMany({
    where,
    include: {
      _count: {
        select: {
          transactionLabels: true,
          addressLabels: true,
        },
      },
    },
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    take: clampLabelListLimit(options?.limit),
  });
}

export async function findWalletLabelDetailForAssistant(
  walletId: string,
  labelId: string
) {
  return prisma.label.findFirst({
    where: { id: labelId, walletId },
    include: {
      transactionLabels: {
        take: LABEL_DETAIL_ASSOCIATION_LIMIT,
        orderBy: { createdAt: 'desc' },
        include: {
          transaction: {
            select: {
              id: true,
              txid: true,
              type: true,
              amount: true,
              confirmations: true,
              blockTime: true,
              createdAt: true,
            },
          },
        },
      },
      addressLabels: {
        take: LABEL_DETAIL_ASSOCIATION_LIMIT,
        orderBy: { createdAt: 'desc' },
        include: {
          address: {
            select: {
              id: true,
              address: true,
              index: true,
              used: true,
              createdAt: true,
            },
          },
        },
      },
      _count: {
        select: {
          transactionLabels: true,
          addressLabels: true,
        },
      },
    },
  });
}
