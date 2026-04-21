import prisma from '../models/prisma';

export interface DeviceSupportStats {
  total: number;
  shared: number;
  byType: Record<string, number>;
  byModelSlug: Record<string, number>;
  totalAccounts: number;
  walletAssociations: number;
}

export async function getSupportStats(): Promise<DeviceSupportStats> {
  const [total, shared, byType, byModel, totalAccounts, walletAssociations] = await Promise.all([
    prisma.device.count(),
    prisma.deviceUser.count(),
    prisma.device.groupBy({ by: ['type'], _count: { _all: true } }),
    prisma.device.findMany({
      select: { model: { select: { slug: true } } },
    }),
    prisma.deviceAccount.count(),
    prisma.walletDevice.count(),
  ]);

  const modelCounts: Record<string, number> = {};
  for (const row of byModel) {
    const slug = row.model?.slug ?? 'unknown';
    modelCounts[slug] = (modelCounts[slug] ?? 0) + 1;
  }

  return {
    total,
    shared,
    byType: Object.fromEntries(byType.map(r => [r.type, r._count._all])),
    byModelSlug: modelCounts,
    totalAccounts,
    walletAssociations,
  };
}
