import prisma from '../../models/prisma';

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function getLatestFeeEstimate() {
  return prisma.feeEstimate.findFirst({
    orderBy: { createdAt: 'desc' },
  });
}

export async function getLatestPrice(currency: string) {
  return prisma.priceData.findFirst({
    where: { currency },
    orderBy: { createdAt: 'desc' },
  });
}
