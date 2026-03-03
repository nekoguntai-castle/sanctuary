/**
 * Integration Test Database Setup
 *
 * Uses a separate PostgreSQL test database within the existing Docker container.
 * Requires TEST_DATABASE_URL to be set, or falls back to using the main DATABASE_URL
 * with a test schema.
 */

import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;
let isSetup = false;

/**
 * Check if database is available for integration tests
 */
export function canRunIntegrationTests(): boolean {
  return !!(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);
}

/**
 * Set up the test database connection
 */
export async function setupTestDatabase(): Promise<PrismaClient> {
  if (prisma && isSetup) {
    return prisma;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'No database URL available. Set DATABASE_URL or TEST_DATABASE_URL to run integration tests.'
    );
  }

  // Create Prisma client for test database
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: process.env.DEBUG ? ['query', 'error', 'warn'] : ['error'],
  });

  try {
    await prisma.$connect();
    isSetup = true;

    // Seed with minimal required data
    await seedTestData(prisma);

    return prisma;
  } catch (error) {
    console.error('Failed to connect to test database:', error);
    throw error;
  }
}

/**
 * Seed minimal required data for tests
 */
async function seedTestData(client: PrismaClient): Promise<void> {
  // Create default system settings if they don't exist
  const defaultSettings = [
    { key: 'confirmationThreshold', value: '3' },
    { key: 'deepConfirmationThreshold', value: '100' },
    { key: 'dustThreshold', value: '546' },
  ];

  for (const setting of defaultSettings) {
    await client.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
}

/**
 * Clean all test data between tests
 * Only cleans data created during tests, preserves system settings
 */
export async function cleanupTestData(): Promise<void> {
  if (!prisma) return;

  // Delete in dependency order so FK-constrained rows are removed safely.
  await prisma.transactionLabel.deleteMany();
  await prisma.addressLabel.deleteMany();
  await prisma.label.deleteMany();

  await prisma.featureFlagAudit.deleteMany();
  await prisma.featureFlag.deleteMany();

  await prisma.transactionInput.deleteMany();
  await prisma.transactionOutput.deleteMany();
  await prisma.draftUtxoLock.deleteMany();
  await prisma.draftTransaction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.uTXO.deleteMany();
  await prisma.address.deleteMany();
  await prisma.walletDevice.deleteMany();
  await prisma.mobilePermission.deleteMany();
  await prisma.walletUser.deleteMany();
  await prisma.wallet.deleteMany();

  await prisma.deviceAccount.deleteMany();
  await prisma.deviceUser.deleteMany();
  await prisma.device.deleteMany();
  await prisma.hardwareDeviceModel.deleteMany();

  await prisma.emailVerificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.revokedToken.deleteMany();
  await prisma.pushDevice.deleteMany();
  await prisma.ownershipTransfer.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  await prisma.auditLog.deleteMany();
  await prisma.priceData.deleteMany();
  await prisma.feeEstimate.deleteMany();
  await prisma.electrumServer.deleteMany();
  await prisma.nodeConfig.deleteMany();
}

/**
 * Tear down test database connection
 */
export async function teardownTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    isSetup = false;
  }
}

/**
 * Get the test Prisma client
 */
export function getTestPrisma(): PrismaClient {
  if (!prisma) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return prisma;
}
