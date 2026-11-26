import { expect, it, vi } from 'vitest';
import { WORKER_SHUTDOWN_TIMEOUT_MS } from '../../../src/worker/shutdownLifecycle';
import { mocks, deferred, statusPageResult } from './workerEntryTestHarness';

export function registerWorkerEntryCheckpointContracts() {
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

  it('awaits encryption key validation before connecting to the database and registering job handlers', async () => {
    vi.spyOn(process, 'on').mockImplementation(((
      _event: string,
      _handler: (...args: any[]) => any,
    ) => process) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.validateEncryptionKey).toHaveBeenCalledOnce();
    expect(mocks.validateEncryptionKey.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.connectWithRetry.mock.invocationCallOrder[0],
    );
    expect(mocks.validateEncryptionKey.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.registerWorkerJobs.mock.invocationCallOrder[0],
    );
  });

  it('fails startup and never registers job handlers when the encryption key cannot be validated', async () => {
    vi.spyOn(process, 'on').mockImplementation(((
      _event: string,
      _handler: (...args: any[]) => any,
    ) => process) as any);
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);
    mocks.validateEncryptionKey.mockRejectedValueOnce(
      new Error('Encryption key not initialized. Call validateEncryptionKey() at startup before using encrypt/decrypt.'),
    );

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'FATAL: Missing required environment variable',
      expect.objectContaining({
        error: expect.stringContaining('Encryption key not initialized'),
        hint: expect.stringContaining('ENCRYPTION_KEY'),
      }),
    );
    expect(mocks.connectWithRetry).not.toHaveBeenCalled();
    expect(mocks.registerWorkerJobs).not.toHaveBeenCalled();
    expect(mocks.queueInstance.initialize).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('publishes the initial heartbeat before starting wallet-sync recovery', async () => {
    vi.spyOn(process, 'on').mockImplementation(((
      _event: string,
      _handler: (...args: any[]) => any,
    ) => process) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let resolveHeartbeat!: () => void;
    mocks.heartbeatInstance.write.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveHeartbeat = resolve;
    }));

    await import('../../../src/worker.ts');
    await vi.waitFor(() => expect(mocks.heartbeatInstance.write).toHaveBeenCalledOnce());
    expect(mocks.createProductionWalletSyncRecoveryRuntime).not.toHaveBeenCalled();
    expect(mocks.walletSyncRecoveryRuntime.start).not.toHaveBeenCalled();

    resolveHeartbeat();
    await vi.dynamicImportSettled();

    expect(mocks.heartbeatInstance.write.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.heartbeatInstance.start.mock.invocationCallOrder[0],
    );
    expect(mocks.heartbeatInstance.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.walletSyncRecoveryRuntime.start.mock.invocationCallOrder[0],
    );
  });

  it('starts consumers only after the worker-owned checkpoint transport is ready', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let releaseElectrum!: () => void;
    mocks.electrumInstance.start.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseElectrum = resolve;
    }));

    await import('../../../src/worker.ts');
    await vi.waitFor(() => {
      expect(mocks.electrumInstance.start).toHaveBeenCalledOnce();
    });

    expect(mocks.createProductionSubscriptionCheckpointRuntime).toHaveBeenCalledOnce();
    expect(mocks.queueInstance.startConsumers).not.toHaveBeenCalled();

    releaseElectrum();
    await vi.dynamicImportSettled();

    expect(mocks.queueInstance.startConsumers).toHaveBeenCalledOnce();
    expect(mocks.electrumInstance.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queueInstance.startConsumers.mock.invocationCallOrder[0],
    );

    const [subscribeBatch, isActive] =
      mocks.createProductionSubscriptionCheckpointRuntime.mock.calls[0]!;
    await expect(subscribeBatch({
      network: 'testnet4',
      addresses: ['tb1qcheckpoint'],
    })).resolves.toEqual(new Map());
    expect(mocks.electrumInstance.subscribeCheckpointAddresses).toHaveBeenCalledWith(
      'testnet4',
      ['tb1qcheckpoint'],
    );
    expect(isActive()).toBe(true);

    const callbacks = mocks.getElectrumCallbacks();
    await callbacks?.onNetworkReady?.('testnet4');
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenCalledWith({
      network: 'testnet4',
      limit: 200,
    });

    callbacks?.onAddressActivity('testnet4', 'a'.repeat(64), 'c'.repeat(64));
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledOnce();
    });
    expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledWith({
      network: 'testnet4',
      scriptHash: 'a'.repeat(64),
      observedStatus: 'c'.repeat(64),
      limit: 200,
    });
  });

  it('lets a non-owner consumer wait for the elected owner to finish enrollment', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    mocks.electrumInstance.isSubscriptionOwner.mockReturnValue(false);
    mocks.subscriptionCheckpointRuntime.hasPendingWalletEnrollment
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    const dependencies = mocks.registerWorkerJobs.mock.calls[0]?.[1];
    expect(dependencies).toBeDefined();
    await expect(dependencies!.enrollWalletSubscriptions(
      'wallet-1',
      'testnet4',
      new AbortController().signal,
    )).resolves.toBeUndefined();
    expect(mocks.subscriptionCheckpointRuntime.hasPendingWalletEnrollment).toHaveBeenCalledTimes(2);
    expect(mocks.subscriptionCheckpointRuntime.hasPendingWalletEnrollment).toHaveBeenLastCalledWith({
      network: 'testnet4', walletId: 'wallet-1',
    });
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).not.toHaveBeenCalled();
  });

  it('serializes live status writes for the same network and script hash', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const emptyResult = {
      scanned: 0,
      completed: 0,
      unavailable: 0,
      syncIntents: [],
      dispatch: {
        intents: 0,
        published: 0,
        publicationFailed: 0,
        woken: 0,
        wakeUnavailable: 0,
      },
    };
    mocks.subscriptionCheckpointRuntime.recordStatusPage
      .mockImplementationOnce(async () => {
        await firstWrite;
        return emptyResult;
      })
      .mockResolvedValueOnce(emptyResult);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    const callbacks = mocks.getElectrumCallbacks();
    callbacks!.onAddressActivity('testnet4', 'c'.repeat(64), 'a'.repeat(64));
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledTimes(1);
    });
    callbacks!.onAddressActivity('testnet4', 'c'.repeat(64), 'b'.repeat(64));
    await Promise.resolve();
    expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledTimes(2);
    });
    expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ observedStatus: 'b'.repeat(64) }),
    );
  });

  it('drains every page of accepted address activity before dependency teardown', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: any[]) => any,
    ) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const firstPage = deferred<ReturnType<typeof statusPageResult>>();
    const secondPage = deferred<ReturnType<typeof statusPageResult>>();
    mocks.subscriptionCheckpointRuntime.recordStatusPage
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(secondPage.promise);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    mocks.getElectrumCallbacks()!.onAddressActivity(
      'testnet4',
      'd'.repeat(64),
      'a'.repeat(64),
    );
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledOnce();
    });

    const shutdownPromise = handlers.SIGTERM![0]();
    await Promise.resolve();
    const teardownStartedBeforeDrain = mocks.electrumInstance.stop.mock.calls.length > 0
      || mocks.queueInstance.shutdown.mock.calls.length > 0
      || mocks.shutdownRedis.mock.calls.length > 0
      || mocks.disconnect.mock.calls.length > 0
      || processExitSpy.mock.calls.length > 0;

    firstPage.resolve(statusPageResult(200, 'next-page'));
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledTimes(2);
    });
    expect(mocks.electrumInstance.stop).not.toHaveBeenCalled();
    secondPage.resolve(statusPageResult());
    await shutdownPromise;

    expect(teardownStartedBeforeDrain).toBe(false);
    expect(mocks.electrumInstance.stop).toHaveBeenCalledOnce();
    expect(mocks.queueInstance.shutdown).toHaveBeenCalledOnce();
    expect(mocks.shutdownRedis).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('drains the complete same-key status tail before dependency teardown', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: any[]) => any,
    ) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const firstWrite = deferred<ReturnType<typeof statusPageResult>>();
    const secondWrite = deferred<ReturnType<typeof statusPageResult>>();
    mocks.subscriptionCheckpointRuntime.recordStatusPage
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    const callbacks = mocks.getElectrumCallbacks()!;
    callbacks.onAddressActivity('testnet4', 'e'.repeat(64), 'a'.repeat(64));
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledOnce();
    });
    callbacks.onAddressActivity('testnet4', 'e'.repeat(64), 'b'.repeat(64));

    const shutdownPromise = handlers.SIGTERM![0]();
    firstWrite.resolve(statusPageResult());
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledTimes(2);
    });
    const teardownStartedBeforeTail = mocks.electrumInstance.stop.mock.calls.length > 0
      || mocks.queueInstance.shutdown.mock.calls.length > 0
      || mocks.shutdownRedis.mock.calls.length > 0
      || mocks.disconnect.mock.calls.length > 0;
    secondWrite.resolve(statusPageResult());
    await shutdownPromise;

    expect(teardownStartedBeforeTail).toBe(false);
    expect(mocks.electrumInstance.stop).toHaveBeenCalledOnce();
    expect(mocks.queueInstance.shutdown).toHaveBeenCalledOnce();
    expect(mocks.shutdownRedis).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('settles a rejected accepted checkpoint before completing teardown', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: any[]) => any,
    ) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const write = deferred<ReturnType<typeof statusPageResult>>();
    mocks.subscriptionCheckpointRuntime.recordStatusPage.mockReturnValueOnce(write.promise);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    mocks.getElectrumCallbacks()!.onAddressActivity(
      'testnet4',
      'f'.repeat(64),
      'a'.repeat(64),
    );
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledOnce();
    });

    const shutdownPromise = handlers.SIGTERM![0]();
    await Promise.resolve();
    const teardownStartedBeforeSettlement = mocks.electrumInstance.stop.mock.calls.length > 0
      || mocks.queueInstance.shutdown.mock.calls.length > 0
      || mocks.shutdownRedis.mock.calls.length > 0
      || mocks.disconnect.mock.calls.length > 0;
    write.reject(new Error('checkpoint write failed'));
    await shutdownPromise;

    expect(teardownStartedBeforeSettlement).toBe(false);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to persist address activity checkpoint',
      expect.objectContaining({ error: 'checkpoint write failed' }),
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Accepted subscription checkpoint failed during shutdown',
      { error: 'checkpoint write failed' },
    );
    expect(mocks.electrumInstance.stop).toHaveBeenCalledOnce();
    expect(mocks.queueInstance.shutdown).toHaveBeenCalledOnce();
    expect(mocks.shutdownRedis).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('forces exit 1 at the worker deadline without tearing down active checkpoint dependencies', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: any[]) => any,
    ) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const realSetTimeout = global.setTimeout;
    let deadlineCallback: (() => void) | undefined;
    const deadlineHandle = { unref: vi.fn() } as any;
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    vi.spyOn(global, 'setTimeout').mockImplementation(((
      callback: (...args: any[]) => void,
      delay?: number,
      ...args: any[]
    ) => {
      if (delay === WORKER_SHUTDOWN_TIMEOUT_MS) {
        deadlineCallback = () => callback(...args);
        return deadlineHandle;
      }
      return realSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);
    const write = deferred<ReturnType<typeof statusPageResult>>();
    mocks.subscriptionCheckpointRuntime.recordStatusPage.mockReturnValueOnce(write.promise);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    mocks.getElectrumCallbacks()!.onAddressActivity(
      'testnet4',
      '1'.repeat(64),
      'a'.repeat(64),
    );
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledOnce();
    });

    const shutdownPromise = handlers.SIGTERM![0]();
    const deadlineWasInstalled = deadlineCallback !== undefined;
    deadlineCallback?.();
    await Promise.resolve();
    const teardownStartedAtDeadline = mocks.electrumInstance.stop.mock.calls.length > 0
      || mocks.queueInstance.shutdown.mock.calls.length > 0
      || mocks.shutdownRedis.mock.calls.length > 0
      || mocks.disconnect.mock.calls.length > 0;
    write.resolve(statusPageResult());
    await shutdownPromise;

    expect(deadlineWasInstalled).toBe(true);
    expect(deadlineHandle.unref).toHaveBeenCalledOnce();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(deadlineHandle);
    expect(teardownStartedAtDeadline).toBe(false);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Worker shutdown timed out, forcing exit',
      { timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS },
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(processExitSpy).not.toHaveBeenCalledWith(0);
  });

  it('rejects address activity admitted after shutdown begins', async () => {
    const handlers: Record<string, Array<(...args: any[]) => any>> = {};
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: any[]) => any,
    ) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const stopNetworkHeaders = deferred<void>();
    mocks.networkHeaderReconciliationRuntime.stop.mockReturnValueOnce(stopNetworkHeaders.promise);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    const shutdownPromise = handlers.SIGTERM![0]();
    await vi.waitFor(() => {
      expect(mocks.networkHeaderReconciliationRuntime.stop).toHaveBeenCalledOnce();
    });
    mocks.getElectrumCallbacks()!.onAddressActivity(
      'testnet4',
      '2'.repeat(64),
      'a'.repeat(64),
    );
    await Promise.resolve();
    await Promise.resolve();
    const admittedAfterShutdown = mocks.subscriptionCheckpointRuntime.recordStatusPage.mock.calls.length;
    stopNetworkHeaders.resolve();
    await shutdownPromise;

    expect(admittedAfterShutdown).toBe(0);
    expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).not.toHaveBeenCalled();
  });

  it('orders live activity after the initial checkpoint baseline commits', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let finishEnrollment!: () => void;
    const enrollment = new Promise<void>((resolve) => {
      finishEnrollment = resolve;
    });
    mocks.subscriptionCheckpointRuntime.enrollPendingPage.mockImplementationOnce(async () => {
      await enrollment;
      return {
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
      };
    });

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    const callbacks = mocks.getElectrumCallbacks()!;
    const baseline = callbacks.onNetworkReady!('testnet4');
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenCalledOnce();
    });

    callbacks.onAddressActivity('testnet4', 'a'.repeat(64), 'b'.repeat(64));
    await Promise.resolve();
    expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).not.toHaveBeenCalled();

    finishEnrollment();
    await baseline;
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.recordStatusPage).toHaveBeenCalledOnce();
    });
  });

  it('does not leak unattended periodic work across module resets', async () => {
    vi.spyOn(process, 'on').mockImplementation((() => process) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    // Reproduce the next test's module/mock reset after an imported worker.
    // Its one-second checkpoint interval must not mutate the shared mock later.
    vi.resetModules();
    vi.clearAllMocks();
    await new Promise(resolve => setTimeout(resolve, 1_100));
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).not.toHaveBeenCalled();
  });

  it('advances and wraps the periodic checkpoint enrollment cursor fairly', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let checkpointCallback: (() => Promise<void> | void) | undefined;
    vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => Promise<void> | void,
      interval: number,
    ) => {
      if (interval === 1_000) checkpointCallback = callback;
      return { unref: vi.fn() } as any;
    }) as any);
    mocks.subscriptionCheckpointRuntime.enrollPendingPage
      .mockResolvedValueOnce({
        scanned: 200,
        subscribed: 200,
        unavailable: 0,
        nextCursor: 'checkpoint-200',
        syncIntents: [],
        dispatch: {
          intents: 0,
          published: 0,
          publicationFailed: 0,
          woken: 0,
          wakeUnavailable: 0,
        },
      })
      .mockResolvedValueOnce({
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

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    expect(checkpointCallback).toBeDefined();

    await checkpointCallback!();
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenCalledTimes(1);
    await checkpointCallback!();
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenCalledTimes(2);
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenNthCalledWith(2, {
      network: 'testnet3',
      cursor: 'checkpoint-200',
      limit: 200,
    });

    await checkpointCallback!();
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenCalledTimes(3);
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenNthCalledWith(3, {
      network: 'testnet3',
      limit: 200,
    });
  });

  it('advances and wraps the bounded authoritative status refresh cursor', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let statusRefreshCallback: (() => Promise<void> | void) | undefined;
    vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => Promise<void> | void,
      interval: number,
    ) => {
      if (interval === 60_000 && statusRefreshCallback === undefined) {
        statusRefreshCallback = callback;
      }
      return { unref: vi.fn() } as any;
    }) as any);
    mocks.electrumInstance.refreshSubscriptionStatusPage
      .mockResolvedValueOnce({ scanned: 200, nextCursor: 'address-200', outcome: 'refreshed' })
      .mockResolvedValueOnce({ scanned: 0, outcome: 'refreshed' });

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    expect(statusRefreshCallback).toBeDefined();

    await statusRefreshCallback!();
    expect(mocks.electrumInstance.refreshSubscriptionStatusPage).toHaveBeenCalledTimes(1);
    await statusRefreshCallback!();
    expect(mocks.electrumInstance.refreshSubscriptionStatusPage).toHaveBeenCalledTimes(2);
    expect(mocks.electrumInstance.refreshSubscriptionStatusPage).toHaveBeenNthCalledWith(
      2,
      'testnet3',
      { cursor: 'address-200', limit: 200 },
    );

    await statusRefreshCallback!();
    expect(mocks.electrumInstance.refreshSubscriptionStatusPage).toHaveBeenCalledTimes(3);
    expect(mocks.electrumInstance.refreshSubscriptionStatusPage).toHaveBeenNthCalledWith(
      3,
      'testnet3',
      { limit: 200 },
    );
  });

  async function captureStatusRefreshTimer(): Promise<() => Promise<void> | void> {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let statusRefreshCallback: (() => Promise<void> | void) | undefined;
    vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => Promise<void> | void,
      interval: number,
    ) => {
      if (interval === 60_000 && statusRefreshCallback === undefined) {
        statusRefreshCallback = callback;
      }
      return { unref: vi.fn() } as any;
    }) as any);
    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    expect(statusRefreshCallback).toBeDefined();
    return statusRefreshCallback!;
  }

  it('tags every status observation source and counts only intent-raising completions', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    const callbacks = mocks.getElectrumCallbacks();
    const address = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
    const statuses = new Map<string, string | null>([[address, 'c'.repeat(64)]]);
    const result = (intentsRaised: number) => ({
      scanned: 1,
      completed: 1,
      unavailable: 0,
      intentsRaised,
      syncIntents: [],
      dispatch: {
        intents: intentsRaised,
        published: intentsRaised,
        publicationFailed: 0,
        woken: intentsRaised,
        wakeUnavailable: 0,
      },
    });

    for (const source of ['subscribe', 'reconnect', 'refresh'] as const) {
      mocks.subscriptionCheckpointRuntime.recordStatusPage.mockResolvedValueOnce(result(1));
      await callbacks?.onSubscriptionStatuses?.('testnet4', statuses, source);
      expect(mocks.recordSubscriptionStatusMismatch).toHaveBeenLastCalledWith(
        'testnet4',
        source,
        1,
      );
    }

    mocks.subscriptionCheckpointRuntime.recordStatusPage.mockResolvedValueOnce(result(2));
    callbacks?.onAddressActivity('testnet4', 'a'.repeat(64), 'c'.repeat(64));
    await vi.waitFor(() => {
      expect(mocks.recordSubscriptionStatusMismatch).toHaveBeenLastCalledWith(
        'testnet4',
        'notification',
        2,
      );
    });

    // A matching status raises no intent: the metric is told zero, which it ignores.
    mocks.recordSubscriptionStatusMismatch.mockClear();
    mocks.subscriptionCheckpointRuntime.recordStatusPage.mockResolvedValueOnce(result(0));
    await callbacks?.onSubscriptionStatuses?.('testnet4', statuses, 'refresh');
    expect(mocks.recordSubscriptionStatusMismatch).toHaveBeenCalledWith('testnet4', 'refresh', 0);
    expect(mocks.recordSubscriptionStatusMismatch).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.toSatisfy((n: number) => n > 0),
    );

    // The source is never persisted with the checkpoint observation.
    for (const [input] of mocks.subscriptionCheckpointRuntime.recordStatusPage.mock.calls) {
      expect(input).not.toHaveProperty('source');
    }
  });

  it('records each refresh page outcome and stamps the cycle only when a clean pass wraps', async () => {
    const tick = await captureStatusRefreshTimer();
    const pages = mocks.electrumInstance.refreshSubscriptionStatusPage;

    // Clean two-page pass: refreshed, then the short final page wraps the cursor.
    pages
      .mockResolvedValueOnce({ scanned: 200, nextCursor: 'address-200', outcome: 'refreshed' })
      .mockResolvedValueOnce({ scanned: 10, outcome: 'refreshed' });
    await tick();
    expect(mocks.recordSubscriptionStatusRefreshCycleCompleted).not.toHaveBeenCalled();
    await tick();
    expect(mocks.recordSubscriptionStatusRefreshPage).toHaveBeenCalledTimes(2);
    expect(mocks.recordSubscriptionStatusRefreshPage).toHaveBeenNthCalledWith(1, 'testnet3', 'refreshed');
    expect(mocks.recordSubscriptionStatusRefreshCycleCompleted)
      .toHaveBeenCalledExactlyOnceWith('testnet3', expect.any(Number));

    // A pass that crossed a disconnected page still wraps its cursor but is not stamped.
    mocks.recordSubscriptionStatusRefreshCycleCompleted.mockClear();
    pages
      .mockResolvedValueOnce({ scanned: 200, nextCursor: 'address-200', outcome: 'skipped_disconnected' })
      .mockResolvedValueOnce({ scanned: 10, outcome: 'refreshed' });
    await tick();
    await tick();
    expect(mocks.recordSubscriptionStatusRefreshPage).toHaveBeenCalledWith('testnet3', 'skipped_disconnected');
    expect(mocks.recordSubscriptionStatusRefreshCycleCompleted).not.toHaveBeenCalled();

    // The next clean pass is stamped again.
    pages.mockResolvedValueOnce({ scanned: 0, outcome: 'refreshed' });
    await tick();
    expect(mocks.recordSubscriptionStatusRefreshCycleCompleted).toHaveBeenCalledOnce();

    // Ownership loss mid-page.
    mocks.recordSubscriptionStatusRefreshCycleCompleted.mockClear();
    pages.mockResolvedValueOnce({ scanned: 0, outcome: 'skipped_not_owner' });
    await tick();
    expect(mocks.recordSubscriptionStatusRefreshPage).toHaveBeenLastCalledWith('testnet3', 'skipped_not_owner');
    expect(mocks.recordSubscriptionStatusRefreshCycleCompleted).not.toHaveBeenCalled();
  });

  it('counts a failed refresh page, retries its cursor, and does not stamp the tainted pass', async () => {
    const tick = await captureStatusRefreshTimer();
    const pages = mocks.electrumInstance.refreshSubscriptionStatusPage;
    pages
      .mockResolvedValueOnce({ scanned: 200, nextCursor: 'address-200', outcome: 'refreshed' })
      .mockRejectedValueOnce(new Error('electrum down'))
      .mockResolvedValueOnce({ scanned: 5, outcome: 'refreshed' });
    await tick();
    await tick();
    expect(mocks.recordSubscriptionStatusRefreshPage).toHaveBeenLastCalledWith('testnet3', 'failed');
    await tick();
    expect(pages).toHaveBeenNthCalledWith(3, 'testnet3', { cursor: 'address-200', limit: 200 });
    expect(mocks.recordSubscriptionStatusRefreshCycleCompleted).not.toHaveBeenCalled();
  });

  it('does not skip a managed network while a status refresh is still in flight', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let statusRefreshCallback: (() => Promise<void> | void) | undefined;
    vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => Promise<void> | void,
      interval: number,
    ) => {
      if (interval === 60_000 && statusRefreshCallback === undefined) {
        statusRefreshCallback = callback;
      }
      return { unref: vi.fn() } as any;
    }) as any);
    mocks.electrumInstance.getManagedNetworks.mockReturnValue(['mainnet', 'testnet3']);
    let finishFirst!: (result: { scanned: number; outcome: 'refreshed' }) => void;
    mocks.electrumInstance.refreshSubscriptionStatusPage
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ scanned: 0, outcome: 'refreshed' });

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    const first = statusRefreshCallback!() as Promise<void>;
    expect(statusRefreshCallback!()).toBeUndefined();
    expect(mocks.electrumInstance.refreshSubscriptionStatusPage).toHaveBeenCalledOnce();
    finishFirst({ scanned: 0, outcome: 'refreshed' });
    await first;

    await statusRefreshCallback!();
    expect(mocks.electrumInstance.refreshSubscriptionStatusPage).toHaveBeenNthCalledWith(
      2,
      'testnet3',
      { limit: 200 },
    );
  });

  it('does not skip a managed network while checkpoint enrollment is still in flight', async () => {
    vi.spyOn(process, 'on').mockImplementation(((_event: string, _handler: (...args: any[]) => any) => (
      process
    )) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    let checkpointCallback: (() => Promise<void> | void) | undefined;
    vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => Promise<void> | void,
      interval: number,
    ) => {
      if (interval === 1_000) checkpointCallback = callback;
      return { unref: vi.fn() } as any;
    }) as any);
    mocks.electrumInstance.getManagedNetworks.mockReturnValue(['mainnet', 'testnet3']);
    const emptyCheckpointResult = {
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
    };
    let finishFirst!: (result: typeof emptyCheckpointResult) => void;
    mocks.subscriptionCheckpointRuntime.enrollPendingPage
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(emptyCheckpointResult);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    const first = checkpointCallback!() as Promise<void>;
    await vi.waitFor(() => {
      expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenCalledOnce();
    });
    expect(checkpointCallback!()).toBeUndefined();
    finishFirst(emptyCheckpointResult);
    await first;

    await checkpointCallback!();
    expect(mocks.subscriptionCheckpointRuntime.enrollPendingPage).toHaveBeenNthCalledWith(2, {
      network: 'testnet3',
      limit: 200,
    });
  });
}
