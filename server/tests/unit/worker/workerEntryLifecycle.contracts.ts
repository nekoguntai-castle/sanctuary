import { expect, it, vi } from 'vitest';
import { WORKER_SHUTDOWN_TIMEOUT_MS } from '../../../src/worker/shutdownLifecycle';
import { mocks } from './workerEntryTestHarness';

export function registerWorkerEntryLifecycleContracts() {
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
    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

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
    const intervalDelays: number[] = [];
    const intervalHandle = { id: 'timer-1' } as any;

    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);

    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    vi.spyOn(global, 'setInterval').mockImplementation((((
      cb: () => Promise<void> | void,
      delay: number,
    ) => {
      intervalCallbacks.push(cb);
      intervalDelays.push(delay);
      return intervalHandle;
    }) as any));
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const shutdownDeadlineHandle = { unref: vi.fn() } as any;
    vi.spyOn(global, 'setTimeout').mockImplementation((((
      cb: () => void,
      delay?: number,
    ) => {
      if (delay === WORKER_SHUTDOWN_TIMEOUT_MS) return shutdownDeadlineHandle;
      cb();
      return 1 as any;
    }) as any));

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    for (let i = 0; i < 200 && intervalCallbacks.length < 6; i += 1) {
      await Promise.resolve();
    }

    expect(intervalCallbacks).toHaveLength(6);
    expect(intervalDelays).toContain(5_000);
    expect(mocks.WorkerJobQueue).toHaveBeenCalledWith({
      concurrency: 5,
      concurrencyByQueue: { sync: 1 },
      queues: ['sync', 'notifications', 'confirmations', 'maintenance'],
      autorun: false,
    });
    expect(mocks.startDatabaseHealthCheck).toHaveBeenCalledOnce();
    expect(mocks.networkHeaderReconciliationRuntime.recoverDue).toHaveBeenCalledOnce();
    expect(mocks.electrumInstance.start.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.networkHeaderReconciliationRuntime.recoverDue.mock.invocationCallOrder[0]);
    expect(mocks.networkHeaderReconciliationRuntime.recoverDue.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.queueInstance.startConsumers.mock.invocationCallOrder[0]);

    const healthProvider = mocks.getHealthProvider();
    expect(healthProvider).toBeDefined();
    await expect(healthProvider?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: true,
      jobQueue: true,
      recurringSchedules: true,
      uiEventBridge: true,
      startedAt: expect.any(String),
      walletSyncActivation: {
        status: 'active',
        requiredFloor: 1,
        activatedAt: '2026-08-22T07:00:00.000Z',
      },
    });
    mocks.electrumInstance.isConnected.mockReturnValueOnce(undefined as any);
    mocks.queueInstance.isHealthy.mockReturnValueOnce(undefined as any);
    await expect(healthProvider?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: false,
      jobQueue: false,
      recurringSchedules: true,
      uiEventBridge: true,
      startedAt: expect.any(String),
      walletSyncActivation: {
        status: 'active',
        requiredFloor: 1,
        activatedAt: '2026-08-22T07:00:00.000Z',
      },
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
      walletSyncActivation: {
        status: 'active',
        requiredFloor: 1,
        activatedAt: '2026-08-22T07:00:00.000Z',
      },
    });

    const diagnosticsProvider = mocks.getDiagnosticsProvider();
    expect(diagnosticsProvider).toBeDefined();
    await expect(diagnosticsProvider?.()).resolves.toEqual(
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
    // The worker's breakers are sent only to a request that asks for them.
    await expect(diagnosticsProvider?.()).resolves.not.toHaveProperty('circuitBreakers');
    const breakersProvider = diagnosticsProvider as unknown as (
      request: { protocolVersion: 1; circuitBreakers: true },
    ) => Promise<{ circuitBreakers?: unknown }>;
    const withBreakers = await breakersProvider({ protocolVersion: 1, circuitBreakers: true });
    expect(Array.isArray(withBreakers.circuitBreakers)).toBe(true);

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
      walletSyncActivation: {
        status: 'active',
        requiredFloor: 1,
        activatedAt: '2026-08-22T07:00:00.000Z',
      },
    });

    await Promise.all(intervalCallbacks.map(async (callback) => callback()));
    expect(mocks.electrumInstance.reconcileSubscriptions).toHaveBeenCalledTimes(1);
    expect(mocks.networkHeaderReconciliationRuntime.recoverDue).toHaveBeenCalledTimes(2);

    mocks.electrumInstance.reconcileSubscriptions.mockRejectedValueOnce(new Error('reconcile failed'));
    mocks.networkHeaderReconciliationRuntime.recoverDue.mockRejectedValueOnce(
      new Error('header recovery failed'),
    );
    await Promise.all(intervalCallbacks.map(async (callback) => callback()));
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Subscription reconciliation failed',
      { error: 'reconcile failed' }
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Durable network-header recovery scan failed',
      { error: 'header recovery failed' },
    );

    const electrumCallbacks = mocks.getElectrumCallbacks();
    expect(electrumCallbacks).toBeDefined();

    const fetchHeaders = vi.fn().mockResolvedValue(['00'.repeat(80)]);
    mocks.networkHeaderReconciliationRuntime.observe.mockResolvedValueOnce({ status: 'progressed' });
    await electrumCallbacks?.onHeaderObservation(
      'testnet4',
      { height: 101, hex: 'ab'.repeat(80) },
      fetchHeaders,
    );
    expect(mocks.networkHeaderReconciliationRuntime.observe).toHaveBeenCalledWith(
      'testnet4',
      { height: 101, hex: 'ab'.repeat(80) },
      fetchHeaders,
    );

    mocks.subscriptionCheckpointRuntime.recordStatusPage.mockRejectedValueOnce(
      new Error('cannot persist checkpoint'),
    );
    electrumCallbacks?.onAddressActivity('testnet4', 'a'.repeat(64), 'b'.repeat(64));
    await vi.waitFor(() => {
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'Failed to persist address activity checkpoint',
        expect.objectContaining({ error: 'cannot persist checkpoint' })
      );
    });

    mocks.healthServerHandle.close.mockRejectedValueOnce(new Error('health close failed'));
    mocks.electrumInstance.stop.mockRejectedValueOnce(new Error('electrum stop failed'));
    mocks.queueInstance.shutdown.mockRejectedValueOnce(new Error('queue shutdown failed'));
    mocks.shutdownRedis.mockRejectedValueOnce(new Error('redis shutdown failed'));
    mocks.disconnect.mockRejectedValueOnce(new Error('db disconnect failed'));

    let resolveDatabaseHealthStop: (() => void) | undefined;
    mocks.stopDatabaseHealthCheck.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveDatabaseHealthStop = resolve;
      })
    );

    const shutdownPromise = handlers.SIGTERM?.[0]();
    await vi.waitFor(() => expect(mocks.shutdownRedis).toHaveBeenCalledOnce());
    expect(mocks.disconnect).not.toHaveBeenCalled();
    resolveDatabaseHealthStop?.();
    await shutdownPromise;
    await handlers.SIGTERM?.[0]();
    await handlers.SIGINT?.[0]();
    await Promise.all(intervalCallbacks.map(async (callback) => callback()));
    expect(mocks.networkHeaderReconciliationRuntime.recoverDue).toHaveBeenCalledTimes(3);

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
}
