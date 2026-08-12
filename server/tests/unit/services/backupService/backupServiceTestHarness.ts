import { vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  CACHE_TABLES,
  EPHEMERAL_TABLES,
  TABLE_ORDER,
} from '../../../../src/services/backupService/constants';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';

const accessCacheMocks = vi.hoisted(() => ({
  mockAccessCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deletePattern: vi.fn().mockResolvedValue(0),
    clear: vi.fn().mockResolvedValue(undefined),
  },
  mockClearAccessCache: vi.fn().mockResolvedValue(undefined),
  mockClearAccessCacheStrict: vi.fn().mockResolvedValue(undefined),
}));

const loggerMocks = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const featureRuntimeMocks = vi.hoisted(() => ({
  reconcileAfterRestore: vi.fn().mockResolvedValue(undefined),
}));

export function getMockClearAccessCacheStrict() {
  return accessCacheMocks.mockClearAccessCacheStrict;
}

export function getMockBackupLogger() {
  return loggerMocks.mockLogger;
}

export function getMockFeatureRuntimeReconcile() {
  return featureRuntimeMocks.reconcileAfterRestore;
}

const createBackupModelMock = () => ({
  findMany: vi.fn().mockResolvedValue([]),
  findUnique: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockImplementation(async ({ data }) => data),
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
});

const backupOnlyModelNames = [
  'transactionSigningIntent',
  'webhookEndpoint',
  'webhookDelivery',
  'refreshToken',
  'revokedToken',
  'featureFlag',
  'featureFlagAudit',
  'emailVerificationToken',
  'vaultPolicy',
  'approvalRequest',
  'approvalVote',
  'policyEvent',
  'policyAddress',
  'policyUsageWindow',
  'consoleSession',
  'consoleTurn',
  'consoleToolTrace',
  'consolePromptHistory',
  'walletRemediationProposal',
  'walletRemediationEvent',
] as const;

const backupPrisma = mockPrismaClient as Record<string, unknown>;
for (const modelName of backupOnlyModelNames) {
  backupPrisma[modelName] ??= createBackupModelMock();
}

export const allBackupDatabaseTables = [
  ...TABLE_ORDER,
  ...CACHE_TABLES,
  ...EPHEMERAL_TABLES,
].map(table => ({ tablename: camelToSnakeCase(table) }));

export function mockAllBackupTablesExist(): void {
  mockPrismaClient.$queryRaw.mockResolvedValue(allBackupDatabaseTables);
}

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/infrastructure/accessCache', () => ({
  clearAccessCache: accessCacheMocks.mockClearAccessCache,
  clearAccessCacheStrict: accessCacheMocks.mockClearAccessCacheStrict,
  getAccessCache: () => accessCacheMocks.mockAccessCache,
  invalidateUserAccessCache: vi.fn().mockResolvedValue(undefined),
  invalidateWalletAccessCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => loggerMocks.mockLogger,
}));

vi.mock('../../../../src/services/migrationService', () => ({
  migrationService: {
    getSchemaVersion: vi.fn().mockResolvedValue(1),
  },
  getExpectedSchemaVersion: vi.fn().mockReturnValue(1),
}));

vi.mock('../../../../src/services/featureFlagService', () => ({
  featureFlagService: {
    reconcileAfterRestore: featureRuntimeMocks.reconcileAfterRestore,
  },
}));

vi.mock('../../../../src/utils/encryption', () => ({
  isEncrypted: vi.fn().mockReturnValue(false),
  decrypt: vi.fn().mockImplementation((v) => v),
}));
