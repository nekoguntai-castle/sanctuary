import { expect, it, vi } from 'vitest';
import { mocks } from './workerEntryTestHarness';

export function registerWorkerEntryScheduleContracts() {
  it('fails startup when wallet-sync recovery cannot start', async () => {
    vi.spyOn(process, 'on').mockImplementation(((
      _event: string,
      _handler: (...args: any[]) => any,
    ) => process) as any);
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);
    mocks.walletSyncRecoveryRuntime.start.mockRejectedValueOnce(
      new Error('recovery unavailable'),
    );

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Worker startup failed',
      expect.objectContaining({ error: 'recovery unavailable' }),
    );
    expect(mocks.heartbeatInstance.write).toHaveBeenCalledTimes(2);
    expect(mocks.walletSyncRecoveryRuntime.start).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('fails startup before recovery when the initial capability heartbeat cannot publish', async () => {
    vi.spyOn(process, 'on').mockImplementation(((
      _event: string,
      _handler: (...args: any[]) => any,
    ) => process) as any);
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);
    mocks.heartbeatInstance.write.mockRejectedValueOnce(new Error('heartbeat unavailable'));

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Worker startup failed',
      expect.objectContaining({ error: 'heartbeat unavailable' }),
    );
    expect(mocks.heartbeatInstance.start).not.toHaveBeenCalled();
    expect(mocks.createProductionWalletSyncRecoveryRuntime).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exposes activation health without making it queue readiness authority', async () => {
    vi.spyOn(process, 'on').mockImplementation(((
      _event: string,
      _handler: (...args: any[]) => any,
    ) => process) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const activation = {
      status: 'fleet_blocked',
      requiredFloor: 1,
      reason: 'worker_below_floor',
    } as const;
    mocks.walletSyncRecoveryRuntime.getActivationState.mockReturnValue(activation);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    await expect(mocks.getHealthProvider()?.getHealth()).resolves.toEqual({
      redis: true,
      electrum: true,
      jobQueue: true,
      recurringSchedules: true,
      uiEventBridge: true,
      startedAt: expect.any(String),
      walletSyncActivation: activation,
    });
    await expect(mocks.getHealthProvider()?.getMetrics()).resolves.toEqual(
      expect.objectContaining({ walletSyncActivation: activation }),
    );
  });

  it('stops wallet-sync recovery before draining the queue and Redis', async () => {
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

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    await handlers.SIGTERM?.[0]();

    expect(mocks.walletSyncRecoveryRuntime.stop).toHaveBeenCalledOnce();
    expect(mocks.walletSyncRecoveryRuntime.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queueInstance.shutdown.mock.invocationCallOrder[0],
    );
    expect(mocks.walletSyncRecoveryRuntime.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.shutdownRedis.mock.invocationCallOrder[0],
    );
  });

  // Regression: the worker detects most confirmations and new transactions,
  // but never published cache invalidations, so API replicas kept stale wallet
  // summaries until their TTL.
  it('publishes cache invalidations once Redis is up and stops before Redis closes', async () => {
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

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();
    await vi.waitFor(() => expect(mocks.initializeCacheInvalidation).toHaveBeenCalledOnce());
    expect(mocks.initializeRedis.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.initializeCacheInvalidation.mock.invocationCallOrder[0],
    );

    await handlers.SIGTERM?.[0]();

    expect(mocks.shutdownCacheInvalidation).toHaveBeenCalledOnce();
    expect(mocks.shutdownCacheInvalidation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.shutdownRedis.mock.invocationCallOrder[0],
    );
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

    // The retired stale-wallet schedule is removed first; disabled feature
    // schedules follow it in the same forbidden pass.
    expect(mocks.queueInstance.removeRecurring).toHaveBeenCalledWith(
      'sync',
      'check-stale-wallets',
      { purgeQueued: true },
    );
    expect(mocks.queueInstance.startConsumers).not.toHaveBeenCalled();

    releaseRemoval();
    await vi.dynamicImportSettled();

    expect(mocks.queueInstance.removeRecurring).toHaveBeenCalledWith(
      'maintenance',
      'autopilot:record-fees',
      { purgeQueued: true },
    );
    expect(mocks.queueInstance.startConsumers).toHaveBeenCalledOnce();
    expect(mocks.queueInstance.removeRecurring.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queueInstance.startConsumers.mock.invocationCallOrder[0],
    );
  });

  it('purges retired stale-wallet work before consumers and never schedules it', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.queueInstance.removeRecurring).toHaveBeenCalledWith(
      'sync',
      'check-stale-wallets',
      { purgeQueued: true },
    );
    expect(mocks.queueInstance.purgeStaleWalletScheduleJobs).toHaveBeenCalledTimes(2);
    expect(mocks.queueInstance.purgeStaleWalletScheduleJobs.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.queueInstance.startConsumers.mock.invocationCallOrder[0]);
    expect(mocks.queueInstance.scheduleRecurring).not.toHaveBeenCalledWith(
      expect.objectContaining({ schedulerId: 'sync:check-stale-wallets' }),
    );
    expect(mocks.queueInstance.addJob).not.toHaveBeenCalledWith(
      'sync',
      'check-stale-wallets',
      expect.anything(),
      expect.anything(),
    );
  });

  it('fails closed before consumers when retired stale-wallet work cannot be purged', async () => {
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => any) => {
      void event;
      void handler;
      return process;
    }) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    mocks.queueInstance.purgeStaleWalletScheduleJobs.mockResolvedValue({
      status: 'failed',
      error: 'queue inspection failed',
    });

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.queueInstance.startConsumers).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Worker startup failed',
      expect.objectContaining({
        error: expect.stringContaining('sync:stale-wallet-jobs'),
      }),
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
}
