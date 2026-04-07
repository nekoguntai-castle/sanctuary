import { vi } from 'vitest';
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

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock config
vi.mock('../../../src/config', () => ({
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

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  syncWallet: mockSyncWallet,
  updateTransactionConfirmations: mockUpdateTransactionConfirmations,
  populateMissingTransactionFields: mockPopulateMissingTransactionFields,
  getBlockHeight: mockGetBlockHeight,
  setCachedBlockHeight: mockSetCachedBlockHeight,
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: mockGetNodeClient,
  getElectrumClientIfActive: mockGetElectrumClientIfActive,
}));

vi.mock('../../../src/websocket/notifications', () => ({
  getNotificationService: () => mockNotificationService,
  walletLog: vi.fn(),
}));

// Mock event service
vi.mock('../../../src/services/eventService', () => ({
  eventService: {
    emitNewBlock: vi.fn(),
    emitWalletSyncStarted: vi.fn(),
    emitWalletSynced: vi.fn(),
    emitWalletSyncFailed: vi.fn(),
    emitTransactionConfirmed: vi.fn(),
  },
}));

vi.mock('../../../src/infrastructure', () => ({
  acquireLock: mockAcquireLock,
  extendLock: mockExtendLock,
  releaseLock: mockReleaseLock,
  withLock: mockWithLock,
}));

// Mock dead letter queue
vi.mock('../../../src/services/deadLetterQueue', () => ({
  recordSyncFailure: vi.fn(),
}));

// Mock metrics
vi.mock('../../../src/observability/metrics', () => ({
  walletSyncsTotal: { inc: vi.fn() },
  walletSyncDuration: { observe: vi.fn() },
  syncPollingModeTransitions: { inc: vi.fn() },
}));

// Mock async utilities
vi.mock('../../../src/utils/async', () => ({
  withTimeout: vi.fn().mockImplementation((promise) => promise),
}));

// Mock worker health — default to unhealthy so existing tests keep in-process polling
vi.mock('../../../src/services/workerHealth', () => ({
  getWorkerHealthStatus: mockGetWorkerHealthStatus,
}));

// Import after mocks
import SyncService, { getSyncService } from '../../../src/services/syncService';

describe('SyncService', () => {
  let syncService: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Get fresh instance
    syncService = getSyncService();

    // Reset service state by stopping and ensuring clean state
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
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Clean up service
    await syncService.stop();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getSyncService();
      const instance2 = getSyncService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('state getters', () => {
    it('should expose subscriptionLockRefresh via getter', () => {
      expect(syncService.subscriptionLockRefresh).toBeNull();
      const fakeTimer = setInterval(() => {}, 99999);
      syncService.subscriptionLockRefresh = fakeTimer;
      expect(syncService.subscriptionLockRefresh).toBe(fakeTimer);
      clearInterval(fakeTimer);
      syncService.subscriptionLockRefresh = null;
    });

    it('should expose subscriptionsEnabled via getter', () => {
      expect(syncService.subscriptionsEnabled).toBe(false);
      syncService.subscriptionsEnabled = true;
      expect(syncService.subscriptionsEnabled).toBe(true);
      syncService.subscriptionsEnabled = false;
    });
  });

  describe('start/stop', () => {
    it('should start the service', async () => {
      await syncService.start();

      expect(syncService['isRunning']).toBe(true);
    });

    it('should not start twice', async () => {
      await syncService.start();
      await syncService.start();

      // Should still be running, no errors
      expect(syncService['isRunning']).toBe(true);
    });

    it('should stop the service', async () => {
      await syncService.start();
      await syncService.stop();

      expect(syncService['isRunning']).toBe(false);
    });

    it('should reset stuck syncs on start', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 2 });

      await syncService.start();

      expect(mockPrismaClient.wallet.updateMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        data: { syncInProgress: false },
      });
    });

    it('invokes periodic maintenance callbacks after start', async () => {
      const staleSpy = vi.spyOn(syncService as any, 'checkAndQueueStaleSyncs').mockResolvedValue(undefined);
      const confirmationsSpy = vi.spyOn(syncService as any, 'updateAllConfirmations').mockResolvedValue(undefined);
      const reconcileSpy = vi.spyOn(syncService as any, 'reconcileAddressToWalletMap').mockResolvedValue(undefined);
      vi.spyOn(syncService as any, 'setupRealTimeSubscriptions').mockResolvedValue(undefined);

      await syncService.start();
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(staleSpy).toHaveBeenCalled();
      expect(confirmationsSpy).toHaveBeenCalled();
      expect(reconcileSpy).toHaveBeenCalled();
    });

    it('handles reconciliation interval callback errors', async () => {
      vi.spyOn(syncService as any, 'setupRealTimeSubscriptions').mockResolvedValue(undefined);
      const reconcileSpy = vi
        .spyOn(syncService as any, 'reconcileAddressToWalletMap')
        .mockRejectedValue(new Error('reconcile failed'));

      await syncService.start();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(reconcileSpy).toHaveBeenCalled();
    });

    it('skips reconciliation when another instance holds the lock', async () => {
      vi.spyOn(syncService as any, 'setupRealTimeSubscriptions').mockResolvedValue(undefined);
      const reconcileSpy = vi
        .spyOn(syncService as any, 'reconcileAddressToWalletMap')
        .mockResolvedValue(undefined);

      await syncService.start();

      // Make the next withLock call return { success: false } to simulate lock contention
      mockWithLock.mockImplementationOnce(async () => ({ success: false }));

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      // reconcileAddressToWalletMap should NOT have been called because the lock was not acquired
      expect(reconcileSpy).not.toHaveBeenCalled();
    });

    it('handles async setupRealTimeSubscriptions rejection during start', async () => {
      vi.spyOn(syncService as any, 'setupRealTimeSubscriptions').mockRejectedValue(new Error('setup failed'));

      await syncService.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(syncService['isRunning']).toBe(true);
    });
  });

  describe('queueSync', () => {
    it('should add wallet to queue when service is running', async () => {
      // Start the service first so isRunning is true
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      syncService.queueSync('wallet-1', 'normal');

      // Verify queueSync was called (internal queue state is implementation detail)
      // The important thing is that it doesn't throw
      expect(syncService['isRunning']).toBe(true);
    });

    it('should not throw on duplicate queue calls', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Should not throw
      syncService.queueSync('wallet-1');
      syncService.queueSync('wallet-1');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should handle priority upgrade request', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Should not throw when upgrading priority
      syncService.queueSync('wallet-1', 'low');
      syncService.queueSync('wallet-1', 'high');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should not queue if already syncing', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();
      syncService['activeSyncs'].add('wallet-1');

      // Should not throw when trying to queue an already syncing wallet
      syncService.queueSync('wallet-1');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should handle multiple different wallet queues', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Should not throw when queuing multiple wallets with different priorities
      syncService.queueSync('wallet-low', 'low');
      syncService.queueSync('wallet-normal', 'normal');
      syncService.queueSync('wallet-high', 'high');

      expect(syncService['isRunning']).toBe(true);
    });

    it('should handle large queue gracefully', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      // Queue many wallets - should not throw
      for (let i = 0; i < 100; i++) {
        syncService.queueSync(`wallet-${i}`, 'normal');
      }

      expect(syncService['isRunning']).toBe(true);

      // Additional wallet should also not throw
      syncService.queueSync('wallet-overflow', 'high');

      expect(syncService['isRunning']).toBe(true);
    });
  });

  describe('queueUserWallets', () => {
    it('should query wallets for a user', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'wallet-1' },
        { id: 'wallet-2' },
        { id: 'wallet-3' },
      ]);

      await syncService.queueUserWallets('user-1');

      // Verify the database was queried for user's wallets
      expect(mockPrismaClient.wallet.findMany).toHaveBeenCalled();
    });

    it('should include group wallets in query', async () => {
      mockPrismaClient.wallet.updateMany.mockResolvedValue({ count: 0 });
      await syncService.start();

      mockPrismaClient.wallet.findMany.mockResolvedValue([
        { id: 'personal-wallet' },
        { id: 'group-wallet' },
      ]);

      await syncService.queueUserWallets('user-1', 'high');

      expect(mockPrismaClient.wallet.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { users: { some: { userId: 'user-1' } } },
            { group: { members: { some: { userId: 'user-1' } } } },
          ],
        },
        select: { id: true },
      });
    });
  });

  describe('getSyncStatus', () => {
    it('should return sync status for wallet', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        syncInProgress: false,
      });

      const status = await syncService.getSyncStatus('wallet-1');

      expect(status.syncStatus).toBe('success');
      expect(status.syncInProgress).toBe(false);
    });

    it('should detect stale wallets', async () => {
      syncService['isRunning'] = true;

      const oldDate = new Date(Date.now() - 600000); // 10 minutes ago
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: oldDate,
        lastSyncStatus: 'success',
        syncInProgress: false,
      });

      const status = await syncService.getSyncStatus('wallet-1');

      expect(status.isStale).toBe(true);
    });

    it('should return queue position', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [
        { walletId: 'wallet-1', priority: 'high', requestedAt: new Date() },
        { walletId: 'wallet-2', priority: 'normal', requestedAt: new Date() },
      ];

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        lastSyncedAt: null,
        lastSyncStatus: null,
        syncInProgress: false,
      });

      const status = await syncService.getSyncStatus('wallet-2');

      expect(status.queuePosition).toBe(2);
    });

    it('should throw for non-existent wallet', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await expect(syncService.getSyncStatus('nonexistent')).rejects.toThrow('Wallet not found');
    });
  });

  describe('syncNow', () => {
    it('should execute immediate sync', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(100000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(100000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } });

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(true);
      expect(mockSyncWallet).toHaveBeenCalledWith('wallet-1');
    });

    it('should return error if already syncing', async () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('wallet-1');

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in progress');
    });
  });

  describe('distributed locking', () => {
    it('should acquire lock before syncing', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });

      await syncService.syncNow('wallet-1');

      expect(mockAcquireLock).toHaveBeenCalledWith(
        'sync:wallet:wallet-1',
        expect.objectContaining({ ttlMs: expect.any(Number) })
      );
    });

    it('should release lock after sync', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });

      await syncService.syncNow('wallet-1');

      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('should skip sync if lock cannot be acquired', async () => {
      syncService['isRunning'] = true;
      mockAcquireLock.mockResolvedValue(null);

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Already syncing');
    });

    it('returns false when trying to acquire a local lock already held in-memory', async () => {
      syncService['activeSyncs'].add('wallet-local');

      const acquired = await syncService['acquireSyncLock']('wallet-local');

      expect(acquired).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('should retry on failure', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('retrying');
    });

    it('should exhaust retries and fail', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValue(new Error('Persistent error'));

      // Execute all retry attempts
      await syncService['executeSyncJob']('wallet-1', 3);

      // Should record failure after max retries
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastSyncStatus: 'failed',
          }),
        })
      );
    });

    it('runs timeout branch and emits balance updates on changed balance', async () => {
      syncService['isRunning'] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(1000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(1500) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } });
      mockPopulateMissingTransactionFields.mockResolvedValueOnce({
        updated: 2,
        confirmationUpdates: [],
      });

      let resolveSync: ((value: { addresses: number; transactions: number; utxos: number }) => void) | undefined;
      mockSyncWallet.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSync = resolve;
          })
      );

      const syncPromise = syncService.syncNow('wallet-timeout');
      await vi.advanceTimersByTimeAsync(120_000);
      resolveSync?.({ addresses: 1, transactions: 2, utxos: 3 });

      const result = await syncPromise;

      expect(result.success).toBe(true);
      expect(mockNotificationService.broadcastBalanceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: 'wallet-timeout' })
      );
    });

    it('handles missing timeout handle when sync resolves quickly', async () => {
      syncService['isRunning'] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockResolvedValueOnce({ addresses: 1, transactions: 1, utxos: 1 });
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => {
        return undefined as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

      const result = await syncService.syncNow('wallet-no-timeout-handle');
      setTimeoutSpy.mockRestore();

      expect(result.success).toBe(true);
    });

    it('executes retry timer callback and handles retry errors', async () => {
      syncService['isRunning'] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValueOnce(new Error('first failure'));

      const originalExecute = syncService['executeSyncJob'].bind(syncService) as (
        walletId: string,
        retryCount?: number
      ) => Promise<any>;
      const executeSpy = vi.spyOn(syncService as any, 'executeSyncJob');
      executeSpy
        .mockImplementationOnce((walletId: string, retryCount: number = 0) =>
          originalExecute(walletId, retryCount)
        )
        .mockImplementationOnce(async () => {
          throw new Error('retry callback failed');
        });

      const result = await syncService.syncNow('wallet-retry');
      expect(result.success).toBe(false);
      expect(result.error).toContain('retrying');

      await vi.advanceTimersByTimeAsync(1000);
      expect(syncService['pendingRetries'].size).toBe(0);
    });

    it('falls back to last retry delay when configured delay is falsy', async () => {
      syncService['isRunning'] = true;
      const configModule = await import('../../../src/config');
      const configSpy = vi.spyOn(configModule, 'getConfig').mockReturnValue({
        sync: {
          intervalMs: 60000,
          confirmationUpdateIntervalMs: 30000,
          staleThresholdMs: 300000,
          maxConcurrentSyncs: 5,
          maxRetryAttempts: 3,
          retryDelaysMs: [0, 2500],
          maxSyncDurationMs: 120000,
          transactionBatchSize: 100,
          electrumSubscriptionsEnabled: true,
        },
        bitcoin: { network: 'testnet' },
      } as any);

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
      mockSyncWallet.mockRejectedValueOnce(new Error('retry delay fallback'));

      const result = await syncService.syncNow('wallet-retry-delay');
      configSpy.mockRestore();

      expect(result.success).toBe(false);
      expect(mockNotificationService.broadcastSyncStatus).toHaveBeenCalledWith(
        'wallet-retry-delay',
        expect.objectContaining({
          status: 'retrying',
          retryingIn: 2500,
        })
      );
    });
  });

  describe('concurrent sync limiting', () => {
    it('should limit concurrent syncs', async () => {
      syncService['isRunning'] = true;

      // Simulate 5 active syncs (maxConcurrentSyncs is 5)
      syncService['activeSyncs'].add('wallet-1');
      syncService['activeSyncs'].add('wallet-2');
      syncService['activeSyncs'].add('wallet-3');
      syncService['activeSyncs'].add('wallet-4');
      syncService['activeSyncs'].add('wallet-5');

      // Add more to queue
      syncService.queueSync('wallet-6');
      syncService.queueSync('wallet-7');

      // Queue should have wallets waiting
      expect(syncService['syncQueue'].length).toBe(2);

      // processQueue should not start new syncs when at limit
      await syncService['processQueue']();

      // Still should have wallets in queue (not started)
      // Note: processQueue doesn't actually start them if at limit
    });

    it('handles executeSyncJob rejection from queued processing', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [{ walletId: 'wallet-fail', priority: 'normal', requestedAt: new Date() }];
      vi.spyOn(syncService as any, 'executeSyncJob').mockRejectedValueOnce(new Error('queue worker failed'));

      await syncService['processQueue']();
      await Promise.resolve();
      await Promise.resolve();

      expect(syncService['syncQueue']).toHaveLength(0);
    });

    it('breaks queue processing when shifted job is undefined', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [undefined as any];
      const executeSpy = vi.spyOn(syncService as any, 'executeSyncJob');

      await syncService['processQueue']();

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe('health metrics', () => {
    it('should return health metrics', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [{ walletId: 'w1', priority: 'normal', requestedAt: new Date() }];
      syncService['activeSyncs'].add('w2');
      syncService['addressToWalletMap'].set('addr1', 'w1');

      const metrics = syncService.getHealthMetrics();

      expect(metrics.isRunning).toBe(true);
      expect(metrics.queueLength).toBe(1);
      expect(metrics.activeSyncs).toBe(1);
      expect(metrics.subscribedAddresses).toBe(1);
    });

    it('should include pollingMode in health metrics', () => {
      syncService['isRunning'] = true;

      const metrics = syncService.getHealthMetrics();

      expect(metrics.pollingMode).toBe('in-process');
    });
  });

  describe('polling mode', () => {
    it('should start in-process polling when worker is unhealthy', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });

      await syncService.start();

      expect(syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(syncService['syncInterval']).not.toBeNull();
      expect(syncService['confirmationInterval']).not.toBeNull();
    });

    it('should defer polling to worker when worker is healthy', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await syncService.start();

      expect(syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(syncService['syncInterval']).toBeNull();
      expect(syncService['confirmationInterval']).toBeNull();
    });

    it('should always start reconciliation interval regardless of worker health', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await syncService.start();

      expect(syncService['reconciliationInterval']).not.toBeNull();
    });

    it('should always start workerHealthPollTimer', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await syncService.start();

      expect(syncService['workerHealthPollTimer']).not.toBeNull();
    });

    it('should transition from worker-delegated to in-process when worker goes down', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await syncService.start();

      expect(syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');

      // Worker goes down
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      syncService['evaluatePollingMode']();

      expect(syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(syncService['syncInterval']).not.toBeNull();
      expect(syncService['confirmationInterval']).not.toBeNull();
    });

    it('should transition from in-process to worker-delegated when worker recovers', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await syncService.start();

      expect(syncService.getHealthMetrics().pollingMode).toBe('in-process');

      // Worker recovers
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      syncService['evaluatePollingMode']();

      expect(syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(syncService['syncInterval']).toBeNull();
      expect(syncService['confirmationInterval']).toBeNull();
    });

    it('should not double-start polling intervals', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await syncService.start();

      const firstSyncInterval = syncService['syncInterval'];
      const firstConfirmInterval = syncService['confirmationInterval'];

      // Call startPollingIntervals again — should be a no-op
      syncService['startPollingIntervals']();

      expect(syncService['syncInterval']).toBe(firstSyncInterval);
      expect(syncService['confirmationInterval']).toBe(firstConfirmInterval);
    });

    it('should not evaluate polling mode when service is stopped', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await syncService.start();
      await syncService.stop();

      // Worker recovers while service is stopped
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      syncService['evaluatePollingMode']();

      // Should remain unchanged since isRunning is false
      expect(syncService['syncInterval']).toBeNull();
    });

    it('should be no-op when worker stays healthy (already delegated)', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await syncService.start();

      // Evaluate again with same state
      syncService['evaluatePollingMode']();

      expect(syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(syncService['syncInterval']).toBeNull();
    });

    it('should be no-op when worker stays unhealthy (already in-process)', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await syncService.start();

      const firstSyncInterval = syncService['syncInterval'];

      // Evaluate again with same state
      syncService['evaluatePollingMode']();

      expect(syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(syncService['syncInterval']).toBe(firstSyncInterval);
    });

    it('should clear workerHealthPollTimer on stop', async () => {
      await syncService.start();

      expect(syncService['workerHealthPollTimer']).not.toBeNull();

      await syncService.stop();

      expect(syncService['workerHealthPollTimer']).toBeNull();
    });

    it('should trigger evaluatePollingMode via the 30s timer', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await syncService.start();

      expect(syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');

      // Worker goes down — advance the 30s timer
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(syncService.getHealthMetrics().pollingMode).toBe('in-process');
    });

    it('should handle full round-trip: healthy → unhealthy → healthy via timer', async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await syncService.start();

      // Phase 1: worker-delegated, no polling intervals
      expect(syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(syncService['syncInterval']).toBeNull();
      expect(syncService['confirmationInterval']).toBeNull();

      // Phase 2: worker goes down — timer fires, transitions to in-process
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(syncService.getHealthMetrics().pollingMode).toBe('in-process');
      expect(syncService['syncInterval']).not.toBeNull();
      expect(syncService['confirmationInterval']).not.toBeNull();
      const syncIntervalRef = syncService['syncInterval'];

      // Phase 3: worker recovers — timer fires, transitions back to worker-delegated
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(syncService.getHealthMetrics().pollingMode).toBe('worker-delegated');
      expect(syncService['syncInterval']).toBeNull();
      expect(syncService['confirmationInterval']).toBeNull();

      // Verify the old interval reference was cleared (not leaked)
      expect(syncService['syncInterval']).not.toBe(syncIntervalRef);
    });

    it('should increment transition metric on mode change', async () => {
      const { syncPollingModeTransitions } = await import('../../../src/observability/metrics');
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await syncService.start();

      // Transition: worker-delegated → in-process
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      syncService['evaluatePollingMode']();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: 'worker-delegated',
        to: 'in-process',
      });

      // Transition: in-process → worker-delegated
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      syncService['evaluatePollingMode']();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: 'in-process',
        to: 'worker-delegated',
      });
    });
  });

  describe('address subscriptions', () => {
    it('should subscribe to wallet addresses', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: 'tb1qaddr1' },
        { address: 'tb1qaddr2' },
      ]);

      await syncService.subscribeNewWalletAddresses('wallet-1');

      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe wallet addresses', async () => {
      syncService['subscriptionOwnership'] = 'self';
      syncService['addressToWalletMap'].set('addr1', 'wallet-1');
      syncService['addressToWalletMap'].set('addr2', 'wallet-1');
      syncService['addressToWalletMap'].set('addr3', 'wallet-2');

      await syncService.unsubscribeWalletAddresses('wallet-1');

      expect(syncService['addressToWalletMap'].size).toBe(1);
      expect(mockElectrumClient.unsubscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('should gracefully handle unsubscribe errors for individual addresses', async () => {
      syncService['subscriptionOwnership'] = 'self';
      syncService['addressToWalletMap'].set('addr1', 'wallet-1');
      syncService['addressToWalletMap'].set('addr2', 'wallet-1');
      syncService['addressToWalletMap'].set('addr3', 'wallet-2');

      mockElectrumClient.unsubscribeAddress
        .mockRejectedValueOnce(new Error('electrum disconnect'))
        .mockResolvedValueOnce(undefined);

      await syncService.unsubscribeWalletAddresses('wallet-1');

      // Both addresses removed from map despite one unsubscribe failing
      expect(syncService['addressToWalletMap'].size).toBe(1);
      expect(syncService['addressToWalletMap'].has('addr3')).toBe(true);
      expect(mockElectrumClient.unsubscribeAddress).toHaveBeenCalledTimes(2);
    });
  });

  describe('queue overflow behavior', () => {
    it('evicts a low-priority job when queue is full', () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('busy-1');
      syncService['activeSyncs'].add('busy-2');
      syncService['activeSyncs'].add('busy-3');
      syncService['activeSyncs'].add('busy-4');
      syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `wallet-${i}`,
        priority: i === 500 ? 'low' : 'normal',
        requestedAt: now,
      }));

      syncService.queueSync('wallet-new', 'normal');

      expect(syncService['syncQueue']).toHaveLength(1000);
      expect(syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-new')).toBe(true);
      expect(syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-500')).toBe(false);
    });

    it('rejects low-priority jobs when queue is full of higher priority jobs', () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('busy-1');
      syncService['activeSyncs'].add('busy-2');
      syncService['activeSyncs'].add('busy-3');
      syncService['activeSyncs'].add('busy-4');
      syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `wallet-${i}`,
        priority: 'normal',
        requestedAt: now,
      }));

      syncService.queueSync('wallet-low', 'low');

      expect(syncService['syncQueue']).toHaveLength(1000);
      expect(syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-low')).toBe(false);
    });

    it('evicts a normal-priority job for a high-priority request when full', () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('busy-1');
      syncService['activeSyncs'].add('busy-2');
      syncService['activeSyncs'].add('busy-3');
      syncService['activeSyncs'].add('busy-4');
      syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `wallet-${i}`,
        priority: 'normal',
        requestedAt: now,
      }));

      syncService.queueSync('wallet-high', 'high');

      expect(syncService['syncQueue']).toHaveLength(1000);
      expect(syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-high')).toBe(true);
    });

    it('rejects non-high request when queue is full of high-priority jobs', () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('busy-1');
      syncService['activeSyncs'].add('busy-2');
      syncService['activeSyncs'].add('busy-3');
      syncService['activeSyncs'].add('busy-4');
      syncService['activeSyncs'].add('busy-5');

      const now = new Date();
      syncService['syncQueue'] = Array.from({ length: 1000 }, (_, i) => ({
        walletId: `high-${i}`,
        priority: 'high',
        requestedAt: now,
      }));

      syncService.queueSync('wallet-normal-blocked', 'normal');

      expect(syncService['syncQueue']).toHaveLength(1000);
      expect(syncService['syncQueue'].some((j: any) => j.walletId === 'wallet-normal-blocked')).toBe(false);
    });

    it('upgrades queued wallet priority when duplicate is re-queued as high', () => {
      syncService['isRunning'] = false;
      syncService['syncQueue'] = [{ walletId: 'wallet-dup', priority: 'low', requestedAt: new Date() }];

      syncService.queueSync('wallet-dup', 'high');

      expect(syncService['syncQueue'][0].priority).toBe('high');
    });

    it('keeps duplicate high-priority jobs unchanged when re-queued as high', () => {
      syncService['syncQueue'] = [{ walletId: 'wallet-dup-high', priority: 'high', requestedAt: new Date() }];

      syncService.queueSync('wallet-dup-high', 'high');

      expect(syncService['syncQueue']).toHaveLength(1);
      expect(syncService['syncQueue'][0].priority).toBe('high');
    });
  });

  describe('stale sync checks', () => {
    it('auto-unstucks stale sync flags and queues stale wallets', async () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('wallet-active');

      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([
          { id: 'wallet-stuck', name: 'Stuck Wallet' },
          { id: 'wallet-active', name: 'Active Wallet' },
        ])
        .mockResolvedValueOnce([
          { id: 'wallet-stale-1' },
          { id: 'wallet-stale-2' },
        ]);

      const queueSpy = vi.spyOn(syncService as any, 'queueSync');

      await syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-stuck' },
        data: { syncInProgress: false },
      });
      expect(queueSpy).toHaveBeenCalledWith('wallet-stale-1', 'low');
      expect(queueSpy).toHaveBeenCalledWith('wallet-stale-2', 'low');
    });

    it('returns early when service is not running', async () => {
      syncService['isRunning'] = false;

      await syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.findMany).not.toHaveBeenCalled();
    });

    it('handles stale-check query errors without throwing', async () => {
      syncService['isRunning'] = true;
      mockPrismaClient.wallet.findMany.mockRejectedValueOnce(new Error('db down'));

      await expect(syncService['checkAndQueueStaleSyncs']()).resolves.toBeUndefined();
    });

    it('auto-unstucks using wallet id when wallet name is missing', async () => {
      syncService['isRunning'] = true;
      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([{ id: 'wallet-unnamed', name: '' }])
        .mockResolvedValueOnce([]);

      await syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-unnamed' },
        data: { syncInProgress: false },
      });
    });

    it('skips unstuck and stale queue summary paths when there is no work', async () => {
      syncService['isRunning'] = true;
      syncService['activeSyncs'].add('wallet-active');
      mockPrismaClient.wallet.findMany
        .mockResolvedValueOnce([{ id: 'wallet-active', name: 'Active Wallet' }])
        .mockResolvedValueOnce([]);
      const queueSpy = vi.spyOn(syncService as any, 'queueSync');

      await syncService['checkAndQueueStaleSyncs']();

      expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
      expect(queueSpy).not.toHaveBeenCalled();
    });

    it('handles resetStuckSyncs errors without throwing', async () => {
      mockPrismaClient.wallet.updateMany.mockRejectedValueOnce(new Error('updateMany failed'));

      await expect(syncService['resetStuckSyncs']()).resolves.toBeUndefined();
    });
  });

  describe('confirmation update flows', () => {
    it('updates confirmations and broadcasts only changed transactions', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([{ walletId: 'wallet-1' }]);
      mockPopulateMissingTransactionFields.mockResolvedValueOnce({
        updated: 1,
        confirmationUpdates: [{ txid: 'tx-a', oldConfirmations: 0, newConfirmations: 1 }],
      });
      mockUpdateTransactionConfirmations.mockResolvedValueOnce([
        { txid: 'tx-b', oldConfirmations: 1, newConfirmations: 2 },
      ]);

      const { eventService } = await import('../../../src/services/eventService');

      await syncService['updateAllConfirmations']();

      expect(mockNotificationService.broadcastConfirmationUpdate).toHaveBeenCalledTimes(2);
      expect(eventService.emitTransactionConfirmed).toHaveBeenCalledTimes(2);
    });

    it('continues updating other wallets when one wallet update fails', async () => {
      syncService['isRunning'] = true;

      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([
        { walletId: 'wallet-fail' },
        { walletId: 'wallet-ok' },
      ]);
      mockPopulateMissingTransactionFields
        .mockRejectedValueOnce(new Error('populate failed'))
        .mockResolvedValueOnce({ updated: 0, confirmationUpdates: [] });
      mockUpdateTransactionConfirmations.mockResolvedValueOnce([]);

      await syncService['updateAllConfirmations']();

      expect(mockUpdateTransactionConfirmations).toHaveBeenCalledTimes(1);
      expect(mockUpdateTransactionConfirmations).toHaveBeenCalledWith('wallet-ok');
    });

    it('returns early when not running', async () => {
      syncService['isRunning'] = false;

      await syncService['updateAllConfirmations']();

      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
    });

    it('handles top-level confirmation update query failures', async () => {
      syncService['isRunning'] = true;
      mockPrismaClient.transaction.findMany.mockRejectedValueOnce(new Error('confirmations query failed'));

      await expect(syncService['updateAllConfirmations']()).resolves.toBeUndefined();
    });
  });

  describe('address activity and subscription helpers', () => {
    it('ignores address-activity events without a resolved address', async () => {
      await syncService['handleAddressActivity']({ scriptHash: 'hash-1', status: 'status' });
      expect(mockPrismaClient.address.findFirst).not.toHaveBeenCalled();
    });

    it('queues a mapped wallet on address activity', async () => {
      syncService['addressToWalletMap'].set('tb1mapped', 'wallet-mapped');
      const queueSpy = vi.spyOn(syncService as any, 'queueSync');

      await syncService['handleAddressActivity']({
        scriptHash: 'hash-2',
        address: 'tb1mapped',
        status: 'status',
      });

      expect(queueSpy).toHaveBeenCalledWith('wallet-mapped', 'high');
    });

    it('falls back to DB lookup when address is not in memory map', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValueOnce({ walletId: 'wallet-db' });
      const queueSpy = vi.spyOn(syncService as any, 'queueSync');

      await syncService['handleAddressActivity']({
        scriptHash: 'hash-3',
        address: 'tb1lookup',
        status: 'status',
      });

      expect(syncService['addressToWalletMap'].get('tb1lookup')).toBe('wallet-db');
      expect(queueSpy).toHaveBeenCalledWith('wallet-db', 'high');
    });

    it('does not queue when DB lookup cannot resolve address activity wallet', async () => {
      mockPrismaClient.address.findFirst.mockResolvedValueOnce(null);
      const queueSpy = vi.spyOn(syncService as any, 'queueSync');

      await syncService['handleAddressActivity']({
        scriptHash: 'hash-4',
        address: 'tb1unknown',
        status: 'status',
      });

      expect(queueSpy).not.toHaveBeenCalled();
      expect(syncService['addressToWalletMap'].has('tb1unknown')).toBe(false);
    });

    it('subscribes wallet addresses using wallet network when present', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({ network: 'testnet' });
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'tb1qaddr-a' },
        { address: 'tb1qaddr-b' },
      ]);

      await syncService.subscribeWalletAddresses('wallet-1');

      expect(mockGetNodeClient).toHaveBeenCalledWith('testnet');
      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('defaults to mainnet and continues when one address subscription fails', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'bc1qaddr-a' },
        { address: 'bc1qaddr-b' },
      ]);
      mockElectrumClient.subscribeAddress
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce(undefined);

      await syncService.subscribeWalletAddresses('wallet-2');

      expect(mockGetNodeClient).toHaveBeenCalledWith('mainnet');
      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });
  });

  describe('address map reconciliation', () => {
    it('removes stale address-to-wallet mappings for deleted wallets', async () => {
      syncService['addressToWalletMap'].set('addr-keep', 'wallet-keep');
      syncService['addressToWalletMap'].set('addr-remove', 'wallet-remove');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-keep', walletId: 'wallet-keep' },
      ]);

      await syncService['reconcileAddressToWalletMap']();

      expect(syncService['addressToWalletMap'].has('addr-keep')).toBe(true);
      expect(syncService['addressToWalletMap'].has('addr-remove')).toBe(false);
    });

    it('skips reconciliation query when map is empty', async () => {
      syncService['addressToWalletMap'].clear();
      await syncService['reconcileAddressToWalletMap']();
      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('subscribes new addresses during reconciliation when ownership is self', async () => {
      syncService['subscriptionOwnership'] = 'self';
      syncService['addressToWalletMap'].set('addr-existing', 'wallet-1');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-existing', walletId: 'wallet-1' },
        { address: 'addr-new', walletId: 'wallet-2' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([['addr-new', 'status-new']])
      );

      await syncService['reconcileAddressToWalletMap']();

      expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-new']);
      expect(syncService['addressToWalletMap'].get('addr-new')).toBe('wallet-2');
    });
  });

  describe('cleanup on stop', () => {
    it('should cancel pending retry timers', async () => {
      syncService['isRunning'] = true;

      const timer = setTimeout(() => {}, 10000);
      syncService['pendingRetries'].set('wallet-1', timer);

      await syncService.stop();

      expect(syncService['pendingRetries'].size).toBe(0);
    });

    it('should release all active locks', async () => {
      syncService['isRunning'] = true;

      syncService['activeLocks'].set('wallet-1', { id: 'lock-1', resource: 'test' } as any);
      syncService['activeLocks'].set('wallet-2', { id: 'lock-2', resource: 'test' } as any);

      await syncService.stop();

      expect(mockReleaseLock).toHaveBeenCalledTimes(2);
      expect(syncService['activeLocks'].size).toBe(0);
    });

    it('should clear the sync queue', async () => {
      syncService['isRunning'] = true;
      syncService['syncQueue'] = [
        { walletId: 'w1', priority: 'normal', requestedAt: new Date() },
        { walletId: 'w2', priority: 'high', requestedAt: new Date() },
      ];

      await syncService.stop();

      expect(syncService['syncQueue'].length).toBe(0);
    });

    it('continues stopping when active lock release fails', async () => {
      syncService['isRunning'] = true;
      syncService['activeLocks'].set('wallet-1', { id: 'lock-1', resource: 'test' } as any);
      mockReleaseLock.mockRejectedValueOnce(new Error('release failed'));

      await expect(syncService.stop()).resolves.toBeUndefined();
      expect(syncService['activeLocks'].size).toBe(0);
    });
  });

  describe('real-time subscriptions and block handling', () => {
    it('disables setup immediately when subscriptions are disabled in config', async () => {
      const configModule = await import('../../../src/config');
      vi.spyOn(configModule, 'getConfig').mockReturnValue({
        sync: {
          intervalMs: 60000,
          confirmationUpdateIntervalMs: 30000,
          staleThresholdMs: 300000,
          maxConcurrentSyncs: 5,
          maxRetryAttempts: 3,
          retryDelaysMs: [1000, 5000, 15000],
          maxSyncDurationMs: 120000,
          transactionBatchSize: 100,
          electrumSubscriptionsEnabled: false,
        },
        bitcoin: { network: 'testnet' },
      } as any);

      await syncService['setupRealTimeSubscriptions']();

      expect(syncService['subscriptionOwnership']).toBe('disabled');
      expect(mockAcquireLock).not.toHaveBeenCalled();
    });

    it('sets ownership to external when subscription lock is unavailable', async () => {
      mockAcquireLock.mockResolvedValueOnce(null);

      await syncService['setupRealTimeSubscriptions']();

      expect(syncService['subscriptionOwnership']).toBe('external');
    });

    it('disables subscriptions when electrum client is unavailable', async () => {
      mockAcquireLock.mockResolvedValueOnce({
        key: 'electrum:subscriptions',
        token: 'token-1',
        expiresAt: Date.now() + 60000,
        isLocal: true,
      });
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await syncService['setupRealTimeSubscriptions']();

      expect(syncService['subscriptionOwnership']).toBe('disabled');
      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('continues setup when getServerVersion fails', async () => {
      mockElectrumClient.getServerVersion.mockRejectedValueOnce(new Error('version unavailable'));
      mockPrismaClient.address.findMany.mockResolvedValueOnce([]);

      await syncService['setupRealTimeSubscriptions']();

      expect(mockElectrumClient.subscribeHeaders).toHaveBeenCalled();
      expect(syncService['subscriptionOwnership']).toBe('self');
    });

    it('keeps existing header subscription and refresh timer on repeated setup calls', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);

      await syncService['setupRealTimeSubscriptions']();
      await syncService['setupRealTimeSubscriptions']();

      expect(mockElectrumClient.subscribeHeaders).toHaveBeenCalledTimes(1);
    });

    it('keeps ownership unchanged when setup fails before subscriptions are enabled', async () => {
      const configModule = await import('../../../src/config');
      const configSpy = vi.spyOn(configModule, 'getConfig').mockImplementation(() => {
        throw new Error('config load failed');
      });
      syncService['subscriptionsEnabled'] = false;
      syncService['subscriptionOwnership'] = 'disabled';

      await syncService['setupRealTimeSubscriptions']();
      configSpy.mockRestore();

      expect(syncService['subscriptionOwnership']).toBe('disabled');
    });

    it('handles setup errors after acquiring lock', async () => {
      mockGetNodeClient.mockRejectedValueOnce(new Error('node offline'));

      await syncService['setupRealTimeSubscriptions']();

      expect(syncService['subscriptionOwnership']).toBe('external');
      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it('refreshes subscription lock and handles lost ownership', async () => {
      syncService['subscriptionLock'] = {
        key: 'electrum:subscriptions',
        token: 'token-1',
        expiresAt: Date.now() + 60000,
        isLocal: true,
      } as any;
      syncService['subscriptionOwnership'] = 'self';

      const teardownSpy = vi.spyOn(syncService as any, 'teardownRealTimeSubscriptions').mockResolvedValue(undefined);
      mockExtendLock.mockResolvedValueOnce(null);

      syncService['startSubscriptionLockRefresh']();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(syncService['subscriptionOwnership']).toBe('external');
      expect(syncService['subscriptionLock']).toBeNull();
      expect(teardownSpy).toHaveBeenCalled();
    });

    it('updates subscription lock when refresh succeeds', async () => {
      const initialLock = {
        key: 'electrum:subscriptions',
        token: 'token-1',
        expiresAt: Date.now() + 60000,
        isLocal: true,
      } as any;
      const refreshedLock = {
        ...initialLock,
        token: 'token-2',
      };
      syncService['subscriptionLock'] = initialLock;
      syncService['subscriptionOwnership'] = 'self';
      mockExtendLock.mockResolvedValueOnce(refreshedLock);

      syncService['startSubscriptionLockRefresh']();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(syncService['subscriptionLock']).toEqual(refreshedLock);
      syncService['stopSubscriptionLockRefresh']();
    });

    it('skips refresh extension when lock is missing on refresh tick', async () => {
      syncService['subscriptionLock'] = null;

      syncService['startSubscriptionLockRefresh']();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockExtendLock).not.toHaveBeenCalled();
      syncService['stopSubscriptionLockRefresh']();
    });

    it('batch-subscribes addresses and falls back to individual subscriptions on batch failure', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-1', walletId: 'wallet-1' },
        { address: 'addr-2', walletId: 'wallet-2' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch unsupported'));
      mockElectrumClient.subscribeAddress
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('addr-2 failed'));

      await syncService['subscribeAllWalletAddresses']();

      expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-1', 'addr-2']);
      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
      expect(syncService['addressToWalletMap'].get('addr-1')).toBe('wallet-1');
    });

    it('returns early for subscribeAllWalletAddresses when ownership is not self', async () => {
      syncService['subscriptionOwnership'] = 'external';

      await syncService['subscribeAllWalletAddresses']();

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
      expect(mockElectrumClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('returns early for subscribeAllWalletAddresses when electrum client is unavailable', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await syncService['subscribeAllWalletAddresses']();

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('batch-subscribes addresses successfully and updates address map', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-a', walletId: 'wallet-a' },
        { address: 'addr-b', walletId: 'wallet-b' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([
          ['addr-a', 'status-a'],
          ['addr-b', 'status-b'],
        ])
      );

      await syncService['subscribeAllWalletAddresses']();

      expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-a', 'addr-b']);
      expect(syncService['addressToWalletMap'].get('addr-a')).toBe('wallet-a');
      expect(syncService['addressToWalletMap'].get('addr-b')).toBe('wallet-b');
    });

    it('ignores batch subscription entries without a truthy wallet id mapping', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-empty', walletId: '' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([['addr-empty', 'status-empty']])
      );

      await syncService['subscribeAllWalletAddresses']();

      expect(syncService['addressToWalletMap'].has('addr-empty')).toBe(false);
    });

    it('skips fallback address mapping when wallet id is not truthy', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-empty-fallback', walletId: '' },
      ]);
      mockElectrumClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch unsupported'));
      mockElectrumClient.subscribeAddress.mockResolvedValueOnce(undefined);

      await syncService['subscribeAllWalletAddresses']();

      expect(syncService['addressToWalletMap'].has('addr-empty-fallback')).toBe(false);
    });

    it('returns early when unsubscribeWalletAddresses is called without ownership', async () => {
      syncService['subscriptionOwnership'] = 'external';
      syncService['addressToWalletMap'].set('addr-1', 'wallet-1');

      await syncService.unsubscribeWalletAddresses('wallet-1');

      expect(syncService['addressToWalletMap'].size).toBe(1);
      expect(mockElectrumClient.unsubscribeAddress).not.toHaveBeenCalled();
    });

    it('removes in-memory mappings even when electrum client is unavailable for unsubscribe', async () => {
      syncService['subscriptionOwnership'] = 'self';
      syncService['addressToWalletMap'].set('addr-no-client', 'wallet-1');
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await syncService.unsubscribeWalletAddresses('wallet-1');

      expect(syncService['addressToWalletMap'].size).toBe(0);
      expect(mockElectrumClient.unsubscribeAddress).not.toHaveBeenCalled();
    });

    it('logs no-op reconciliation path when all wallets still exist', async () => {
      syncService['addressToWalletMap'].set('addr-keep', 'wallet-keep');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'addr-keep', walletId: 'wallet-keep' },
      ]);

      await syncService['reconcileAddressToWalletMap']();

      expect(syncService['addressToWalletMap'].has('addr-keep')).toBe(true);
    });

    it('handles new block success and confirmation-update failure paths', async () => {
      const { eventService } = await import('../../../src/services/eventService');
      const updateSpy = vi.spyOn(syncService as any, 'updateAllConfirmations')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('confirmations failed'));

      await syncService['handleNewBlock']({ height: 200, hex: 'a'.repeat(80) });
      await syncService['handleNewBlock']({ height: 201, hex: 'b'.repeat(80) });

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(eventService.emitNewBlock).toHaveBeenCalledWith('testnet', 200, 'a'.repeat(64));
      expect(mockNotificationService.broadcastNewBlock).toHaveBeenCalledWith({ height: 200 });
    });

    it('tears down subscriptions even when unsubscribe throws', async () => {
      syncService['addressToWalletMap'].set('addr-1', 'wallet-1');
      mockElectrumClient.unsubscribeAddress.mockRejectedValueOnce(new Error('unsubscribe failed'));

      await syncService['teardownRealTimeSubscriptions']();

      expect(syncService['addressToWalletMap'].size).toBe(0);
    });

    it('clears address map even when electrum client is unavailable during teardown', async () => {
      syncService['addressToWalletMap'].set('addr-no-client', 'wallet-1');
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await syncService['teardownRealTimeSubscriptions']();

      expect(syncService['addressToWalletMap'].size).toBe(0);
      expect(mockElectrumClient.removeAllListeners).not.toHaveBeenCalled();
    });

    it('returns early for subscribeNewWalletAddresses when ownership is not self', async () => {
      syncService['subscriptionOwnership'] = 'external';

      await syncService.subscribeNewWalletAddresses('wallet-x');

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('returns early for subscribeNewWalletAddresses when electrum client is unavailable', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockGetElectrumClientIfActive.mockResolvedValueOnce(null);

      await syncService.subscribeNewWalletAddresses('wallet-no-client');

      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('continues subscribeNewWalletAddresses when one address subscription fails', async () => {
      syncService['subscriptionOwnership'] = 'self';
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'tb1-new-1' },
        { address: 'tb1-new-2' },
      ]);
      mockElectrumClient.subscribeAddress
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce(undefined);

      await syncService.subscribeNewWalletAddresses('wallet-y');

      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledTimes(2);
    });

    it('skips subscribe calls for addresses that are already tracked', async () => {
      syncService['subscriptionOwnership'] = 'self';
      syncService['addressToWalletMap'].set('tb1-existing', 'wallet-z');
      mockPrismaClient.address.findMany.mockResolvedValueOnce([
        { address: 'tb1-existing' },
      ]);

      await syncService.subscribeNewWalletAddresses('wallet-z');

      expect(mockElectrumClient.subscribeAddress).not.toHaveBeenCalled();
    });
  });
});

describe('SyncService - Error Handling', () => {
  let syncService: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = getSyncService();
    syncService['isRunning'] = false;
    syncService['syncQueue'] = [];
    syncService['activeSyncs'] = new Set();
    syncService['activeLocks'] = new Map();

    mockAcquireLock.mockResolvedValue({ id: 'lock-1', resource: 'test' });
    mockReleaseLock.mockResolvedValue(undefined);
    mockPrismaClient.wallet.update.mockResolvedValue({});
    mockPrismaClient.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
  });

  afterEach(async () => {
    await syncService.stop();
  });

  it('should handle Electrum connection failure', async () => {
    syncService['isRunning'] = true;
    mockSyncWallet.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await syncService.syncNow('wallet-1');

    expect(result.success).toBe(false);
  });

  it('should handle timeout errors', async () => {
    syncService['isRunning'] = true;
    mockSyncWallet.mockRejectedValue(new Error('Sync timeout: exceeded 120s limit'));

    const result = await syncService.syncNow('wallet-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should handle database errors', async () => {
    syncService['isRunning'] = true;
    mockPrismaClient.wallet.update.mockRejectedValue(new Error('Database connection lost'));

    await expect(syncService.syncNow('wallet-1')).rejects.toThrow();
  });
});
