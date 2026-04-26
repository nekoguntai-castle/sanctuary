import type { Prisma } from '../../generated/prisma/client';
import prisma from '../../models/prisma';

export async function searchAddresses(where: Prisma.AddressWhereInput, limit: number) {
  return prisma.address.findMany({
    where,
    include: { addressLabels: { include: { label: true } } },
    orderBy: { index: 'asc' },
    take: limit,
  });
}

export async function getAddressSummary(walletId: string) {
  const [totalCount, usedCount, unusedCount, totalBalance, usedBalances] = await Promise.all([
    prisma.address.count({ where: { walletId } }),
    prisma.address.count({ where: { walletId, used: true } }),
    prisma.address.count({ where: { walletId, used: false } }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false },
      _sum: { amount: true },
    }),
    // Prisma cannot group joined address metadata here; join on walletId too so reused addresses stay isolated.
    prisma.$queryRaw<Array<{ used: boolean; balance: bigint }>>`
      SELECT a."used" as used, COALESCE(SUM(u."amount"), 0) as balance
      FROM "utxos" u
      JOIN "addresses" a ON a."address" = u."address" AND a."walletId" = u."walletId"
      WHERE u."walletId" = ${walletId} AND u."spent" = false
      GROUP BY a."used"
    `,
  ]);

  return { totalCount, usedCount, unusedCount, totalBalance, usedBalances };
}

export async function findAddressDetail(
  walletId: string,
  input: { addressId?: string; address?: string }
) {
  const address = await prisma.address.findFirst({
    where: {
      walletId,
      ...(input.addressId ? { id: input.addressId } : { address: input.address }),
    },
    include: {
      addressLabels: { include: { label: true } },
      _count: { select: { transactions: true } },
    },
  });

  if (!address) {
    return null;
  }

  const balance = await prisma.uTXO.aggregate({
    where: { walletId, address: address.address, spent: false },
    _count: { id: true },
    _sum: { amount: true },
  });

  return { address, balance };
}
