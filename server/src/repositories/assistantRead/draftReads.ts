import prisma from '../../models/prisma';

export async function countDrafts(walletId: string): Promise<number> {
  return prisma.draftTransaction.count({ where: { walletId } });
}
