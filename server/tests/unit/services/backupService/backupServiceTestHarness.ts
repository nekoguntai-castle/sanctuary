import { vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  CACHE_TABLES,
  EPHEMERAL_TABLES,
  TABLE_ORDER,
} from '../../../../src/services/backupService/constants';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';

const createBackupModelMock = () => ({
  findMany: vi.fn().mockResolvedValue([]),
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
});

const backupOnlyModelNames = [
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

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/migrationService', () => ({
  migrationService: {
    getSchemaVersion: vi.fn().mockResolvedValue(1),
  },
  getExpectedSchemaVersion: vi.fn().mockReturnValue(1),
}));

vi.mock('../../../../src/utils/encryption', () => ({
  isEncrypted: vi.fn().mockReturnValue(false),
  decrypt: vi.fn().mockImplementation((v) => v),
}));
