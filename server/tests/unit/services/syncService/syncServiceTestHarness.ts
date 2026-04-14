import { afterEach, beforeEach, vi } from 'vitest';
/**
 * Sync Service Unit Tests
 *
 * Tests for wallet synchronization service including:
 * - Queue management
 * - Concurrent sync handling
 * - Retry logic
 * - Error handling
 * - Real-time subscriptions
 */

// Use vi.hoisted to define mocks that are used in vi.mock factories
const {
  mockPrismaClient,
  mockSyncWallet,
  mockUpdateTransactionConfirmations,
  mockPopulateMissingTransactionFields,
  mockGetBlockHeight,
  mockSetCachedBlockHeight,
  mockElectrumClient,
  mockGetNodeClient,
  mockGetElectrumClientIfActive,
  mockNotificationService,
  mockAcquireLock,
  mockExtendLock,
  mockReleaseLock,
  mockWithLock,
  mockGetWorkerHealthStatus,
} = vi.hoisted(() => ({
  mockPrismaClient: {
    wallet: {
      findUnique: vi.fn<any>(),
      findMany: vi.fn<any>(),
      update: vi.fn<any>(),
      updateMany: vi.fn<any>(),
    },
    address: {
      findMany: vi.fn<any>(),
      findFirst: vi.fn<any>(),
    },
    transaction: {
      findMany: vi.fn<any>(),
      findFirst: vi.fn<any>(),
    },
    uTXO: {
      aggregate: vi.fn<any>(),
    },
    refreshToken: {
      findMany: vi.fn<any>(),
    },
    $transaction: vi.fn<any>(),
  },
  mockSyncWallet: vi.fn<any>(),
  mockUpdateTransactionConfirmations: vi.fn<any>(),
  mockPopulateMissingTransactionFields: vi.fn<any>(),
  mockGetBlockHeight: vi.fn<any>(),
  mockSetCachedBlockHeight: vi.fn<any>(),
  mockElectrumClient: {
    getServerVersion: vi.fn<any>(),
    subscribeHeaders: vi.fn<any>(),
    subscribeAddress: vi.fn<any>(),
    subscribeAddressBatch: vi.fn<any>(),
    unsubscribeAddress: vi.fn<any>(),
    on: vi.fn<any>(),
    removeAllListeners: vi.fn<any>(),
  },
  mockGetNodeClient: vi.fn<any>(),
  mockGetElectrumClientIfActive: vi.fn<any>(),
  mockNotificationService: {
    broadcastSyncStatus: vi.fn<any>(),
    broadcastBalanceUpdate: vi.fn<any>(),
    broadcastNewBlock: vi.fn<any>(),
    broadcastConfirmationUpdate: vi.fn<any>(),
    broadcastTransactionNotification: vi.fn<any>(),
  },
  mockAcquireLock: vi.fn<any>(),
  mockExtendLock: vi.fn<any>(),
  mockReleaseLock: vi.fn<any>(),
  mockWithLock: vi.fn<any>().mockImplementation(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => {
    const result = await fn();
    return { success: true, result };
  }),
  mockGetWorkerHealthStatus: vi.fn<any>().mockReturnValue({ healthy: false }),
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock repositories used by sync service modules
vi.mock('../../../../src/repositories', () => ({
  walletRepository: {
    findByUserId: (...args: unknown[]) => mockPrismaClient.wallet.findMany(...args),
    findByIdWithSelect: (id: string, select: unknown) => mockPrismaClient.wallet.findUnique({ where: { id }, select }),
    findById: (id: string) => mockPrismaClient.wallet.findUnique({ where: { id } }),
    findNetwork: (id: string) => mockPrismaClient.wallet.findUnique({ where: { id }, select: { network: true } }).then((w: any) => w?.network ?? null),
    update: (id: string, data: unknown) => mockPrismaClient.wallet.update({ where: { id }, data }),
    updateSyncState: (id: string, state: unknown) => mockPrismaClient.wallet.update({ where: { id }, data: state }),
    resetAllStuckSyncFlags: () => mockPrismaClient.wallet.updateMany({ where: { syncInProgress: true }, data: { syncInProgress: false } }).then((r: any) => r.count),
    findStuckSyncing: () => mockPrismaClient.wallet.findMany({ where: { syncInProgress: true }, select: { id: true, name: true } }),
    findStale: (opts: any) => mockPrismaClient.wallet.findMany({
      where: { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - opts.staleThresholdMs) } }], syncInProgress: false },
      select: { id: true },
    }),
  },
  addressRepository: {
    findAddressStrings: (walletId: string) => mockPrismaClient.address.findMany({ where: { walletId }, select: { address: true } }).then((addrs: any[]) => addrs.map((a: any) => a.address)),
    findByWalletId: (walletId: string) => mockPrismaClient.address.findMany({ where: { walletId } }),
    findAllWithWalletNetwork: () => mockPrismaClient.address.findMany({ select: { address: true, walletId: true } }),
    findByAddress: (address: string) => mockPrismaClient.address.findFirst({ where: { address }, select: { walletId: true } }),
  },
  transactionRepository: {
    findWalletIdsWithPendingConfirmations: (threshold: number) =>
      mockPrismaClient.transaction.findMany({ where: { confirmations: { lt: threshold } }, select: { walletId: true }, distinct: ['walletId'] })
        .then((results: any[]) => results.map((r: any) => r.walletId)),
  },
  utxoRepository: {
    getConfirmedUnconfirmedBalance: (walletId: string) =>
      Promise.all([
        mockPrismaClient.uTXO.aggregate({ where: { walletId, spent: false, blockHeight: { not: null } }, _sum: { amount: true } }),
        mockPrismaClient.uTXO.aggregate({ where: { walletId, spent: false, blockHeight: null }, _sum: { amount: true } }),
      ]).then(([confirmed, unconfirmed]: any[]) => ({
        confirmed: Number(confirmed._sum.amount || 0),
        unconfirmed: Number(unconfirmed._sum.amount || 0),
      })),
  },
}));

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock config
vi.mock('../../../../src/config', () => ({
  getConfig: () => ({
    sync: {
      intervalMs: 60000,
      confirmationUpdateIntervalMs: 30000,
      staleThresholdMs: 300000,
      maxConcurrentSyncs: 5,
      maxRetryAttempts: 3,
      retryDelaysMs: [1000, 5000, 15000],
      maxSyncDurationMs: 120000,
      transactionBatchSize: 100,
      electrumSubscriptionsEnabled: true,
      workerHealthPollIntervalMs: 30000,
    },
    bitcoin: {
      network: 'testnet',
    },
  }),
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  syncWallet: mockSyncWallet,
  updateTransactionConfirmations: mockUpdateTransactionConfirmations,
  populateMissingTransactionFields: mockPopulateMissingTransactionFields,
  getBlockHeight: mockGetBlockHeight,
  setCachedBlockHeight: mockSetCachedBlockHeight,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: mockGetNodeClient,
  getElectrumClientIfActive: mockGetElectrumClientIfActive,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  getNotificationService: () => mockNotificationService,
  walletLog: vi.fn(),
}));

// Mock event service
vi.mock('../../../../src/services/eventService', () => ({
  eventService: {
    emitNewBlock: vi.fn(),
    emitWalletSyncStarted: vi.fn(),
    emitWalletSynced: vi.fn(),
    emitWalletSyncFailed: vi.fn(),
    emitTransactionConfirmed: vi.fn(),
  },
}));

vi.mock('../../../../src/infrastructure', () => ({
  acquireLock: mockAcquireLock,
  extendLock: mockExtendLock,
  releaseLock: mockReleaseLock,
  withLock: mockWithLock,
}));

// Mock dead letter queue
vi.mock('../../../../src/services/deadLetterQueue', () => ({
  recordSyncFailure: vi.fn(),
}));

// Mock metrics
vi.mock('../../../../src/observability/metrics', () => ({
  walletSyncsTotal: { inc: vi.fn() },
  walletSyncDuration: { observe: vi.fn() },
  syncPollingModeTransitions: { inc: vi.fn() },
}));

// Mock async utilities
vi.mock('../../../../src/utils/async', () => ({
  withTimeout: vi.fn().mockImplementation((promise) => promise),
}));

// Mock worker health — default to unhealthy so existing tests keep in-process polling
vi.mock('../../../../src/services/workerHealth', () => ({
  getWorkerHealthStatus: mockGetWorkerHealthStatus,
}));

// Import after mocks
import SyncService, { getSyncService } from '../../../../src/services/syncService';

export interface SyncServiceTestContext {
  syncService: SyncService;
}

export function resetSyncServiceState(syncService: SyncService): void {
  syncService['isRunning'] = false;
  syncService['syncQueue'] = [];
  syncService['activeSyncs'] = new Set();
  syncService['activeLocks'] = new Map();
  syncService['addressToWalletMap'] = new Map();
  syncService['pendingRetries'] = new Map();
  syncService['subscriptionLock'] = null;
  syncService['subscriptionLockRefresh'] = null;
  syncService['subscriptionsEnabled'] = false;
  syncService['subscriptionOwnership'] = 'disabled';

  // Clear polling timers from previous tests
  if (syncService['syncInterval']) { clearInterval(syncService['syncInterval']); syncService['syncInterval'] = null; }
  if (syncService['confirmationInterval']) { clearInterval(syncService['confirmationInterval']); syncService['confirmationInterval'] = null; }
  if (syncService['workerHealthPollTimer']) { clearInterval(syncService['workerHealthPollTimer']); syncService['workerHealthPollTimer'] = null; }
  if (syncService['reconciliationInterval']) { clearInterval(syncService['reconciliationInterval']); syncService['reconciliationInterval'] = null; }
}

export function setDefaultSyncServiceMocks(): void {
  // Default worker health: unhealthy (in-process polling)
  mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });

  // Default mock implementations
  mockAcquireLock.mockResolvedValue({
    key: 'electrum:subscriptions',
    token: 'test-token',
    expiresAt: Date.now() + 60000,
    isLocal: true,
  });
  mockExtendLock.mockImplementation(async (lock) => lock);
  mockReleaseLock.mockResolvedValue(undefined);
  mockSyncWallet.mockResolvedValue({ addresses: 10, transactions: 5, utxos: 3 });
  mockPopulateMissingTransactionFields.mockResolvedValue({ updated: 0, confirmationUpdates: [] });
  mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
  mockPrismaClient.wallet.update.mockResolvedValue({});
  mockPrismaClient.address.findMany.mockResolvedValue([]);
  mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
  mockElectrumClient.subscribeHeaders.mockResolvedValue({ height: 100000 });
  mockElectrumClient.subscribeAddressBatch.mockResolvedValue(new Map());
  mockElectrumClient.getServerVersion.mockResolvedValue({ server: 'test', protocol: '1.4' });
  mockGetNodeClient.mockResolvedValue(mockElectrumClient);
  mockGetElectrumClientIfActive.mockResolvedValue(mockElectrumClient);
}

export function setupSyncServiceTestHooks(): SyncServiceTestContext {
  const context = {} as SyncServiceTestContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Get fresh instance
    context.syncService = getSyncService();
    resetSyncServiceState(context.syncService);
    setDefaultSyncServiceMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Clean up service
    await context.syncService.stop();
  });

  return context;
}

export function setupSyncServiceErrorHandlingTestHooks(): SyncServiceTestContext {
  const context = {} as SyncServiceTestContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context.syncService = getSyncService();
    context.syncService['isRunning'] = false;
    context.syncService['syncQueue'] = [];
    context.syncService['activeSyncs'] = new Set();
    context.syncService['activeLocks'] = new Map();

    mockAcquireLock.mockResolvedValue({ id: 'lock-1', resource: 'test' });
    mockReleaseLock.mockResolvedValue(undefined);
    mockPrismaClient.wallet.update.mockResolvedValue({});
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
  });

  afterEach(async () => {
    await context.syncService.stop();
  });

  return context;
}

export function getSyncServiceInstanceForTest(): SyncService {
  return getSyncService();
}

export {
  mockAcquireLock,
  mockElectrumClient,
  mockExtendLock,
  mockGetElectrumClientIfActive,
  mockGetNodeClient,
  mockGetWorkerHealthStatus,
  mockNotificationService,
  mockPopulateMissingTransactionFields,
  mockPrismaClient,
  mockReleaseLock,
  mockSetCachedBlockHeight,
  mockSyncWallet,
  mockUpdateTransactionConfirmations,
  mockWithLock,
};
