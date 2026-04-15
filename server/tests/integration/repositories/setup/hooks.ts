import { PrismaClient } from '../../../../src/generated/prisma/client';
import {
  canRunIntegrationTests,
  cleanupTestData,
  disconnectTestDatabase,
  getTestPrisma,
} from './database';

export function describeIfDatabase(name: string, fn: () => void): void {
  if (canRunIntegrationTests()) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (no database)`, fn);
  }
}

export function setupRepositoryTests() {
  beforeAll(async () => {
    await getTestPrisma();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });
}

export interface TestHookOptions {
  cleanupBefore?: boolean;
  cleanupAfter?: boolean;
  seedSystemSettings?: boolean;
  customSetup?: (tx: PrismaClient) => Promise<void>;
  customTeardown?: (tx: PrismaClient) => Promise<void>;
}

export function createTestSuite(options: TestHookOptions = {}) {
  let testPrisma: PrismaClient | null = null;

  const setup = async () => {
    testPrisma = await getTestPrisma();

    if (options.cleanupBefore) {
      await cleanupTestData();
    }

    if (options.seedSystemSettings) {
      await seedSystemSettings(testPrisma);
    }

    if (options.customSetup) {
      await options.customSetup(testPrisma);
    }
  };

  const teardown = async () => {
    if (testPrisma && options.customTeardown) {
      await options.customTeardown(testPrisma);
    }

    if (options.cleanupAfter) {
      await cleanupTestData();
    }

    await disconnectTestDatabase();
  };

  const getPrismaClient = () => {
    if (!testPrisma) {
      throw new Error('Test suite not initialized. Call setup() first.');
    }
    return testPrisma;
  };

  return { setup, teardown, getPrisma: getPrismaClient };
}

async function seedSystemSettings(tx: PrismaClient): Promise<void> {
  const defaultSettings = [
    { key: 'confirmationThreshold', value: '3' },
    { key: 'deepConfirmationThreshold', value: '100' },
    { key: 'dustThreshold', value: '546' },
  ];

  for (const setting of defaultSettings) {
    await tx.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
}
