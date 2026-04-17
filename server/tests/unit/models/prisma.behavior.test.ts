import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type QueryExtension = (args: {
  operation: string;
  model: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

type LoadedPrismaModule = {
  mod: typeof import('../../../src/models/prisma');
  connectMock: Mock;
  disconnectMock: Mock;
  queryRawMock: Mock;
  transactionMock: Mock;
  observeMock: Mock;
  adapterOptions: Array<{ connectionString: string }>;
  logger: {
    info: Mock;
    warn: Mock;
    error: Mock;
    debug: Mock;
  };
  queryExtension: QueryExtension | null;
  onHandlers: Record<string, (...args: unknown[]) => unknown>;
  processOnSpy: ReturnType<typeof vi.spyOn>;
};

async function loadPrismaModule(): Promise<LoadedPrismaModule> {
  vi.resetModules();

  let queryExtension: QueryExtension | null = null;
  const connectMock = vi.fn();
  const disconnectMock = vi.fn();
  const queryRawMock = vi.fn();
  const transactionMock = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({ user: { findMany: vi.fn() } }));
  const observeMock = vi.fn();
  const adapterOptions: Array<{ connectionString: string }> = [];
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const onHandlers: Record<string, (...args: unknown[]) => unknown> = {};

  vi.doMock('../../../src/generated/prisma/client', () => ({
    PrismaClient: class MockPrismaClient {
      $extends(config: { query?: { $allModels?: { $allOperations?: QueryExtension } } }) {
        if (config.query?.$allModels?.$allOperations) {
          queryExtension = config.query.$allModels.$allOperations;
        }
        return this;
      }
      $connect = connectMock;
      $disconnect = disconnectMock;
      $queryRaw = queryRawMock;
      $transaction = transactionMock;
    },
  }));

  vi.doMock('@prisma/adapter-pg', () => ({
    PrismaPg: class MockPrismaPg {
      constructor(options: { connectionString: string }) {
        adapterOptions.push(options);
      }
    },
  }));

  vi.doMock('../../../src/utils/logger', () => ({
    createLogger: () => logger,
  }));

  vi.doMock('../../../src/utils/errors', () => ({
    getErrorMessage: (error: unknown) => {
      if (error instanceof Error) return error.message;
      return String(error);
    },
  }));

  vi.doMock('../../../src/observability/metrics', () => ({
    dbQueryDuration: {
      observe: observeMock,
    },
  }));

  const processOnSpy = vi
    .spyOn(process, 'on')
    .mockImplementation(((event: string, handler: (...args: unknown[]) => unknown) => {
      onHandlers[event] = handler;
      return process;
    }) as Parameters<typeof process.on>[1] as never);

  const mod = await import('../../../src/models/prisma');

  return {
    mod,
    connectMock,
    disconnectMock,
    queryRawMock,
    transactionMock,
    observeMock,
    adapterOptions,
    logger,
    queryExtension,
    onHandlers,
    processOnSpy,
  };
}

describe('models/prisma behavior', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const restoreDatabaseUrl = () => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
      return;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    restoreDatabaseUrl();
  });

  afterEach(() => {
    restoreDatabaseUrl();
    vi.useRealTimers();
  });

  it('initializes the Prisma adapter with the configured database URL', async () => {
    process.env.DATABASE_URL = 'postgresql://sanctuary:test@localhost:5432/sanctuary';

    const { adapterOptions, processOnSpy } = await loadPrismaModule();

    expect(adapterOptions).toEqual([
      { connectionString: 'postgresql://sanctuary:test@localhost:5432/sanctuary' },
    ]);
    processOnSpy.mockRestore();
  });

  it('initializes the Prisma adapter with an empty connection string when DATABASE_URL is absent', async () => {
    delete process.env.DATABASE_URL;

    const { adapterOptions, processOnSpy } = await loadPrismaModule();

    expect(adapterOptions).toEqual([{ connectionString: '' }]);
    processOnSpy.mockRestore();
  });

  it('withTransaction delegates callback execution to Prisma', async () => {
    const { mod, transactionMock, processOnSpy } = await loadPrismaModule();
    const callback = vi.fn().mockResolvedValue('tx-result');

    await expect(mod.withTransaction(callback)).resolves.toBe('tx-result');

    expect(transactionMock).toHaveBeenCalledWith(callback);
    expect(callback).toHaveBeenCalledWith({ user: { findMany: expect.any(Function) } });
    processOnSpy.mockRestore();
  });

  it('connectWithRetry succeeds immediately when connection works', async () => {
    const { mod, connectMock, processOnSpy } = await loadPrismaModule();
    connectMock.mockResolvedValue(undefined);

    await expect(mod.connectWithRetry()).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(1);
    processOnSpy.mockRestore();
  });

  it('connectWithRetry retries and succeeds on a later attempt', async () => {
    const { mod, connectMock, processOnSpy } = await loadPrismaModule();
    connectMock
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(undefined);

    const promise = mod.connectWithRetry();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    expect(connectMock).toHaveBeenCalledTimes(2);
    processOnSpy.mockRestore();
  });

  it('connectWithRetry throws after max retries', async () => {
    const { mod, connectMock, processOnSpy } = await loadPrismaModule();
    connectMock.mockRejectedValue(new Error('connection failed'));

    const promise = expect(mod.connectWithRetry()).rejects.toThrow('connection failed');
    await vi.runAllTimersAsync();
    await promise;

    expect(connectMock).toHaveBeenCalledTimes(5);
    processOnSpy.mockRestore();
  });

  it('checkDatabaseHealth and getDatabaseInfo return success/failure states', async () => {
    const { mod, queryRawMock, processOnSpy } = await loadPrismaModule();
    queryRawMock
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('health down'))
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('info down'));

    await expect(mod.checkDatabaseHealth()).resolves.toBe(true);
    await expect(mod.checkDatabaseHealth()).resolves.toBe(false);

    const healthyInfo = await mod.getDatabaseInfo();
    expect(healthyInfo.connected).toBe(true);
    expect(healthyInfo.latencyMs).toBeTypeOf('number');

    const unhealthyInfo = await mod.getDatabaseInfo();
    expect(unhealthyInfo.connected).toBe(false);
    expect(unhealthyInfo.error).toBe('info down');
    processOnSpy.mockRestore();
  });

  it('query extension records metrics and slow-query warnings', async () => {
    const { queryExtension, observeMock, logger, processOnSpy } = await loadPrismaModule();
    expect(queryExtension).not.toBeNull();

    const nowSpy = vi.spyOn(Date, 'now').mockImplementationOnce(() => 0).mockImplementationOnce(() => 150);

    await expect(
      queryExtension!({
        operation: 'findMany',
        model: 'Wallet',
        args: {},
        query: async () => ({ ok: true }),
      })
    ).resolves.toEqual({ ok: true });

    expect(observeMock).toHaveBeenCalledWith({ operation: 'select' }, 0.15);
    expect(logger.warn).toHaveBeenCalledWith('Slow query (150ms): Wallet.findMany', {
      model: 'Wallet',
      action: 'findMany',
      duration: 150,
    });

    nowSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  it('query extension falls back to unknown operation when action is missing', async () => {
    const { queryExtension, observeMock, processOnSpy } = await loadPrismaModule();
    expect(queryExtension).not.toBeNull();

    await queryExtension!({
      operation: 'customAction',
      model: 'Wallet',
      args: {},
      query: async () => ({ ok: true }),
    });

    expect(observeMock).toHaveBeenCalledWith({ operation: 'other' }, expect.any(Number));
    processOnSpy.mockRestore();
  });

  it('caps latency window at configured size', async () => {
    const { mod, queryExtension, processOnSpy } = await loadPrismaModule();

    for (let i = 0; i < 101; i++) {
      await queryExtension!({
        operation: 'findMany',
        model: 'Wallet',
        args: {},
        query: async () => ({ i }),
      });
    }

    const metrics = mod.getPoolHealthMetrics();
    expect(metrics.queryCount).toBe(100);
    processOnSpy.mockRestore();
  });

  it('pool health metrics report healthy/degraded/unhealthy and respect threshold config', async () => {
    const { mod, queryExtension, processOnSpy } = await loadPrismaModule();
    expect(mod.getPoolHealthMetrics()).toEqual({
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      queryCount: 0,
      status: 'healthy',
    });

    const nowSpy1 = vi.spyOn(Date, 'now').mockImplementationOnce(() => 0).mockImplementationOnce(() => 120);
    await queryExtension!({
      operation: 'findUnique',
      model: 'Wallet',
      args: {},
      query: async () => ({ ok: true }),
    });
    nowSpy1.mockRestore();

    mod.configurePoolHealthThresholds({ warningThresholdMs: 100, criticalThresholdMs: 500 });
    expect(mod.getPoolHealthMetrics().status).toBe('degraded');

    mod.configurePoolHealthThresholds({ criticalThresholdMs: 110 });
    const unhealthy = mod.getPoolHealthMetrics();
    expect(unhealthy.status).toBe('unhealthy');
    expect(unhealthy.warning).toContain('critical threshold');
    processOnSpy.mockRestore();
  });

  it('can update only warning threshold without changing critical threshold', async () => {
    const { mod, processOnSpy } = await loadPrismaModule();

    mod.configurePoolHealthThresholds({ warningThresholdMs: 42 });
    expect(mod.getPoolHealthMetrics().status).toBe('healthy');

    processOnSpy.mockRestore();
  });

  it('disconnect waits for active query extension to drain before disconnecting', async () => {
    const { mod, queryExtension, disconnectMock, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    let resolveQuery: ((value: unknown) => void) | undefined;
    const inflight = queryExtension!({
      operation: 'findMany',
      model: 'Wallet',
      args: {},
      query: () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    });

    const disconnectPromise = mod.disconnect();
    await vi.advanceTimersByTimeAsync(250);
    resolveQuery?.({ ok: true });
    await inflight;
    await vi.runAllTimersAsync();
    await disconnectPromise;

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    processOnSpy.mockRestore();
  });

  it('disconnect force-closes when active queries do not drain before timeout', async () => {
    const { mod, queryExtension, disconnectMock, logger, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    void queryExtension!({
      operation: 'findMany',
      model: 'Wallet',
      args: {},
      query: () => new Promise(() => undefined),
    });

    const disconnectPromise = mod.disconnect();
    await vi.advanceTimersByTimeAsync(10_250);
    await disconnectPromise;

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Force disconnecting with 1 queries still active');
    processOnSpy.mockRestore();
  });

  it('disconnects immediately when there are no active queries', async () => {
    const { mod, disconnectMock, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    await mod.disconnect();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    processOnSpy.mockRestore();
  });

  it('startDatabaseHealthCheck runs checks, reconnects when unhealthy, and can be stopped', async () => {
    const { mod, queryRawMock, disconnectMock, connectMock, processOnSpy } = await loadPrismaModule();
    queryRawMock
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(1);
    disconnectMock.mockResolvedValue(undefined);
    connectMock.mockResolvedValue(undefined);

    mod.startDatabaseHealthCheck(100);
    mod.startDatabaseHealthCheck(100); // should no-op when already running
    await vi.advanceTimersByTimeAsync(120);

    expect(queryRawMock).toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalled();
    expect(connectMock).toHaveBeenCalled();

    mod.stopDatabaseHealthCheck();
    const callsBefore = queryRawMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(queryRawMock.mock.calls.length).toBe(callsBefore);
    processOnSpy.mockRestore();
  });

  it('logs reconnection failure and health restoration after consecutive failures', async () => {
    const { mod, queryRawMock, connectMock, disconnectMock, logger, processOnSpy } = await loadPrismaModule();
    queryRawMock
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(1);
    disconnectMock.mockResolvedValue(undefined);
    connectMock.mockRejectedValue(new Error('reconnect failed'));

    mod.startDatabaseHealthCheck(100);
    await vi.advanceTimersByTimeAsync(16_000);

    expect(logger.error).toHaveBeenCalledWith('Database reconnection failed', {
      error: 'reconnect failed',
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Database health restored after 1 consecutive failures'
    );

    mod.stopDatabaseHealthCheck();
    processOnSpy.mockRestore();
  });

  it('does not start a second reconnect while one reconnect attempt is in progress', async () => {
    const { mod, queryRawMock, connectMock, disconnectMock, processOnSpy } = await loadPrismaModule();
    queryRawMock.mockRejectedValue(new Error('db still down'));
    disconnectMock.mockResolvedValue(undefined);

    let resolveConnect: (() => void) | undefined;
    connectMock.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveConnect = resolve;
      })
    );

    mod.startDatabaseHealthCheck(10);
    await vi.advanceTimersByTimeAsync(20);
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    mod.stopDatabaseHealthCheck();
    mod.startDatabaseHealthCheck(10);
    await vi.advanceTimersByTimeAsync(20);
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    resolveConnect?.();
    await vi.advanceTimersByTimeAsync(50);
    mod.stopDatabaseHealthCheck();
    processOnSpy.mockRestore();
  });

  it('stopDatabaseHealthCheck is a no-op when monitoring was never started', async () => {
    const { mod, processOnSpy } = await loadPrismaModule();

    expect(() => mod.stopDatabaseHealthCheck()).not.toThrow();

    processOnSpy.mockRestore();
  });

  it('beforeExit handler stops health checks and disconnects prisma', async () => {
    const { mod, onHandlers, disconnectMock, processOnSpy } = await loadPrismaModule();
    disconnectMock.mockResolvedValue(undefined);

    mod.startDatabaseHealthCheck(100);
    await (onHandlers.beforeExit as () => Promise<void>)?.();

    expect(disconnectMock).toHaveBeenCalled();
    processOnSpy.mockRestore();
  });
});
