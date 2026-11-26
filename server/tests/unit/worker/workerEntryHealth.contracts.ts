import { expect, it, vi } from 'vitest';
import { mocks } from './workerEntryTestHarness';

export function registerWorkerEntryHealthContracts() {
  it('reports jobQueue unhealthy when webhook recovery is stale past grace period', async () => {
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
      uiEventBridge: true,
      startedAt: expect.any(String),
      walletSyncActivation: {
        status: 'active',
        requiredFloor: 1,
        activatedAt: '2026-08-22T07:00:00.000Z',
      },
    });

    // Advance past the 90s startup grace with the last completion older than
    // the 2-minute freshness window.
    mockNow = startTime + 700_000;
    mocks.queueInstance.getRecurringHeartbeatSnapshot.mockResolvedValue({
      healthy: true,
      records: {
        'maintenance:webhook:recover-due-deliveries': {
          version: 1,
          schedulerId: 'maintenance:webhook:recover-due-deliveries',
          recurrenceFingerprint: 'pattern:* * * * *:tz:UTC',
          activatedAt: startTime,
          lastCompletedAt: startTime + 10_000,
        },
      },
    });

    const health = await healthProvider?.getHealth();
    expect(health).toEqual({
      redis: true,
      electrum: true,
      jobQueue: false,
      recurringSchedules: false,
      uiEventBridge: true,
      startedAt: expect.any(String),
      walletSyncActivation: {
        status: 'active',
        requiredFloor: 1,
        activatedAt: '2026-08-22T07:00:00.000Z',
      },
    });

    Date.now = realDateNow;
  });

  it('reports unhealthy when webhook recovery is absent', async () => {
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
      uiEventBridge: true,
      startedAt: expect.any(String),
      walletSyncActivation: {
        status: 'active',
        requiredFloor: 1,
        activatedAt: '2026-08-22T07:00:00.000Z',
      },
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

    const reconciliations = intervals.filter(({ delay }) => delay === 60_000);
    expect(reconciliations.length).toBeGreaterThan(0);
    await Promise.all(reconciliations.map(({ callback }) => callback()));
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

  it('skips periodic reconciliation ticks while one is still in flight', async () => {
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

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    let releasePurge!: () => void;
    const purgeHeld = new Promise<void>((resolve) => {
      releasePurge = resolve;
    });
    mocks.queueInstance.purgeStaleWalletScheduleJobs.mockClear();
    mocks.queueInstance.purgeStaleWalletScheduleJobs.mockImplementationOnce(async () => {
      await purgeHeld;
      return { status: 'absent' };
    });
    const reconciliations = intervals.filter(({ delay }) => delay === 60_000);
    expect(reconciliations.length).toBeGreaterThan(0);
    const tick = () => {
      for (const { callback } of reconciliations) void callback();
    };
    const settle = async () => {
      for (let index = 0; index < 50; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    tick();
    await vi.waitFor(() => (
      expect(mocks.queueInstance.purgeStaleWalletScheduleJobs).toHaveBeenCalledOnce()
    ));
    // A hung reconcile must not let later ticks queue behind it.
    tick();
    tick();
    releasePurge();
    await settle();
    expect(mocks.queueInstance.purgeStaleWalletScheduleJobs).toHaveBeenCalledOnce();

    tick();
    await vi.waitFor(() => (
      expect(mocks.queueInstance.purgeStaleWalletScheduleJobs).toHaveBeenCalledTimes(2)
    ));
  });

  it('P1-4 & P2-1: drains jobQueue before stopping electrumManager and closes worker sync queue and Electrum pool during shutdown', async () => {
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

    // Aborted enrollWalletSubscriptions must fail with abort reason, not uninitialized runtime
    const registeredDeps = mocks.registerWorkerJobs.mock.calls[0]?.[1];
    expect(registeredDeps).toBeDefined();
    const abortController = new AbortController();
    abortController.abort(new Error('worker shutting down'));
    await expect(
      registeredDeps!.enrollWalletSubscriptions('wallet-1', 'mainnet', abortController.signal),
    ).rejects.toThrow('worker shutting down');

    await handlers.SIGTERM?.[0]();

    expect(mocks.queueInstance.shutdown).toHaveBeenCalledOnce();
    expect(mocks.electrumInstance.stop).toHaveBeenCalledOnce();
    expect(mocks.queueInstance.shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.electrumInstance.stop.mock.invocationCallOrder[0],
    );
    expect(mocks.closeWorkerSyncQueue).toHaveBeenCalledOnce();
    expect(mocks.shutdownElectrumPool).toHaveBeenCalledOnce();
    expect(mocks.priceServiceShutdown).toHaveBeenCalledOnce();
    expect(mocks.pushServiceShutdown).toHaveBeenCalledOnce();
    expect(mocks.shutdownOpenTelemetry).toHaveBeenCalledOnce();
    expect(mocks.closeWorkerSyncQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.shutdownRedis.mock.invocationCallOrder[0],
    );
    expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.shutdownOpenTelemetry.mock.invocationCallOrder[0],
    );
  });

  it('P2-7: initializes workerStartedAt before first diagnostic heartbeat and writes again right after startConsumers', async () => {
    vi.spyOn(process, 'on').mockImplementation((() => process) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    let firstHeartbeatUptime: string | undefined;
    mocks.heartbeatInstance.write.mockImplementationOnce(async () => {
      const snapshotFn = (mocks.WorkerHeartbeatWriter.mock.calls as unknown[][])[0]?.[0] as
        | (() => { worker: { uptime: string } })
        | undefined;
      firstHeartbeatUptime = snapshotFn?.().worker.uptime;
    });

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(firstHeartbeatUptime).toBeDefined();
    expect(firstHeartbeatUptime).not.toBe('1d+');
    expect(mocks.heartbeatInstance.write).toHaveBeenCalledTimes(2);
    expect(mocks.queueInstance.startConsumers.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.heartbeatInstance.write.mock.invocationCallOrder[1],
    );
  });

  it('P3-3: awaits in-flight periodicScheduleReconciliation before jobQueue.shutdown and unrefs worker timers', async () => {
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

    const intervals: Array<{ callback: () => Promise<void> | void; delay: number; handle: { unref: ReturnType<typeof vi.fn> } }> = [];
    vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => Promise<void> | void,
      delay: number,
    ) => {
      const handle = { unref: vi.fn() };
      intervals.push({ callback, delay, handle });
      return handle as any;
    }) as any);

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    // Verify metricsTimer (15s), scheduleReconciliationTimer (60s), and reconciliationTimer (15m) all called unref()
    for (const delay of [15_000, 60_000, 15 * 60 * 1000]) {
      const matching = intervals.filter(entry => entry.delay === delay);
      expect(matching.length).toBeGreaterThan(0);
      for (const entry of matching) {
        expect(entry.handle.unref).toHaveBeenCalled();
      }
    }

    // Start a slow periodic schedule reconciliation and trigger SIGTERM
    let finishPurge!: () => void;
    mocks.queueInstance.purgeStaleWalletScheduleJobs.mockImplementationOnce(
      () => new Promise(resolve => {
        finishPurge = () => resolve({ status: 'absent' });
      }),
    );
    const scheduleTicks = intervals.filter(entry => entry.delay === 60_000);
    for (const entry of scheduleTicks) void entry.callback();
    await vi.waitFor(() => expect(finishPurge).toBeDefined());

    const shutdownPromise = handlers.SIGTERM?.[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.queueInstance.shutdown).not.toHaveBeenCalled();

    finishPurge();
    await shutdownPromise;
    expect(mocks.queueInstance.shutdown).toHaveBeenCalledOnce();
  });

  it('P3-1: reads worker concurrency and health port from config.worker instead of raw process.env', async () => {
    vi.spyOn(process, 'on').mockImplementation((() => process) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    mocks.getConfig.mockReturnValue({
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
        healthPort: 4102,
        concurrency: 9,
        diagnosticsSecret: 's'.repeat(32),
        diagnosticsTimeoutMs: 3000,
        diagnosticsMaxBodyBytes: 1024,
        diagnosticsMaxConcurrentRequests: 2,
        diagnosticsAuthWindowMs: 60_000,
      },
      features: {
        treasuryAutopilot: false,
      },
    });

    await import('../../../src/worker.ts');
    await vi.dynamicImportSettled();

    expect(mocks.WorkerJobQueue).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 9 }),
    );
    expect(mocks.startHealthServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 4102 }),
    );
  });
}
