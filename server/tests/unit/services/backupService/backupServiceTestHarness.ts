import { vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  CACHE_TABLES,
  EPHEMERAL_TABLES,
  TABLE_ORDER,
} from '../../../../src/services/backupService/constants';
import { camelToSnakeCase } from '../../../../src/services/backupService/serialization';

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

const postRestoreMocks = vi.hoisted(() => ({
  forceSyncConfig: vi.fn().mockResolvedValue(true),
  walletCacheClear: vi.fn().mockResolvedValue(undefined),
  priceCacheClear: vi.fn().mockResolvedValue(undefined),
  feeCacheClear: vi.fn().mockResolvedValue(undefined),
  walletLogBufferClearAll: vi.fn(),
  priceServiceClearCache: vi.fn().mockResolvedValue(undefined),
  distributedEventBusEmit: vi.fn(),
  resetNodeClient: vi.fn().mockResolvedValue(undefined),
  reloadElectrumServers: vi.fn().mockResolvedValue(undefined),
  publishElectrumConfigChange: vi.fn().mockResolvedValue(undefined),
  clearTransporterCache: vi.fn(),
  disconnectWebSocketUser: vi.fn().mockResolvedValue(undefined),
}));

export function getMockFeatureRuntimeReconcile() {
  return featureRuntimeMocks.reconcileAfterRestore;
}

export function getPostRestoreMocks() {
  return postRestoreMocks;
}

export function resetPostRestoreMocks(): void {
  postRestoreMocks.forceSyncConfig.mockReset().mockResolvedValue(true);
  postRestoreMocks.walletCacheClear.mockReset().mockResolvedValue(undefined);
  postRestoreMocks.priceCacheClear.mockReset().mockResolvedValue(undefined);
  postRestoreMocks.feeCacheClear.mockReset().mockResolvedValue(undefined);
  postRestoreMocks.walletLogBufferClearAll.mockReset();
  postRestoreMocks.priceServiceClearCache.mockReset().mockResolvedValue(undefined);
  postRestoreMocks.distributedEventBusEmit.mockReset();
  postRestoreMocks.resetNodeClient.mockReset().mockResolvedValue(undefined);
  postRestoreMocks.reloadElectrumServers.mockReset().mockResolvedValue(undefined);
  postRestoreMocks.publishElectrumConfigChange.mockReset().mockResolvedValue(undefined);
  postRestoreMocks.clearTransporterCache.mockReset();
  postRestoreMocks.disconnectWebSocketUser.mockReset().mockResolvedValue(undefined);
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
  'addressSubscriptionCheckpoint',
] as const;

const backupPrisma = mockPrismaClient as Record<string, unknown>;
for (const modelName of backupOnlyModelNames) {
  backupPrisma[modelName] ??= createBackupModelMock();
}

export function getBackupOnlyModelMock(modelName: typeof backupOnlyModelNames[number]) {
  return backupPrisma[modelName] as ReturnType<typeof createBackupModelMock>;
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

vi.mock('../../../../src/services/ai/config', () => ({
  forceSyncConfig: postRestoreMocks.forceSyncConfig,
}));

vi.mock('../../../../src/services/cache', () => ({
  walletCache: { clear: postRestoreMocks.walletCacheClear },
  priceCache: { clear: postRestoreMocks.priceCacheClear },
  feeCache: { clear: postRestoreMocks.feeCacheClear },
}));

vi.mock('../../../../src/services/walletLogBuffer', () => ({
  walletLogBuffer: { clearAll: postRestoreMocks.walletLogBufferClearAll },
}));

vi.mock('../../../../src/services/price', () => ({
  getPriceService: () => ({ clearCache: postRestoreMocks.priceServiceClearCache }),
}));

vi.mock('../../../../src/infrastructure', () => ({
  getDistributedEventBus: () => ({ emit: postRestoreMocks.distributedEventBusEmit }),
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  resetNodeClient: postRestoreMocks.resetNodeClient,
}));

vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  reloadElectrumServers: postRestoreMocks.reloadElectrumServers,
}));

vi.mock('../../../../src/services/bitcoin/electrumConfigChanges', () => ({
  publishElectrumConfigChange: postRestoreMocks.publishElectrumConfigChange,
}));

vi.mock('../../../../src/services/email/emailService', () => ({
  clearTransporterCache: postRestoreMocks.clearTransporterCache,
}));

vi.mock('../../../../src/services/websocketAuthorizationInvalidation', () => ({
  disconnectWebSocketUser: postRestoreMocks.disconnectWebSocketUser,
}));
