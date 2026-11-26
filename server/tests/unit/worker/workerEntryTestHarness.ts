import { beforeEach, vi } from 'vitest';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';

const mocks = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const queueInstance = {
    initialize: vi.fn(),
    startConsumers: vi.fn(),
    getRegisteredJobs: vi.fn(),
    isHealthy: vi.fn(),
    isQueueWorkerRunning: vi.fn(),
    hasRegisteredHandler: vi.fn(),
    getHealth: vi.fn(),
    getRecurringHeartbeatSnapshot: vi.fn(),
    inspectRecurringSchedules: vi.fn(),
    addJob: vi.fn(),
    addBulkJobs: vi.fn(),
    scheduleRecurring: vi.fn(),
    removeRecurring: vi.fn(),
    purgeStaleWalletScheduleJobs: vi.fn(),
    onJobCompleted: vi.fn(),
    shutdown: vi.fn(),
  };

  const electrumInstance = {
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: vi.fn(),
    isSubscriptionOwner: vi.fn(),
    getSubscriptionOwnershipEpoch: vi.fn(),
    getManagedNetworks: vi.fn(),
    ensureNetworkConnected: vi.fn(),
    subscribeCheckpointAddresses: vi.fn(),
    getHealthMetrics: vi.fn(),
    reconcileSubscriptions: vi.fn(),
    refreshSubscriptionStatusPage: vi.fn(),
  };

  const healthServerHandle = {
    close: vi.fn(),
  };

  let electrumCallbacks:
    | {
        onHeaderObservation: (
          network: NetworkType,
          observation: { height: number; hex: string },
          fetchHeaders: (startHeight: number, count: number) => Promise<string[]>,
        ) => Promise<unknown>;
        onAddressActivity: (network: NetworkType, scriptHash: string, status: string | null) => void;
        onNetworkReady?: (network: NetworkType) => Promise<void>;
        onSubscriptionStatuses?: (
          network: NetworkType,
          statuses: Map<string, string | null>,
          source: 'subscribe' | 'reconnect' | 'refresh',
        ) => Promise<void>;
      }
    | undefined;
  let healthProvider:
    | { getHealth: () => Promise<unknown>; getMetrics: () => Promise<unknown> }
    | undefined;
  let diagnosticsProvider: (() => Promise<unknown> | unknown) | undefined;

  const WorkerJobQueue = vi.fn(function WorkerJobQueueMock() {
    return queueInstance;
  });
  const ElectrumSubscriptionManager = vi.fn(function ElectrumSubscriptionManagerMock(opts: typeof electrumCallbacks) {
    electrumCallbacks = opts;
    return electrumInstance;
  });
  const startHealthServer = vi.fn((opts: {
    healthProvider: typeof healthProvider;
    diagnostics?: { getSnapshot: () => Promise<unknown> | unknown };
  }) => {
    healthProvider = opts.healthProvider;
    diagnosticsProvider = opts.diagnostics?.getSnapshot;
    return healthServerHandle;
  });
  const heartbeatInstance = {
    write: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const WorkerHeartbeatWriter = vi.fn(function WorkerHeartbeatWriterMock() {
    return heartbeatInstance;
  });
  const walletSyncRecoveryRuntime = {
    getActivationState: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const createProductionWalletSyncRecoveryRuntime = vi.fn(
    () => walletSyncRecoveryRuntime,
  );
  const subscriptionCheckpointRuntime = {
    enrollPendingPage: vi.fn(),
    hasPendingWalletEnrollment: vi.fn(),
    recordStatusPage: vi.fn(),
  };
  const createProductionSubscriptionCheckpointRuntime = vi.fn<(
    subscribeBatch: (
      request: { network: NetworkType; addresses: string[] },
    ) => Promise<Map<string, string | null>>,
    isActive: () => boolean,
  ) => typeof subscriptionCheckpointRuntime>(
    () => subscriptionCheckpointRuntime,
  );
  const networkHeaderReconciliationRuntime = {
    observe: vi.fn(),
    recoverDue: vi.fn(),
    stop: vi.fn(),
  };
  const createProductionNetworkHeaderReconciliationRuntime = vi.fn(
    () => networkHeaderReconciliationRuntime,
  );

  const getConfig = vi.fn(() => ({
    bitcoin: { network: 'testnet' },
    sync: {
      intervalMs: 5 * 60 * 1000,
      confirmationUpdateIntervalMs: 2 * 60 * 1000,
      maxConcurrentSyncs: 1,
    },
    maintenance: {
      auditLogRetentionDays: 30,
      priceDataRetentionDays: 30,
      feeEstimateRetentionDays: 7,
    },
    worker: {
      healthPort: 3002,
      concurrency: 5,
      diagnosticsSecret: 's'.repeat(32),
      diagnosticsTimeoutMs: 3000,
      diagnosticsMaxBodyBytes: 1024,
      diagnosticsMaxConcurrentRequests: 2,
      diagnosticsAuthWindowMs: 60_000,
    },
    features: {
      treasuryAutopilot: false,
    },
  }));

  return {
    logger,
    queueInstance,
    electrumInstance,
    healthServerHandle,
    WorkerJobQueue,
    ElectrumSubscriptionManager,
    startHealthServer,
    heartbeatInstance,
    WorkerHeartbeatWriter,
    walletSyncRecoveryRuntime,
    createProductionWalletSyncRecoveryRuntime,
    subscriptionCheckpointRuntime,
    createProductionSubscriptionCheckpointRuntime,
    networkHeaderReconciliationRuntime,
    createProductionNetworkHeaderReconciliationRuntime,
    getConfig,
    registerWorkerJobs: vi.fn<(
      queue: unknown,
      dependencies: {
        enrollWalletSubscriptions: (
          walletId: string,
          network: string,
          signal: AbortSignal,
        ) => Promise<void>;
      },
    ) => void>(),
    initializeOpenTelemetry: vi.fn(),
    shutdownOpenTelemetry: vi.fn(),
    priceServiceShutdown: vi.fn(),
    pushServiceShutdown: vi.fn(),
    validateEncryptionKey: vi.fn(),
    connectWithRetry: vi.fn(),
    disconnect: vi.fn(),
    startDatabaseHealthCheck: vi.fn(),
    stopDatabaseHealthCheck: vi.fn(),
    getLastDatabaseHealth: vi.fn(),
    initializeDistributedLock: vi.fn(),
    initializeRedis: vi.fn(),
    shutdownRedis: vi.fn(),
    initializeCacheInvalidation: vi.fn(),
    redisBridgeIsActive: vi.fn(() => true),
    shutdownCacheInvalidation: vi.fn(),
    isRedisConnected: vi.fn(),
    shutdownDistributedLock: vi.fn(),
    getDistributedEventBus: vi.fn(),
    shutdownNotificationDispatcher: vi.fn(),
    closeWorkerSyncQueue: vi.fn(),
    shutdownElectrumPool: vi.fn(),
    getErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    ),
    mockEventBus: {
      on: vi.fn(),
      emit: vi.fn(),
    },
    mockFeatureFlagService: {
      initialize: vi.fn(),
      configureRuntime: vi.fn(),
      shutdownRuntime: vi.fn(),
      isEnabled: vi.fn(),
    },
    getElectrumCallbacks: () => electrumCallbacks,
    getHealthProvider: () => healthProvider,
    getDiagnosticsProvider: () => diagnosticsProvider,
    collectWalletSyncExecutionDiagnostics: vi.fn().mockResolvedValue(undefined),
    startCaptureParticipant: vi.fn(),
    stopCaptureParticipant: vi.fn(),
    syncIntentRequest: vi.fn(),
    recordSubscriptionStatusMismatch: vi.fn(),
    recordSubscriptionStatusRefreshPage: vi.fn(),
    recordSubscriptionStatusRefreshCycleCompleted: vi.fn(),
  };
});

vi.mock('../../../src/utils/tracing/otel', () => ({
  initializeOpenTelemetry: mocks.initializeOpenTelemetry,
  shutdownOpenTelemetry: mocks.shutdownOpenTelemetry,
}));

vi.mock('../../../src/services/price', () => ({
  getPriceService: () => ({ shutdown: mocks.priceServiceShutdown }),
}));

vi.mock('../../../src/services/push/pushService', () => ({
  getPushService: () => ({ shutdown: mocks.pushServiceShutdown }),
}));

vi.mock('../../../src/config', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('../../../src/utils/encryption', () => ({
  validateEncryptionKey: mocks.validateEncryptionKey,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: mocks.getErrorMessage,
}));

vi.mock('../../../src/models/prisma', () => ({
  connectWithRetry: mocks.connectWithRetry,
  disconnect: mocks.disconnect,
  startDatabaseHealthCheck: mocks.startDatabaseHealthCheck,
  stopDatabaseHealthCheck: mocks.stopDatabaseHealthCheck,
  getLastDatabaseHealth: mocks.getLastDatabaseHealth,
}));

vi.mock('../../../src/services/telegram/api', () => ({
  getTelegramTransportDiagnostics: () => ({
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureClass: 'none',
  }),
}));

vi.mock('../../../src/infrastructure', () => ({
  initializeDistributedLock: mocks.initializeDistributedLock,
  initializeRedis: mocks.initializeRedis,
  shutdownRedis: mocks.shutdownRedis,
  isRedisConnected: mocks.isRedisConnected,
  shutdownDistributedLock: mocks.shutdownDistributedLock,
  getDistributedEventBus: () => mocks.mockEventBus,
  shutdownNotificationDispatcher: mocks.shutdownNotificationDispatcher,
}));

vi.mock('../../../src/services/featureFlagService', () => ({
  featureFlagService: mocks.mockFeatureFlagService,
}));

vi.mock('../../../src/worker/workerJobQueue', () => ({
  WorkerJobQueue: mocks.WorkerJobQueue,
}));

vi.mock('../../../src/worker/electrumManager', () => ({
  ElectrumSubscriptionManager: mocks.ElectrumSubscriptionManager,
}));

vi.mock('../../../src/worker/healthServer', () => ({
  startHealthServer: mocks.startHealthServer,
}));

vi.mock('../../../src/services/workerHeartbeatRegistry', () => ({
  WorkerHeartbeatWriter: mocks.WorkerHeartbeatWriter,
}));

vi.mock('../../../src/worker/walletSyncRecoveryRuntime', () => ({
  createProductionWalletSyncRecoveryRuntime:
    mocks.createProductionWalletSyncRecoveryRuntime,
}));

vi.mock('../../../src/worker/subscriptionCheckpointRuntime', () => ({
  createProductionSubscriptionCheckpointRuntime:
    mocks.createProductionSubscriptionCheckpointRuntime,
}));

vi.mock('../../../src/worker/networkHeaderReconciliationRuntime', () => ({
  createProductionNetworkHeaderReconciliationRuntime:
    mocks.createProductionNetworkHeaderReconciliationRuntime,
}));

vi.mock('../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: {
    request: mocks.syncIntentRequest,
  },
}));

vi.mock('../../../src/worker/jobs', () => ({
  registerWorkerJobs: mocks.registerWorkerJobs,
}));

vi.mock('../../../src/worker/walletSyncExecutionRegistry', () => ({
  collectWalletSyncExecutionDiagnostics:
    mocks.collectWalletSyncExecutionDiagnostics,
}));

vi.mock('../../../src/observability/metrics/registry', () => ({
  metricsService: { initialize: vi.fn() },
  registry: { metrics: vi.fn().mockResolvedValue(''), contentType: 'text/plain' },
}));

vi.mock('../../../src/observability/metrics/infrastructureMetrics', () => ({
  jobProcessingDuration: { observe: vi.fn() },
  jobQueueDepth: { set: vi.fn() },
}));

vi.mock('../../../src/observability/metrics/helpers', () => ({
  updateJobQueueMetrics: vi.fn(),
}));

vi.mock('../../../src/observability/metrics/walletSyncMetrics', () => ({
  classifyDistributedLockScope: vi.fn(() => 'other'),
  recordWalletSyncLockLoss: vi.fn(),
  enterWalletSyncStage: vi.fn(() => vi.fn()),
  recordWalletSyncFallback: vi.fn(),
  recordWalletSyncBudgetExpiry: vi.fn(),
  recordWalletSyncCandidateOutcome: vi.fn(),
  recordWalletSyncTerminalOutcome: vi.fn(),
  recordWalletSyncAbortGraceExhaustion: vi.fn(),
  recordWalletSyncCleanupOutcome: vi.fn(),
}));

vi.mock('../../../src/observability/metrics/subscriptionStatusMetrics', () => ({
  recordSubscriptionStatusMismatch: mocks.recordSubscriptionStatusMismatch,
  recordSubscriptionStatusRefreshPage: mocks.recordSubscriptionStatusRefreshPage,
  recordSubscriptionStatusRefreshCycleCompleted:
    mocks.recordSubscriptionStatusRefreshCycleCompleted,
}));

// The worker publishes its WebSocket events onto the Redis bridge. The real
// module reaches the un-mocked infrastructure/redis and metrics graph.
vi.mock('../../../src/services/cacheInvalidation', () => ({
  initializeCacheInvalidation: mocks.initializeCacheInvalidation,
  shutdownCacheInvalidation: mocks.shutdownCacheInvalidation,
}));

vi.mock('../../../src/websocket/redisBridge', () => ({
  initializeRedisBridge: vi.fn(async () => undefined),
  shutdownRedisBridge: vi.fn(async () => undefined),
  redisBridge: { isActive: mocks.redisBridgeIsActive },
}));

vi.mock('../../../src/services/supportPackage/captureRuntime', () => ({
  startCaptureParticipant: mocks.startCaptureParticipant, stopCaptureParticipant: mocks.stopCaptureParticipant,
}));

vi.mock('../../../src/services/workerSyncQueue', () => ({
  closeWorkerSyncQueue: mocks.closeWorkerSyncQueue,
}));

vi.mock('../../../src/services/bitcoin/electrumPool', () => ({
  shutdownElectrumPool: mocks.shutdownElectrumPool,
}));

export { mocks };

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

export function statusPageResult(scanned = 0, nextCursor?: string) {
  return {
    scanned,
    completed: 0,
    unavailable: 0,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    syncIntents: [],
    dispatch: {
      intents: 0,
      published: 0,
      publicationFailed: 0,
      woken: 0,
      wakeUnavailable: 0,
    },
  };
}

export function registerWorkerEntrySetup() {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Module resets do not stop a prior worker's real intervals. Keep daemon
    // scheduling controlled for every test; periodic-behavior tests below
    // replace this spy, capture the real callbacks, and drive them explicitly.
    // Vitest restoreMocks restores the scheduler before the next beforeEach.
    vi.spyOn(global, 'setInterval').mockImplementation(() => (
      { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>
    ));

    mocks.initializeOpenTelemetry.mockResolvedValue(undefined);
    mocks.shutdownOpenTelemetry.mockResolvedValue(undefined);
    mocks.priceServiceShutdown.mockResolvedValue(undefined);
    mocks.pushServiceShutdown.mockResolvedValue(undefined);
    mocks.validateEncryptionKey.mockResolvedValue(undefined);
    mocks.connectWithRetry.mockResolvedValue(undefined);
    mocks.syncIntentRequest.mockResolvedValue({
      status: 'requested',
      generation: 1,
      wakeup: 'enqueued',
    });
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.getLastDatabaseHealth.mockReturnValue(true);
    mocks.initializeRedis.mockResolvedValue(undefined);
    mocks.shutdownRedis.mockResolvedValue(undefined);
    mocks.isRedisConnected.mockReturnValue(true);
    mocks.shutdownDistributedLock.mockReturnValue(undefined);
    mocks.shutdownNotificationDispatcher.mockResolvedValue(undefined);
    mocks.closeWorkerSyncQueue.mockResolvedValue(undefined);
    mocks.shutdownElectrumPool.mockResolvedValue(undefined);
    mocks.startCaptureParticipant.mockResolvedValue(undefined); mocks.stopCaptureParticipant.mockResolvedValue(undefined);

    mocks.queueInstance.initialize.mockResolvedValue(undefined);
    mocks.queueInstance.startConsumers.mockReturnValue(undefined);
    mocks.queueInstance.getRegisteredJobs.mockReturnValue(['sync-wallet']);
    mocks.queueInstance.isHealthy.mockReturnValue(true);
    mocks.queueInstance.isQueueWorkerRunning.mockReturnValue(true);
    mocks.queueInstance.hasRegisteredHandler.mockReturnValue(true);
    mocks.queueInstance.getHealth.mockResolvedValue({ queues: { sync: { size: 0 } } });
    mocks.queueInstance.getRecurringHeartbeatSnapshot.mockImplementation(
      async (definitions: Array<{ schedulerId: string; freshness?: unknown }>) => ({
        healthy: true,
        records: Object.fromEntries(
          definitions
            .filter(({ freshness }) => freshness)
            .map(({ schedulerId }) => [
              schedulerId,
              {
                version: 1,
                schedulerId,
                recurrenceFingerprint: 'test',
                activatedAt: Date.now(),
                lastCompletedAt: Date.now(),
              },
            ]),
        ),
      }),
    );
    mocks.queueInstance.addJob.mockResolvedValue(undefined);
    mocks.queueInstance.addBulkJobs.mockResolvedValue([]);
    mocks.queueInstance.scheduleRecurring.mockResolvedValue({ status: 'created' });
    mocks.queueInstance.inspectRecurringSchedules.mockResolvedValue({
      healthy: true,
      missing: [],
      mismatched: [],
      unexpected: [],
      inspectionFailures: [],
    });
    mocks.queueInstance.removeRecurring.mockResolvedValue({ status: 'absent' });
    mocks.queueInstance.purgeStaleWalletScheduleJobs.mockResolvedValue({ status: 'absent' });
    mocks.queueInstance.onJobCompleted.mockReturnValue(undefined);
    mocks.queueInstance.shutdown.mockResolvedValue(undefined);

    mocks.electrumInstance.start.mockResolvedValue(undefined);
    mocks.electrumInstance.stop.mockResolvedValue(undefined);
    mocks.electrumInstance.isConnected.mockReturnValue(true);
    mocks.electrumInstance.isSubscriptionOwner.mockReturnValue(true);
    mocks.electrumInstance.getSubscriptionOwnershipEpoch.mockReturnValue(1);
    mocks.electrumInstance.getManagedNetworks.mockReturnValue(['testnet3']);
    mocks.electrumInstance.ensureNetworkConnected.mockResolvedValue(undefined);
    mocks.electrumInstance.subscribeCheckpointAddresses.mockResolvedValue(new Map());
    mocks.electrumInstance.getHealthMetrics.mockReturnValue({
      isRunning: true,
      ownershipRetryActive: false,
      totalSubscribedAddresses: 2,
      networks: { testnet: { connected: true } },
    });
    mocks.electrumInstance.reconcileSubscriptions.mockResolvedValue(undefined);
    mocks.electrumInstance.refreshSubscriptionStatusPage.mockResolvedValue({ scanned: 0, outcome: 'refreshed' });
    mocks.subscriptionCheckpointRuntime.enrollPendingPage.mockResolvedValue({
      scanned: 0,
      subscribed: 0,
      unavailable: 0,
      syncIntents: [],
      dispatch: {
        intents: 0,
        published: 0,
        publicationFailed: 0,
        woken: 0,
        wakeUnavailable: 0,
      },
    });
    mocks.subscriptionCheckpointRuntime.hasPendingWalletEnrollment.mockResolvedValue(false);
    mocks.subscriptionCheckpointRuntime.recordStatusPage.mockResolvedValue({
      scanned: 0,
      completed: 0,
      unavailable: 0,
      intentsRaised: 0,
      syncIntents: [],
      dispatch: {
        intents: 0,
        published: 0,
        publicationFailed: 0,
        woken: 0,
        wakeUnavailable: 0,
      },
    });
    mocks.createProductionSubscriptionCheckpointRuntime.mockReturnValue(
      mocks.subscriptionCheckpointRuntime,
    );
    mocks.networkHeaderReconciliationRuntime.observe.mockResolvedValue(null);
    mocks.networkHeaderReconciliationRuntime.recoverDue.mockResolvedValue(undefined);
    mocks.networkHeaderReconciliationRuntime.stop.mockReturnValue(undefined);
    mocks.createProductionNetworkHeaderReconciliationRuntime.mockReturnValue(
      mocks.networkHeaderReconciliationRuntime,
    );

    mocks.healthServerHandle.close.mockResolvedValue(undefined);
    mocks.heartbeatInstance.write.mockResolvedValue(undefined);
    mocks.heartbeatInstance.start.mockReturnValue(undefined);
    mocks.heartbeatInstance.stop.mockResolvedValue(undefined);
    mocks.walletSyncRecoveryRuntime.getActivationState.mockReturnValue({
      status: 'active',
      requiredFloor: 1,
      activatedAt: '2026-08-22T07:00:00.000Z',
    });
    mocks.walletSyncRecoveryRuntime.start.mockResolvedValue(undefined);
    mocks.walletSyncRecoveryRuntime.stop.mockResolvedValue(undefined);
    mocks.createProductionWalletSyncRecoveryRuntime.mockReturnValue(
      mocks.walletSyncRecoveryRuntime,
    );

    mocks.mockFeatureFlagService.initialize.mockImplementation(async () => {
      const reconcileInstalledSnapshot = mocks.mockFeatureFlagService.configureRuntime
        .mock.calls.at(-1)?.[1];
      await reconcileInstalledSnapshot?.();
    });
    mocks.mockFeatureFlagService.isEnabled.mockResolvedValue(false);
  });
}
