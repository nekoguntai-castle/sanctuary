import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGracefulShutdownHandler,
  registerGracefulShutdownHandlers,
  type GracefulShutdownDependencies,
  type ShutdownHandler,
} from '../../../src/utils/gracefulShutdown';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(overrides: Partial<GracefulShutdownDependencies> = {}) {
  const events: string[] = [];
  const log = {
    info: vi.fn((message: string) => events.push(`info:${message}`)),
    warn: vi.fn((message: string) => events.push(`warn:${message}`)),
    error: vi.fn((message: string) => events.push(`error:${message}`)),
  };
  const step = (name: string) => vi.fn(async () => { events.push(name); });
  const dependencies: GracefulShutdownDependencies = {
    log,
    httpServerDrain: {
      begin: vi.fn(async () => {
        events.push('http-drained');
        return [];
      }),
    },
    stopActiveStatsTimer: vi.fn(() => events.push('stats-stopped')),
    stopDatabaseHealthCheck: step('db-health-stopped'),
    stopRegisteredServices: step('services-stopped'),
    stopSynchronousServices: vi.fn(() => events.push('sync-services-stopped')),
    shutdownElectrumPool: step('electrum-stopped'),
    shutdownJobQueue: step('jobs-stopped'),
    shutdownRedisDependencies: step('redis-dependencies-stopped'),
    shutdownRedis: step('redis-stopped'),
    disconnect: step('database-disconnected'),
    exitNow: vi.fn((code: 0 | 1) => events.push(`exit:${code}`)),
    timeoutMs: 100,
    ...overrides,
  };
  return { dependencies, events, log };
}

afterEach(() => vi.useRealTimers());

describe('graceful shutdown orchestration', () => {
  it('runs the registered signal handler only after HTTP drain, then exits after dependencies', async () => {
    const drain = deferred<readonly Error[]>();
    const { dependencies, events } = createHarness();
    dependencies.httpServerDrain = {
      begin: vi.fn(() => {
        events.push('http-close-started');
        return drain.promise;
      }),
    };
    const handler = createGracefulShutdownHandler(dependencies);
    const handlers: Record<string, () => void> = {};
    let fatalHandler: ShutdownHandler | undefined;
    registerGracefulShutdownHandlers(
      handler,
      registered => { fatalHandler = registered; },
      { on: vi.fn((signal: string, callback: () => void) => {
        handlers[signal] = callback;
        return undefined as never;
      }) } as never,
    );

    handlers.SIGTERM?.();
    expect(events).toContain('http-close-started');
    expect(events).not.toContain('services-stopped');
    drain.resolve([]);
    await vi.waitFor(() => expect(events).toContain('exit:0'));

    expect(fatalHandler).toBe(handler);
    expect(events.indexOf('http-close-started')).toBeLessThan(events.indexOf('services-stopped'));
    expect(events.indexOf('services-stopped')).toBeLessThan(events.indexOf('redis-stopped'));
    expect(events.indexOf('redis-stopped')).toBeLessThan(events.indexOf('database-disconnected'));
    expect(events.at(-1)).toBe('exit:0');
  });

  it('promotes callback errors and a repeated fatal signal while cleanup continues once', async () => {
    const drain = deferred<readonly Error[]>();
    const closeError = Object.assign(new Error('close failed'), { code: 'EIO' });
    const { dependencies, events, log } = createHarness({
      httpServerDrain: { begin: vi.fn(() => drain.promise) },
    });
    const handler = createGracefulShutdownHandler(dependencies);
    const first = handler('SIGTERM');
    await handler('uncaughtException', 1);
    drain.resolve([closeError]);
    await first;

    expect(dependencies.stopRegisteredServices).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith('uncaughtException received again, already shutting down...');
    expect(log.error).toHaveBeenCalledWith('Error closing API listener', { error: 'close failed' });
    expect(events.at(-1)).toBe('exit:1');
  });

  it('completes pre-listen cleanup and cancels the force timeout', async () => {
    vi.useFakeTimers();
    const { dependencies } = createHarness();
    delete dependencies.timeoutMs;
    const handler = createGracefulShutdownHandler(dependencies);

    await handler('SIGINT');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(dependencies.exitNow).toHaveBeenCalledTimes(1);
    expect(dependencies.exitNow).toHaveBeenCalledWith(0);
  });

  it('forces exit when drain exceeds the timeout', async () => {
    vi.useFakeTimers();
    const drain = deferred<readonly Error[]>();
    const { dependencies, log } = createHarness({
      httpServerDrain: { begin: vi.fn(() => drain.promise) },
    });
    const pending = createGracefulShutdownHandler(dependencies)('SIGTERM');

    await vi.advanceTimersByTimeAsync(100);
    expect(log.error).toHaveBeenCalledWith('Graceful shutdown timed out, forcing exit');
    expect(dependencies.exitNow).toHaveBeenCalledWith(1);

    drain.resolve([]);
    await pending;
  });

  it('contains Electrum and database cleanup failures', async () => {
    const electrumError = new Error('electrum failed');
    const databaseError = new Error('database failed');
    const { dependencies, log } = createHarness({
      shutdownElectrumPool: vi.fn().mockRejectedValue(electrumError),
      disconnect: vi.fn().mockRejectedValue(databaseError),
    });

    await createGracefulShutdownHandler(dependencies)('SIGTERM');

    expect(log.error).toHaveBeenCalledWith('Error closing Electrum pool', {
      error: 'electrum failed',
    });
    expect(log.error).toHaveBeenCalledWith('Error disconnecting from database', {
      error: 'database failed',
    });
    expect(dependencies.exitNow).toHaveBeenCalledWith(0);
  });

  it('registers SIGINT independently of SIGTERM', async () => {
    const { dependencies } = createHarness();
    const handler = createGracefulShutdownHandler(dependencies);
    const handlers: Record<string, () => void> = {};
    registerGracefulShutdownHandlers(
      handler,
      vi.fn(),
      { on: vi.fn((signal: string, callback: () => void) => {
        handlers[signal] = callback;
        return undefined as never;
      }) } as never,
    );

    handlers.SIGINT?.();
    await vi.waitFor(() => expect(dependencies.exitNow).toHaveBeenCalledWith(0));
  });
});
