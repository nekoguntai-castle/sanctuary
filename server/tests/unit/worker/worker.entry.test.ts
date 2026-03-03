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
    getRegisteredJobs: vi.fn(),
    isHealthy: vi.fn(),
    getHealth: vi.fn(),
    addJob: vi.fn(),
    scheduleRecurring: vi.fn(),
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

  const WorkerJobQueue = vi.fn(function WorkerJobQueueMock() {
    return queueInstance;
  });
  const ElectrumSubscriptionManager = vi.fn(function ElectrumSubscriptionManagerMock(opts: typeof electrumCallbacks) {
    electrumCallbacks = opts;
    return electrumInstance;
  });
  const startHealthServer = vi.fn((opts: { healthProvider: typeof healthProvider }) => {
    healthProvider = opts.healthProvider;
    return healthServerHandle;
  });

  const getConfig = vi.fn(() => ({
    bitcoin: { network: 'testnet' },
    sync: {
      intervalMs: 5 * 60 * 1000,
      confirmationUpdateIntervalMs: 2 * 60 * 1000,
    },
    maintenance: {
      auditLogRetentionDays: 30,
      priceDataRetentionDays: 30,
      feeEstimateRetentionDays: 7,
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
    getConfig,
    registerWorkerJobs: vi.fn(),
    initializeOpenTelemetry: vi.fn(),
    connectWithRetry: vi.fn(),
    disconnect: vi.fn(),
    initializeRedis: vi.fn(),
    shutdownRedis: vi.fn(),
    isRedisConnected: vi.fn(),
    shutdownDistributedLock: vi.fn(),
    getErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    ),
    getElectrumCallbacks: () => electrumCallbacks,
    getHealthProvider: () => healthProvider,
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
}));

vi.mock('../../../src/infrastructure', () => ({
  initializeRedis: mocks.initializeRedis,
  shutdownRedis: mocks.shutdownRedis,
  isRedisConnected: mocks.isRedisConnected,
  shutdownDistributedLock: mocks.shutdownDistributedLock,
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

vi.mock('../../../src/worker/jobs', () => ({
  registerWorkerJobs: mocks.registerWorkerJobs,
}));

describe('worker entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.initializeOpenTelemetry.mockResolvedValue(undefined);
    mocks.connectWithRetry.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.initializeRedis.mockResolvedValue(undefined);
    mocks.shutdownRedis.mockResolvedValue(undefined);
    mocks.isRedisConnected.mockReturnValue(true);
    mocks.shutdownDistributedLock.mockReturnValue(undefined);

    mocks.queueInstance.initialize.mockResolvedValue(undefined);
    mocks.queueInstance.getRegisteredJobs.mockReturnValue(['check-stale-wallets']);
    mocks.queueInstance.isHealthy.mockReturnValue(true);
    mocks.queueInstance.getHealth.mockResolvedValue({ queues: { sync: { size: 0 } } });
    mocks.queueInstance.addJob.mockResolvedValue(undefined);
    mocks.queueInstance.scheduleRecurring.mockResolvedValue(undefined);
    mocks.queueInstance.shutdown.mockResolvedValue(undefined);

    mocks.electrumInstance.start.mockResolvedValue(undefined);
    mocks.electrumInstance.stop.mockResolvedValue(undefined);
    mocks.electrumInstance.isConnected.mockReturnValue(true);
    mocks.electrumInstance.getHealthMetrics.mockReturnValue({
      totalSubscribedAddresses: 2,
      networks: { testnet: { connected: true } },
    });
    mocks.electrumInstance.reconcileSubscriptions.mockResolvedValue(undefined);

    mocks.healthServerHandle.close.mockResolvedValue(undefined);
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

  it('covers timer, queue-error handlers, process handlers, and graceful shutdown branches', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    let intervalCallback: (() => Promise<void> | void) | undefined;
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
      intervalCallback = cb;
      return intervalHandle;
    }) as any));
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    vi.spyOn(global, 'setTimeout').mockImplementation((((cb: () => void) => {
      cb();
      return 1 as any;
    }) as any));

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    for (let i = 0; i < 200 && !intervalCallback; i += 1) {
      await Promise.resolve();
    }

    expect(intervalCallback).toBeDefined();
    expect(mocks.WorkerJobQueue).toHaveBeenCalledWith({
      concurrency: 5,
      queues: ['sync', 'notifications', 'confirmations', 'maintenance'],
    });

    const healthProvider = mocks.getHealthProvider();
    expect(healthProvider).toBeDefined();
    await expect(healthProvider?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: true,
      jobQueue: true,
    });
    mocks.electrumInstance.isConnected.mockReturnValueOnce(undefined as any);
    mocks.queueInstance.isHealthy.mockReturnValueOnce(undefined as any);
    await expect(healthProvider?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: false,
      jobQueue: false,
    });
    await expect(healthProvider?.getMetrics()).resolves.toEqual({
      queues: { sync: { size: 0 } },
      electrum: {
        subscribedAddresses: 2,
        networks: { testnet: { connected: true } },
      },
    });
    mocks.queueInstance.getHealth.mockResolvedValueOnce(undefined);
    mocks.electrumInstance.getHealthMetrics.mockReturnValueOnce(undefined);
    await expect(healthProvider?.getMetrics()).resolves.toEqual({
      queues: {},
      electrum: {
        subscribedAddresses: 0,
        networks: {},
      },
    });

    await intervalCallback?.();
    expect(mocks.electrumInstance.reconcileSubscriptions).toHaveBeenCalledTimes(1);

    mocks.electrumInstance.reconcileSubscriptions.mockRejectedValueOnce(new Error('reconcile failed'));
    await intervalCallback?.();
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

    handlers.unhandledRejection?.[0](new Error('promise boom'));
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Unhandled promise rejection in worker',
      expect.objectContaining({ reason: 'promise boom' })
    );
    handlers.unhandledRejection?.[0]('plain boom');
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Unhandled promise rejection in worker',
      expect.objectContaining({ reason: 'plain boom', stack: undefined })
    );

    handlers.uncaughtException?.[0](new Error('uncaught boom'));
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Uncaught exception - worker will exit',
      expect.objectContaining({ error: 'uncaught boom' })
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);

    mocks.healthServerHandle.close.mockRejectedValueOnce(new Error('health close failed'));
    mocks.electrumInstance.stop.mockRejectedValueOnce(new Error('electrum stop failed'));
    mocks.queueInstance.shutdown.mockRejectedValueOnce(new Error('queue shutdown failed'));
    mocks.shutdownRedis.mockRejectedValueOnce(new Error('redis shutdown failed'));
    mocks.disconnect.mockRejectedValueOnce(new Error('db disconnect failed'));

    await handlers.SIGTERM?.[0]();
    await handlers.SIGTERM?.[0]();
    await handlers.SIGINT?.[0]();
    await intervalCallback?.();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
    expect(mocks.electrumInstance.reconcileSubscriptions).toHaveBeenCalledTimes(2);
    expect(mocks.shutdownDistributedLock).toHaveBeenCalledTimes(1);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error closing health server',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error stopping Electrum manager',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error shutting down job queue',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error shutting down Redis',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Error disconnecting database',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
