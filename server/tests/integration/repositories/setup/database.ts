import { PrismaClient } from '../../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

let prisma: PrismaClient | null = null;
let isSetup = false;

export function canRunIntegrationTests(): boolean {
  return !!(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);
}

export async function getTestPrisma(): Promise<PrismaClient> {
  if (prisma && isSetup) {
    return prisma;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'No database URL available. Set DATABASE_URL or TEST_DATABASE_URL to run integration tests.'
    );
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  prisma = new PrismaClient({ adapter });

  await prisma.$connect();
  isSetup = true;

  return prisma;
}

export async function disconnectTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    isSetup = false;
  }
}

export async function withTestTransaction<T>(
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  const client = await getTestPrisma();

  try {
    return await client.$transaction(async (tx) => {
      const result = await fn(tx as unknown as PrismaClient);
      throw new RollbackError(result);
    });
  } catch (error) {
    if (error instanceof RollbackError) {
      return error.result as T;
    }
    throw error;
  }
}

class RollbackError extends Error {
  constructor(public result: unknown) {
    super('Rollback');
    this.name = 'RollbackError';
  }
}

export async function cleanupTestData(): Promise<void> {
  const client = await getTestPrisma();

  await client.transactionLabel.deleteMany();
  await client.addressLabel.deleteMany();
  await client.label.deleteMany();

  await client.transactionInput.deleteMany();
  await client.transactionOutput.deleteMany();
  await client.draftUtxoLock.deleteMany();
  await client.draftTransaction.deleteMany();
  await client.transaction.deleteMany();
  await client.uTXO.deleteMany();
  await client.address.deleteMany();
  await client.walletDevice.deleteMany();
  await client.mobilePermission.deleteMany();
  await client.walletUser.deleteMany();
  await client.wallet.deleteMany();

  await client.deviceAccount.deleteMany();
  await client.deviceUser.deleteMany();
  await client.device.deleteMany();
  await client.hardwareDeviceModel.deleteMany();

  await client.emailVerificationToken.deleteMany();
  await client.refreshToken.deleteMany();
  await client.revokedToken.deleteMany();
  await client.pushDevice.deleteMany();
  await client.ownershipTransfer.deleteMany();
  await client.groupMember.deleteMany();
  await client.group.deleteMany();
  await client.user.deleteMany();

  await client.auditLog.deleteMany();
  await client.priceData.deleteMany();
  await client.feeEstimate.deleteMany();
  await client.electrumServer.deleteMany();
  await client.nodeConfig.deleteMany();
}
