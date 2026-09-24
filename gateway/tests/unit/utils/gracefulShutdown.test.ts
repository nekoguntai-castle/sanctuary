import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGatewayShutdownHandler,
  type GatewayShutdownDependencies,
} from '../../../src/utils/gracefulShutdown';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createHarness(overrides: Partial<GatewayShutdownDependencies> = {}) {
  const events: string[] = [];
  const dependencies: GatewayShutdownDependencies = {
    log: {
      info: vi.fn((message: string) => events.push(`info:${message}`)),
      warn: vi.fn((message: string) => events.push(`warn:${message}`)),
      error: vi.fn((message: string) => events.push(`error:${message}`)),
    },
    closeHttpServer: vi.fn(async () => { events.push('http-drained'); }),
    stopBackendEvents: vi.fn(async () => { events.push('events-drained'); }),
    shutdownPushServices: vi.fn(() => { events.push('push-stopped'); }),
    clearBackoffCleanup: vi.fn(() => { events.push('backoff-stopped'); }),
    exitNow: vi.fn((code: 0 | 1) => { events.push(`exit:${code}`); }),
    timeoutMs: 100,
    ...overrides,
  };
  return { dependencies, events };
}

afterEach(() => vi.useRealTimers());

describe('gateway graceful shutdown', () => {
  it('closes event admission immediately and exits after HTTP and event drains', async () => {
    const httpDrain = deferred();
    const eventDrain = deferred();
    const { dependencies, events } = createHarness({
      closeHttpServer: vi.fn(() => {
        events.push('http-started');
        return httpDrain.promise.then(() => { events.push('http-drained'); });
      }),
      stopBackendEvents: vi.fn(() => {
        events.push('events-started');
        return eventDrain.promise.then(() => { events.push('events-drained'); });
      }),
    });
    const shutdown = createGatewayShutdownHandler(dependencies);

    const pending = shutdown('SIGTERM');
    expect(events.slice(1, 3)).toEqual(['events-started', 'http-started']);
    httpDrain.resolve();
    await Promise.resolve();
    expect(events).not.toContain('push-stopped');
    eventDrain.resolve();
    await pending;

    expect(events.indexOf('push-stopped')).toBeGreaterThan(events.indexOf('http-drained'));
    expect(events.indexOf('push-stopped')).toBeGreaterThan(events.indexOf('events-drained'));
    expect(events.at(-1)).toBe('exit:0');
  });

  it('keeps the force timer armed while an event drain is hung', async () => {
    vi.useFakeTimers();
    const eventDrain = deferred();
    const { dependencies } = createHarness({
      stopBackendEvents: vi.fn(() => eventDrain.promise),
    });
    const pending = createGatewayShutdownHandler(dependencies)('SIGTERM');

    await vi.advanceTimersByTimeAsync(100);
    expect(dependencies.exitNow).toHaveBeenCalledWith(1);
    expect(dependencies.shutdownPushServices).not.toHaveBeenCalled();

    eventDrain.resolve();
    await pending;
  });

  it('promotes the exit code when a fatal signal arrives during the drain', async () => {
    const eventDrain = deferred();
    const { dependencies } = createHarness({
      stopBackendEvents: vi.fn(() => eventDrain.promise),
    });
    const shutdown = createGatewayShutdownHandler(dependencies);

    const pending = shutdown('SIGTERM');
    await shutdown('uncaughtException', 1);
    eventDrain.resolve();
    await pending;

    expect(dependencies.exitNow).toHaveBeenLastCalledWith(1);
  });

  it('contains drain and cleanup failures and exits unsuccessfully', async () => {
    const { dependencies } = createHarness({
      timeoutMs: undefined,
      stopBackendEvents: vi.fn(() => { throw new Error('event drain failed'); }),
      closeHttpServer: vi.fn(() => Promise.reject('http drain failed')),
      shutdownPushServices: vi.fn(() => { throw new Error('push cleanup failed'); }),
      clearBackoffCleanup: vi.fn(() => { throw new Error('backoff cleanup failed'); }),
    });

    await createGatewayShutdownHandler(dependencies)('SIGTERM');

    expect(dependencies.log.error).toHaveBeenCalledWith('Error draining backend events', {
      error: 'event drain failed',
    });
    expect(dependencies.log.error).toHaveBeenCalledWith('Error closing HTTP server', {
      error: 'http drain failed',
    });
    expect(dependencies.log.error).toHaveBeenCalledWith('Error cleaning up gateway services', {
      error: 'push cleanup failed',
    });
    expect(dependencies.log.error).toHaveBeenCalledWith('Error cleaning up gateway services', {
      error: 'backoff cleanup failed',
    });
    expect(dependencies.exitNow).toHaveBeenCalledWith(1);
  });
});
