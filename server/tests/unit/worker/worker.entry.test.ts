import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    onJobCompleted: vi.fn(),
    shutdown: vi.fn(),
  };

  const electrumInstance = {
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: vi.fn(),
    getHealthMetrics: vi.fn(),
    reconcileSubscriptions: vi.fn(),
  };

  const healthServerHandle = {
    close: vi.fn(),
  };

  let electrumCallbacks:
    | { onNewBlock: (network: 'bitcoin' | 'testnet', height: number, hash: string) => void; onAddressActivity: (network: 'bitcoin' | 'testnet', walletId: string, address: string) => void }
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
    start: vi.fn(),
    stop: vi.fn(),
  };
  const WorkerHeartbeatWriter = vi.fn(function WorkerHeartbeatWriterMock() {
    return heartbeatInstance;
  });

  const getConfig = vi.fn(() => ({
    bitcoin: { network: 'testnet' },
    sync: {
      intervalMs: 5 * 60 * 1000,
      confirmationUpdateIntervalMs: 2 * 60 * 1000,
      staleBatchSize: 50,
      syncStaggerDelayMs: 2000,
      startupCatchUpBatchSize: 250,
      startupCatchUpDelayMs: 10_000,
      startupCatchUpStaggerDelayMs: 250,
    },
    maintenance: {
      auditLogRetentionDays: 30,
      priceDataRetentionDays: 30,
      feeEstimateRetentionDays: 7,
    },
    worker: {
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
    getConfig,
    registerWorkerJobs: vi.fn(),
    initializeOpenTelemetry: vi.fn(),
    connectWithRetry: vi.fn(),
    disconnect: vi.fn(),
    startDatabaseHealthCheck: vi.fn(),
    stopDatabaseHealthCheck: vi.fn(),
    getLastDatabaseHealth: vi.fn(),
    initializeDistributedLock: vi.fn(),
    initializeRedis: vi.fn(),
    shutdownRedis: vi.fn(),
    isRedisConnected: vi.fn(),
    shutdownDistributedLock: vi.fn(),
    getDistributedEventBus: vi.fn(),
    shutdownNotificationDispatcher: vi.fn(),
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
    startCaptureParticipant: vi.fn(),
    stopCaptureParticipant: vi.fn(),
  };
});

vi.mock('../../../src/utils/tracing/otel', () => ({
  initializeOpenTelemetry: mocks.initializeOpenTelemetry,
}));

vi.mock('../../../src/config', () => ({
  getConfig: mocks.getConfig,
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

vi.mock('../../../src/worker/jobs', () => ({
  registerWorkerJobs: mocks.registerWorkerJobs,
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

// The worker publishes its WebSocket events onto the Redis bridge. The real
// module reaches the un-mocked infrastructure/redis and metrics graph.
vi.mock('../../../src/websocket/redisBridge', () => ({
  initializeRedisBridge: vi.fn(async () => undefined),
  shutdownRedisBridge: vi.fn(async () => undefined),
}));

vi.mock('../../../src/services/supportPackage/captureRuntime', () => ({
  startCaptureParticipant: mocks.startCaptureParticipant, stopCaptureParticipant: mocks.stopCaptureParticipant,
}));

describe('worker entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.initializeOpenTelemetry.mockResolvedValue(undefined);
    mocks.connectWithRetry.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.getLastDatabaseHealth.mockReturnValue(true);
    mocks.initializeRedis.mockResolvedValue(undefined);
    mocks.shutdownRedis.mockResolvedValue(undefined);
    mocks.isRedisConnected.mockReturnValue(true);
    mocks.shutdownDistributedLock.mockReturnValue(undefined);
    mocks.shutdownNotificationDispatcher.mockResolvedValue(undefined);
    mocks.startCaptureParticipant.mockResolvedValue(undefined); mocks.stopCaptureParticipant.mockResolvedValue(undefined);

    mocks.queueInstance.initialize.mockResolvedValue(undefined);
    mocks.queueInstance.startConsumers.mockReturnValue(undefined);
    mocks.queueInstance.getRegisteredJobs.mockReturnValue(['check-stale-wallets']);
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
    mocks.queueInstance.onJobCompleted.mockReturnValue(undefined);
    mocks.queueInstance.shutdown.mockResolvedValue(undefined);

    mocks.electrumInstance.start.mockResolvedValue(undefined);
    mocks.electrumInstance.stop.mockResolvedValue(undefined);
    mocks.electrumInstance.isConnected.mockReturnValue(true);
    mocks.electrumInstance.getHealthMetrics.mockReturnValue({
      isRunning: true,
      ownershipRetryActive: false,
      totalSubscribedAddresses: 2,
      networks: { testnet: { connected: true } },
    });
    mocks.electrumInstance.reconcileSubscriptions.mockResolvedValue(undefined);

    mocks.healthServerHandle.close.mockResolvedValue(undefined);
    mocks.heartbeatInstance.start.mockReturnValue(undefined);
    mocks.heartbeatInstance.stop.mockResolvedValue(undefined);

    mocks.mockFeatureFlagService.initialize.mockImplementation(async () => {
      const reconcileInstalledSnapshot = mocks.mockFeatureFlagService.configureRuntime
        .mock.calls.at(-1)?.[1];
      await reconcileInstalledSnapshot?.();
    });
    mocks.mockFeatureFlagService.isEnabled.mockResolvedValue(false);
  });

  it('handles startup failure by logging and exiting with code 1', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    const processOnSpy = vi
      .spyOn(process, 'on')
      .mockImplementation(((event: string, handler: (...args: any[]) => any) => {
        handlers[event] ??= [];
        handlers[event].push(handler);
        return process;
      }) as any);
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    mocks.connectWithRetry.mockRejectedValueOnce(new Error('db unavailable'));

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Worker startup failed',
      expect.objectContaining({ error: 'db unavailable' })
    );
    expect(mocks.initializeDistributedLock).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(handlers.SIGTERM).toHaveLength(1);
    expect(handlers.SIGINT).toHaveLength(1);
    expect(processOnSpy).toHaveBeenCalled();

    await handlers.SIGTERM?.[0]();
    expect(mocks.healthServerHandle.close).not.toHaveBeenCalled();
    expect(mocks.electrumInstance.stop).not.toHaveBeenCalled();
    expect(mocks.queueInstance.shutdown).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('fails startup when Redis connection check reports disconnected', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    mocks.isRedisConnected.mockReturnValueOnce(false);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Worker startup failed',
      expect.objectContaining({
        error: 'Redis is required for worker - check REDIS_URL',
      })
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('fails startup when a required recurring schedule cannot be reconciled', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);
    mocks.queueInstance.scheduleRecurring.mockResolvedValueOnce({
      status: 'failed',
      error: 'Redis unavailable',
    });

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Worker startup failed',
      expect.objectContaining({
        error: expect.stringContaining('Required recurring schedule reconciliation failed'),
      }),
    );
    expect(mocks.startHealthServer).not.toHaveBeenCalled();
    expect(mocks.queueInstance.startConsumers).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('makes strict feature reconciliation reject when a recurring schedule is unhealthy', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    const reconcileInstalledSnapshot = mocks.mockFeatureFlagService.configureRuntime
      .mock.calls[0]?.[1];
    mocks.queueInstance.scheduleRecurring.mockResolvedValueOnce({
      status: 'failed',
      error: 'Redis unavailable',
    });

    await expect(reconcileInstalledSnapshot()).rejects.toThrow(
      'Required recurring schedule reconciliation failed',
    );
  });

  it('does not execute retained disabled-feature jobs before convergence', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let releaseRemoval!: () => void;
    const removalPending = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    mocks.queueInstance.removeRecurring.mockImplementationOnce(async () => {
      await removalPending;
      return { status: 'removed' };
    });
    mocks.mockFeatureFlagService.initialize.mockImplementationOnce(async () => {
      const reconcileInstalledSnapshot = mocks.mockFeatureFlagService.configureRuntime
        .mock.calls[0]?.[1];
      await reconcileInstalledSnapshot();
    });

    await import('../../../src/worker.ts');
    for (let index = 0; index < 100 && !mocks.queueInstance.removeRecurring.mock.calls.length; index += 1) {
      await Promise.resolve();
    }

    expect(mocks.queueInstance.removeRecurring).toHaveBeenCalledWith(
      'maintenance',
      'autopilot:record-fees',
      { purgeQueued: true },
    );
    expect(mocks.queueInstance.startConsumers).not.toHaveBeenCalled();

    releaseRemoval();
    await vi.dynamicImportSettled();

    expect(mocks.queueInstance.startConsumers).toHaveBeenCalledOnce();
    expect(mocks.queueInstance.removeRecurring.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queueInstance.startConsumers.mock.invocationCallOrder[0],
    );
  });

  it('returns early when recurring scheduling is invoked before queue initialization', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    // Fail before WorkerJobQueue is created, leaving internal jobQueue as null.
    mocks.connectWithRetry.mockRejectedValueOnce(new Error('db unavailable'));

    const workerModule = await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    await workerModule.__testOnlyScheduleRecurringJobs();

    expect(mocks.queueInstance.scheduleRecurring).not.toHaveBeenCalled();
  });

  it('schedules recurring price and fee persistence independently of feature flags', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.initializeDistributedLock).toHaveBeenCalledWith(
      'redis-required',
    );
    expect(mocks.registerWorkerJobs.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queueInstance.initialize.mock.invocationCallOrder[0],
    );
    expect(mocks.queueInstance.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'maintenance:persist:price-fees',
        recurrence: { pattern: '* * * * *', tz: 'UTC' },
      }),
    );
  });

  it('schedules autopilot recurring jobs when treasuryAutopilot feature flag is enabled', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    mocks.mockFeatureFlagService.isEnabled.mockResolvedValue(true);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.queueInstance.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'maintenance:autopilot:record-fees',
        recurrence: { pattern: '*/10 * * * *', tz: 'UTC' },
      }),
    );
    expect(mocks.queueInstance.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'maintenance:autopilot:evaluate',
        recurrence: { pattern: '5/10 * * * *', tz: 'UTC' },
      }),
    );
  });

  it('reacts to featureFlag.changed events by scheduling and removing autopilot jobs', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    let autopilotEnabled = false;
    mocks.mockFeatureFlagService.isEnabled.mockImplementation(
      async (key: string) => key === 'treasuryAutopilot' && autopilotEnabled,
    );

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    const reconcileInstalledSnapshot = mocks.mockFeatureFlagService.configureRuntime
      .mock.calls[0]?.[1];
    expect(reconcileInstalledSnapshot).toBeDefined();

    mocks.queueInstance.scheduleRecurring.mockClear();
    mocks.queueInstance.removeRecurring.mockClear();

    await reconcileInstalledSnapshot();
    expect(mocks.queueInstance.removeRecurring).toHaveBeenCalledWith(
      'maintenance',
      'autopilot:record-fees',
      expect.anything(),
    );
    mocks.queueInstance.scheduleRecurring.mockClear();
    mocks.queueInstance.removeRecurring.mockClear();

    autopilotEnabled = true;
    await reconcileInstalledSnapshot();

    expect(mocks.queueInstance.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'maintenance:autopilot:record-fees',
      }),
    );
    expect(mocks.queueInstance.scheduleRecurring).toHaveBeenCalledWith(
      expect.objectContaining({
        schedulerId: 'maintenance:autopilot:evaluate',
      }),
    );
    expect(mocks.queueInstance.removeRecurring).not.toHaveBeenCalledWith(
      'maintenance',
      'autopilot:record-fees',
      expect.anything(),
    );

    mocks.queueInstance.removeRecurring.mockClear();
    autopilotEnabled = false;
    await reconcileInstalledSnapshot();

    expect(mocks.queueInstance.removeRecurring).toHaveBeenCalledWith(
      'maintenance',
      'autopilot:record-fees',
      { purgeQueued: true }
    );
    expect(mocks.queueInstance.removeRecurring).toHaveBeenCalledWith(
      'maintenance',
      'autopilot:evaluate',
      { purgeQueued: true }
    );
  });

  it('setupStaleWalletHandler registers onJobCompleted and queues sync jobs for stale wallets', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    // onJobCompleted should have been called with 'sync', 'check-stale-wallets'
    expect(mocks.queueInstance.onJobCompleted).toHaveBeenCalledWith(
      'sync',
      'check-stale-wallets',
      expect.any(Function)
    );

    // Get the registered callback
    const callback = mocks.queueInstance.onJobCompleted.mock.calls.find(
      (call: any) => call[0] === 'sync' && call[1] === 'check-stale-wallets'
    )?.[2];
    expect(callback).toBeDefined();

    // Simulate stale wallet check completing with results
    await callback({ staleWalletIds: ['w1', 'w2'], queued: 2 });

    expect(mocks.queueInstance.addBulkJobs).toHaveBeenCalledWith(
      'sync',
      expect.arrayContaining([
        expect.objectContaining({
          name: 'sync-wallet',
          data: { walletId: 'w1', priority: 'low', reason: 'stale' },
          options: expect.objectContaining({ delay: 0, priority: 3 }),
        }),
        expect.objectContaining({
          name: 'sync-wallet',
          data: { walletId: 'w2', priority: 'low', reason: 'stale' },
          options: expect.objectContaining({ delay: 2000, priority: 3 }),
        }),
      ])
    );
  });

  it('setupStaleWalletHandler skips queueing when no stale wallets found', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    const callback = mocks.queueInstance.onJobCompleted.mock.calls.find(
      (call: any) => call[0] === 'sync' && call[1] === 'check-stale-wallets'
    )?.[2];

    // Empty result
    await callback({ staleWalletIds: [], queued: 0 });
    expect(mocks.queueInstance.addBulkJobs).not.toHaveBeenCalled();

    // Undefined result
    await callback(undefined);
    expect(mocks.queueInstance.addBulkJobs).not.toHaveBeenCalled();
  });

  it('treats unhandled rejections as fatal and shuts down with code 1', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);

    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    handlers.unhandledRejection?.[0](new Error('promise boom'));
    for (let i = 0; i < 20 && !processExitSpy.mock.calls.length; i += 1) {
      await Promise.resolve();
    }

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Fatal process event - shutting down',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'promise boom',
      })
    );
    expect(mocks.healthServerHandle.close).toHaveBeenCalledTimes(1);
    expect(mocks.electrumInstance.stop).toHaveBeenCalledTimes(1);
    expect(mocks.queueInstance.shutdown).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(1);

    handlers.uncaughtException?.[0](new Error('second boom'));
    expect(mocks.healthServerHandle.close).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Fatal process event ignored; shutdown already in progress',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'second boom',
      })
    );
  });

  it('covers timer, queue-error handlers, process handlers, and graceful shutdown branches', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    const intervalCallbacks: Array<() => Promise<void> | void> = [];
    const intervalHandle = { id: 'timer-1' } as any;

    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);

    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    vi.spyOn(global, 'setInterval').mockImplementation((((cb: () => Promise<void> | void) => {
      intervalCallbacks.push(cb);
      return intervalHandle;
    }) as any));
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    vi.spyOn(global, 'setTimeout').mockImplementation((((cb: () => void) => {
      cb();
      return 1 as any;
    }) as any));

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    for (let i = 0; i < 200 && intervalCallbacks.length < 3; i += 1) {
      await Promise.resolve();
    }

    expect(intervalCallbacks).toHaveLength(3);
    expect(mocks.WorkerJobQueue).toHaveBeenCalledWith({
      concurrency: 5,
      queues: ['sync', 'notifications', 'confirmations', 'maintenance'],
      autorun: false,
    });
    expect(mocks.startDatabaseHealthCheck).toHaveBeenCalledOnce();

    const healthProvider = mocks.getHealthProvider();
    expect(healthProvider).toBeDefined();
    await expect(healthProvider?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: true,
      jobQueue: true,
      recurringSchedules: true,
    });
    mocks.electrumInstance.isConnected.mockReturnValueOnce(undefined as any);
    mocks.queueInstance.isHealthy.mockReturnValueOnce(undefined as any);
    await expect(healthProvider?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: false,
      jobQueue: false,
      recurringSchedules: true,
    });
    await expect(healthProvider?.getMetrics()).resolves.toEqual({
      worker: expect.objectContaining({
        hostname: expect.any(String),
        pid: process.pid,
        startedAt: expect.any(String),
        concurrency: 5,
        electrumSubscriptionOwner: true,
      }),
      queues: { sync: { size: 0 } },
      electrum: {
        isRunning: true,
        ownershipRetryActive: false,
        subscribedAddresses: 2,
        networks: { testnet: { connected: true } },
      },
      jobCompletions: expect.any(Object),
      recurringSchedules: {
        healthy: true,
        missing: [],
        mismatched: [],
        stale: [],
        unexpected: [],
        inspectionFailures: [],
        reconciliationFailed: false,
        heartbeatHealthy: true,
        completionTimes: expect.any(Object),
      },
    });

    const diagnosticsProvider = mocks.getDiagnosticsProvider();
    expect(diagnosticsProvider).toBeDefined();
    expect(diagnosticsProvider?.()).toEqual(
      expect.objectContaining({
        protocolVersion: 1,
        notificationPipeline: {
          consumerRunning: true,
          transactionHandlerRegistered: true,
        },
        redis: { state: 'connected' },
        database: { state: 'connected' },
        notificationTelemetryWriter: {
          observation: 'observed',
          circuit: 'closed',
          droppedEvents: 'zero',
        },
      }),
    );
    mocks.queueInstance.getHealth.mockResolvedValueOnce(undefined);
    mocks.electrumInstance.getHealthMetrics.mockReturnValueOnce(undefined);
    await expect(healthProvider?.getMetrics()).resolves.toEqual({
      worker: expect.objectContaining({
        hostname: expect.any(String),
        pid: process.pid,
        startedAt: expect.any(String),
        concurrency: 5,
        electrumSubscriptionOwner: false,
      }),
      queues: {},
      electrum: {
        isRunning: false,
        ownershipRetryActive: false,
        subscribedAddresses: 0,
        networks: {},
      },
      jobCompletions: expect.any(Object),
      recurringSchedules: {
        healthy: true,
        missing: [],
        mismatched: [],
        stale: [],
        unexpected: [],
        inspectionFailures: [],
        reconciliationFailed: false,
        heartbeatHealthy: true,
        completionTimes: expect.any(Object),
      },
    });

    await Promise.all(intervalCallbacks.map(async (callback) => callback()));
    expect(mocks.electrumInstance.reconcileSubscriptions).toHaveBeenCalledTimes(1);

    mocks.electrumInstance.reconcileSubscriptions.mockRejectedValueOnce(new Error('reconcile failed'));
    await Promise.all(intervalCallbacks.map(async (callback) => callback()));
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Subscription reconciliation failed',
      { error: 'reconcile failed' }
    );

    const electrumCallbacks = mocks.getElectrumCallbacks();
    expect(electrumCallbacks).toBeDefined();

    mocks.queueInstance.addJob.mockRejectedValueOnce(new Error('cannot queue confirmations'));
    electrumCallbacks?.onNewBlock('testnet', 101, 'abc');
    await Promise.resolve();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to queue confirmation update job',
      expect.objectContaining({ error: 'cannot queue confirmations' })
    );

    mocks.queueInstance.addJob.mockRejectedValueOnce(new Error('cannot queue sync'));
    electrumCallbacks?.onAddressActivity('testnet', 'wallet-1', 'tb1qxyz');
    await Promise.resolve();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to queue sync job',
      expect.objectContaining({ error: 'cannot queue sync' })
    );

    mocks.healthServerHandle.close.mockRejectedValueOnce(new Error('health close failed'));
    mocks.electrumInstance.stop.mockRejectedValueOnce(new Error('electrum stop failed'));
    mocks.queueInstance.shutdown.mockRejectedValueOnce(new Error('queue shutdown failed'));
    mocks.shutdownRedis.mockRejectedValueOnce(new Error('redis shutdown failed'));
    mocks.disconnect.mockRejectedValueOnce(new Error('db disconnect failed'));

    await handlers.SIGTERM?.[0]();
    await handlers.SIGTERM?.[0]();
    await handlers.SIGINT?.[0]();
    await Promise.all(intervalCallbacks.map(async (callback) => callback()));

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
    expect(mocks.electrumInstance.reconcileSubscriptions).toHaveBeenCalledTimes(2);
    expect(mocks.shutdownDistributedLock).toHaveBeenCalledTimes(1);
    expect(mocks.stopDatabaseHealthCheck).toHaveBeenCalledOnce();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error closing health server',
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error stopping Electrum manager',
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error shutting down job queue',
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error shutting down Redis',
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error disconnecting database',
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('queues a startup catch-up check-stale-wallets job with configured delay and batch settings', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.queueInstance.addJob).toHaveBeenCalledWith(
      'sync',
      'check-stale-wallets',
      {
        maxWallets: 250,
        priority: 'normal',
        staggerDelayMs: 250,
        reason: 'startup-catch-up',
      },
      expect.objectContaining({
        delay: 10_000,
        jobId: expect.stringMatching(/^startup-catch-up:\d+$/),
      })
    );
  });

  it('reports jobQueue unhealthy when check-stale-wallets is stale past grace period', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    // Force Date.now to simulate time passage past the grace period
    const realDateNow = Date.now;
    const startTime = realDateNow();
    let mockNow = startTime;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    const healthProvider = mocks.getHealthProvider();
    expect(healthProvider).toBeDefined();

    // During startup grace period — should still be healthy
    await expect(healthProvider?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: true,
      jobQueue: true,
      recurringSchedules: true,
    });

    // Advance past grace period (syncIntervalMs=300000 + 30000 = 330000)
    // and set last completion to a stale time (>2x interval = 600000ms ago)
    mockNow = startTime + 700_000; // past grace period, and stale
    mocks.queueInstance.getRecurringHeartbeatSnapshot.mockResolvedValue({
      healthy: true,
      records: {
        'sync:check-stale-wallets': {
          version: 1,
          schedulerId: 'sync:check-stale-wallets',
          recurrenceFingerprint: 'every:300000',
          activatedAt: startTime,
          lastCompletedAt: startTime + 10_000,
        },
        'maintenance:webhook:recover-due-deliveries': {
          version: 1,
          schedulerId: 'maintenance:webhook:recover-due-deliveries',
          recurrenceFingerprint: 'pattern:* * * * *:tz:UTC',
          activatedAt: startTime,
          lastCompletedAt: mockNow,
        },
      },
    });

    const health = await healthProvider?.getHealth();
    expect(health).toEqual({
      redis: true,
      electrum: true,
      jobQueue: false,
      recurringSchedules: false,
    });

    Date.now = realDateNow;
  });

  it('reports unhealthy when webhook recovery is absent even while stale-wallet is fresh', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    mocks.queueInstance.inspectRecurringSchedules.mockResolvedValueOnce({
      healthy: false,
      missing: ['maintenance:webhook:recover-due-deliveries'],
      mismatched: [],
      unexpected: [],
      inspectionFailures: [],
    });
    const health = await mocks.getHealthProvider()?.getHealth();

    expect(health).toEqual({
      redis: true,
      electrum: true,
      jobQueue: false,
      recurringSchedules: false,
    });
  });

  it('restores readiness after periodic schedule reconciliation', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const intervals: Array<{ callback: () => Promise<void> | void; delay: number }> = [];
    vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => Promise<void> | void,
      delay: number,
    ) => {
      intervals.push({ callback, delay });
      return { delay } as any;
    }) as any);
    let schedulesPresent = true;
    mocks.queueInstance.scheduleRecurring.mockImplementation(async () => {
      schedulesPresent = true;
      return { status: 'created' };
    });
    mocks.queueInstance.inspectRecurringSchedules.mockImplementation(async () => ({
      healthy: schedulesPresent,
      missing: schedulesPresent ? [] : ['maintenance:webhook:recover-due-deliveries'],
      mismatched: [],
      unexpected: [],
      inspectionFailures: [],
    }));

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    schedulesPresent = false;

    await expect(mocks.getHealthProvider()?.getHealth()).resolves.toEqual(
      expect.objectContaining({ jobQueue: false, recurringSchedules: false }),
    );

    const reconciliation = intervals.find(({ delay }) => delay === 60_000);
    expect(reconciliation).toBeDefined();
    reconciliation?.callback();
    let recovered = false;
    for (let index = 0; index < 100 && !recovered; index += 1) {
      await Promise.resolve();
      recovered = Boolean(
        (await mocks.getHealthProvider()?.getHealth() as {
          recurringSchedules?: boolean;
        } | undefined)?.recurringSchedules,
      );
    }
    expect(recovered).toBe(true);
  });
});
