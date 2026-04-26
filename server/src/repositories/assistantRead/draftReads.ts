import prisma from '../../models/prisma';
import type { Prisma } from '../../generated/prisma/client';

const draftDetailInclude = {
  approvalRequests: {
    include: {
      votes: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  utxoLocks: {
    select: {
      id: true,
      createdAt: true,
      utxo: {
        select: {
          id: true,
          amount: true,
          confirmations: true,
          frozen: true,
          spent: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.DraftTransactionInclude;

export type AssistantDraftDetailRecord = Prisma.DraftTransactionGetPayload<{
  include: typeof draftDetailInclude;
}>;

export async function countDrafts(walletId: string): Promise<number> {
  return prisma.draftTransaction.count({ where: { walletId } });
}

export async function findDraftDetailForAssistant(
  walletId: string,
  draftId: string
): Promise<AssistantDraftDetailRecord | null> {
  return prisma.draftTransaction.findFirst({
    where: { id: draftId, walletId },
    include: draftDetailInclude,
  });
}
