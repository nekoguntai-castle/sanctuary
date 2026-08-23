import { vi } from 'vitest';

interface WorkerHarnessOptions {
  redisConnected?: boolean;
  gatewaySecret?: string;
  configOverrides?: Record<string, any>;
}

interface WorkerHarnessHandle {
  jobQueue: any;
  electrumManager: any;
  healthServer: { close: ReturnType<typeof vi.fn> };
  registerWorkerJobs: ReturnType<typeof vi.fn>;
  requestSyncIntent: ReturnType<typeof vi.fn>;
  walletSyncRecoveryRuntime: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  electrumOptions: { onNewBlock?: (...args: any[]) => void; onAddressActivity?: (...args: any[]) => void };
  exitSpy: ReturnType<typeof vi.spyOn>;
  shutdown: () => Promise<void>;
  stopProcessExitSpy: () => void;
}

const createDeferred = () => {
  let resolve: () => void;
  let reject: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
};

export const createWorkerTestHarness = async (
  options: WorkerHarnessOptions = {}
): Promise<WorkerHarnessHandle> => {
  vi.resetModules();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');

  const redisConnected = options.redisConnected ?? true;
  let reconcileInstalledFeatureSnapshot: (() => Promise<void>) | undefined;

  const jobQueueInstance = {
    initialize: vi.fn(async () => undefined),
    startConsumers: vi.fn(),
    addJob: vi.fn(async () => undefined),
    addBulkJobs: vi.fn(async () => []),
    scheduleRecurring: vi.fn(async () => ({ status: 'created' })),
    inspectRecurringSchedules: vi.fn(async () => ({
      healthy: true,
      missing: [],
      mismatched: [],
      unexpected: [],
      inspectionFailures: [],
    })),
    removeRecurring: vi.fn(async () => ({ status: 'absent' })),
    purgeStaleWalletScheduleJobs: vi.fn(async () => ({ status: 'absent' })),
    getRegisteredJobs: vi.fn(() => ['test-job']),
    getHealth: vi.fn(async () => ({ queues: {} })),
    isHealthy: vi.fn(() => true),
    getRecurringHeartbeatSnapshot: vi.fn(async () => ({
      healthy: true,
      records: {},
    })),
    onJobCompleted: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  };

  const electrumManagerInstance = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    reconcileSubscriptions: vi.fn(async () => undefined),
    refreshSubscriptionStatusPage: vi.fn(async () => ({ scanned: 0 })),
    isSubscriptionOwner: vi.fn(() => true),
    subscribeCheckpointAddresses: vi.fn(async () => new Map()),
    isConnected: vi.fn(() => true),
    getHealthMetrics: vi.fn(() => ({
      totalSubscribedAddresses: 0,
      networks: {},
    })),
  };

  const healthServerHandle = {
    close: vi.fn(async () => undefined),
  };

  const registerWorkerJobs = vi.fn();
  const requestSyncIntent = vi.fn(async () => ({
    status: 'requested' as const,
    generation: 1,
    wakeup: 'enqueued' as const,
  }));
  const otelInit = createDeferred();

  vi.doMock('../../../src/utils/tracing/otel', () => ({
    initializeOpenTelemetry: vi.fn(async () => {
      otelInit.resolve();
      return undefined;
    }),
  }));

  vi.doMock('../../../src/config', () => ({
    getConfig: () => ({
      bitcoin: { network: 'testnet3' },
      sync: {
        intervalMs: 5 * 60 * 1000,
        confirmationUpdateIntervalMs: 2 * 60 * 1000,
      },
      maintenance: {
        auditLogRetentionDays: 30,
        priceDataRetentionDays: 14,
        feeEstimateRetentionDays: 7,
      },
      worker: {
        diagnosticsSecret: 'integration-worker-diagnostics-secret',
        diagnosticsTimeoutMs: 3000,
        diagnosticsMaxBodyBytes: 1024,
        diagnosticsMaxConcurrentRequests: 2,
        diagnosticsAuthWindowMs: 60_000,
      },
      gatewaySecret: options.gatewaySecret ?? 'test-secret',
      ...options.configOverrides,
    }),
    default: {
      gatewaySecret: options.gatewaySecret ?? 'test-secret',
    },
  }));

  const errorLogs: string[] = [];
  vi.doMock('../../../src/utils/logger', () => ({
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((message: string, meta?: { error?: unknown }) => {
        if (message) {
          errorLogs.push(message);
        }
        if (meta?.error instanceof Error) {
          errorLogs.push(meta.error.message);
        } else if (meta?.error) {
          errorLogs.push(String(meta.error));
        }
      }),
      debug: vi.fn(),
    }),
  }));

  vi.doMock('../../../src/models/prisma', () => ({
    connectWithRetry: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    getLastDatabaseHealth: vi.fn(() => true),
    startDatabaseHealthCheck: vi.fn(),
    stopDatabaseHealthCheck: vi.fn(),
  }));

  vi.doMock('../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
    readStaleWalletSchedulePolicy: vi.fn(async () => ({ mode: 'legacy_enabled' })),
  }));

  vi.doMock('../../../src/infrastructure', () => ({
    initializeDistributedLock: vi.fn(() => undefined),
    initializeRedis: vi.fn(async () => undefined),
    shutdownRedis: vi.fn(async () => undefined),
    isRedisConnected: vi.fn(() => redisConnected),
    shutdownDistributedLock: vi.fn(() => undefined),
    getDistributedEventBus: () => ({ on: vi.fn(), emit: vi.fn() }),
    shutdownNotificationDispatcher: vi.fn(async () => undefined),
  }));

  vi.doMock('../../../src/services/featureFlagService', () => ({
    featureFlagService: {
      initialize: vi.fn(async () => reconcileInstalledFeatureSnapshot?.()),
      configureRuntime: vi.fn((_role: string, reconcile: () => Promise<void>) => {
        reconcileInstalledFeatureSnapshot = reconcile;
      }),
      shutdownRuntime: vi.fn(),
      isEnabled: vi.fn(async () => false),
    },
  }));

  vi.doMock('../../../src/services/workerHeartbeatRegistry', () => ({
    WorkerHeartbeatWriter: class {
      write = vi.fn(async () => undefined);
      start = vi.fn();
      stop = vi.fn(async () => undefined);
    },
  }));

  const walletSyncRecoveryRuntime = {
    getActivationState: vi.fn(() => ({ status: 'dormant', requiredFloor: 1 })),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
  vi.doMock('../../../src/worker/walletSyncRecoveryRuntime', () => ({
    createProductionWalletSyncRecoveryRuntime: vi.fn(() => walletSyncRecoveryRuntime),
  }));

  vi.doMock('../../../src/services/sync/syncIntentAdmission', () => ({
    syncIntentAdmission: { request: requestSyncIntent },
  }));

  vi.doMock('../../../src/worker/workerJobQueue', () => ({
    WorkerJobQueue: class {
      constructor() {
        return jobQueueInstance;
      }
    },
  }));

  const electrumOptions: { onNewBlock?: (...args: any[]) => void; onAddressActivity?: (...args: any[]) => void } = {};
  vi.doMock('../../../src/worker/electrumManager', () => ({
    ElectrumSubscriptionManager: class {
      constructor(options: typeof electrumOptions) {
        Object.assign(electrumOptions, options ?? {});
        return electrumManagerInstance;
      }
    },
  }));

  vi.doMock('../../../src/worker/healthServer', () => ({
    startHealthServer: vi.fn(() => healthServerHandle),
  }));

  vi.doMock('../../../src/worker/jobs', () => ({
    registerWorkerJobs,
  }));

  vi.doMock('../../../src/observability/metrics/registry', () => ({
    metricsService: { initialize: vi.fn() },
    registry: {
      metrics: vi.fn(async () => ''),
      contentType: 'text/plain',
      registerMetric: vi.fn(),
      getSingleMetric: vi.fn(),
    },
  }));

  vi.doMock('../../../src/observability/metrics/infrastructureMetrics', () => ({
    jobProcessingDuration: { observe: vi.fn() },
    jobQueueDepth: { set: vi.fn() },
  }));

  vi.doMock('../../../src/observability/metrics/helpers', () => ({
    updateJobQueueMetrics: vi.fn(),
  }));

  vi.doMock('../../../src/services/supportPackage/captureRuntime', () => ({
    startCaptureParticipant: vi.fn(async () => undefined),
    stopCaptureParticipant: vi.fn(async () => undefined),
  }));

  // The worker publishes its WebSocket events onto the Redis bridge. The real
  // module reaches the un-mocked infrastructure/redis and metrics graph, which
  // this harness does not stand up.
  vi.doMock('../../../src/websocket/redisBridge', () => ({
    initializeRedisBridge: vi.fn(async () => undefined),
    shutdownRedisBridge: vi.fn(async () => undefined),
  }));

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  await import('../../../src/worker');
  await otelInit.promise;

  const waitForInit = async () => {
    for (let i = 0; i < 50; i += 1) {
      if (
        jobQueueInstance.initialize.mock.calls.length > 0 &&
        jobQueueInstance.addJob.mock.calls.length > 0
      ) {
        return;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  await waitForInit();
  if (
    jobQueueInstance.initialize.mock.calls.length === 0 ||
    jobQueueInstance.addJob.mock.calls.length === 0
  ) {
    const exitCalls = exitSpy.mock.calls.map((call) => call[0]);
    const logInfo = errorLogs.length ? ` logs: ${errorLogs.join(' | ')}` : '';
    throw new Error(
      `Worker did not initialize job queue. process.exit calls: ${exitCalls.join(', ') || 'none'}${logInfo}`
    );
  }

  return {
    jobQueue: jobQueueInstance,
    electrumManager: electrumManagerInstance,
    healthServer: healthServerHandle,
    registerWorkerJobs,
    requestSyncIntent,
    walletSyncRecoveryRuntime,
    electrumOptions,
    exitSpy,
    shutdown: async () => {
      process.emit('SIGTERM');
      await new Promise((resolve) => setImmediate(resolve));
    },
    stopProcessExitSpy: () => {
      exitSpy.mockRestore();
    },
  };
};
