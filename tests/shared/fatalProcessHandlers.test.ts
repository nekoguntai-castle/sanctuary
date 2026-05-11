import { describe, expect, it, vi } from 'vitest';

import { registerFatalProcessHandlers } from '@sanctuary/shared/utils/fatalProcessHandlers';

function createHarness() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const processLike = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
      return processLike as any;
    }),
  };
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
  };
  const shutdown = vi.fn();
  const exitNow = vi.fn((() => undefined) as never);

  registerFatalProcessHandlers({ log, shutdown, exitNow, processLike });

  return { handlers, log, shutdown, exitNow, processLike };
}

describe('fatalProcessHandlers', () => {
  it('registers uncaughtException and unhandledRejection listeners', () => {
    const { processLike } = createHarness();
    expect(processLike.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(processLike.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
  });

  it('logs and starts one fatal shutdown for an unhandled Error rejection', async () => {
    const { handlers, log, shutdown } = createHarness();

    handlers.unhandledRejection(new Error('promise boom'));
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal process event - shutting down',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'promise boom',
        stack: expect.any(String),
      })
    );
    expect(shutdown).toHaveBeenCalledWith('unhandledRejection', 1);
  });

  it('ignores a second fatal event of a different type after shutdown has started', async () => {
    const { handlers, log, shutdown } = createHarness();

    handlers.unhandledRejection(new Error('promise boom'));
    await Promise.resolve();
    handlers.uncaughtException(new Error('second boom'));

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Fatal process event ignored; shutdown already in progress',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'second boom',
      })
    );
  });

  it('logs non-Error string reasons without a stack', async () => {
    const { handlers, log, shutdown } = createHarness();

    handlers.unhandledRejection('string reason');
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal process event - shutting down',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'string reason',
        stack: undefined,
      })
    );
    expect(shutdown).toHaveBeenCalledWith('unhandledRejection', 1);
  });

  it('extracts message from non-Error plain objects with a message property', async () => {
    // Regression guard for the gateway behavior upgrade: prior gateway-local
    // implementation returned "[object Object]" for plain-object reasons.
    // The shared extractor must surface the inner .message instead.
    const { handlers, log } = createHarness();

    handlers.unhandledRejection({ message: 'object reason', code: 42 });
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal process event - shutting down',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'object reason',
        stack: undefined,
      })
    );
  });

  it('falls back to a stable string for plain objects without message or error', async () => {
    const { handlers, log } = createHarness();

    handlers.unhandledRejection({ unrelated: 'shape' });
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal process event - shutting down',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'An unexpected error occurred',
        stack: undefined,
      })
    );
  });

  it('exits non-zero when fatal shutdown rejects asynchronously', async () => {
    const { handlers, log, shutdown, exitNow } = createHarness();
    shutdown.mockRejectedValueOnce(new Error('shutdown failed'));

    handlers.uncaughtException(new Error('uncaught boom'));
    await Promise.resolve();
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal shutdown failed',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'shutdown failed',
      })
    );
    expect(exitNow).toHaveBeenCalledWith(1);
  });

  it('exits non-zero when fatal shutdown throws synchronously', () => {
    const { handlers, log, shutdown, exitNow } = createHarness();
    shutdown.mockImplementationOnce(() => {
      throw new Error('shutdown threw');
    });

    handlers.uncaughtException(new Error('uncaught boom'));

    expect(log.error).toHaveBeenCalledWith(
      'Fatal shutdown failed',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'shutdown threw',
      })
    );
    expect(exitNow).toHaveBeenCalledWith(1);
  });
});
