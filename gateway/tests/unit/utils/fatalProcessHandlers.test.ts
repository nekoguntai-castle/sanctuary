import { describe, expect, it, vi } from 'vitest';

import { registerFatalProcessHandlers } from '../../../src/utils/fatalProcessHandlers';

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

  return { handlers, log, shutdown, exitNow };
}

describe('gateway fatalProcessHandlers', () => {
  it('logs and starts one fatal shutdown for unhandled rejections', async () => {
    const { handlers, log, shutdown } = createHarness();

    handlers.unhandledRejection(new Error('gateway promise boom'));
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal process event - shutting down',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'gateway promise boom',
        stack: expect.any(String),
      })
    );
    expect(shutdown).toHaveBeenCalledWith('unhandledRejection', 1);

    handlers.unhandledRejection('plain boom');

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Fatal process event ignored; shutdown already in progress',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'plain boom',
      })
    );
  });

  it('exits non-zero when fatal shutdown rejects', async () => {
    const { handlers, log, shutdown, exitNow } = createHarness();
    shutdown.mockRejectedValueOnce(new Error('gateway shutdown failed'));

    handlers.uncaughtException(new Error('gateway uncaught'));
    await Promise.resolve();
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal shutdown failed',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'gateway shutdown failed',
      })
    );
    expect(exitNow).toHaveBeenCalledWith(1);
  });

  it('exits non-zero when fatal shutdown throws synchronously', () => {
    const { handlers, log, shutdown, exitNow } = createHarness();
    shutdown.mockImplementationOnce(() => {
      throw new Error('gateway shutdown threw');
    });

    handlers.uncaughtException(new Error('gateway uncaught'));

    expect(log.error).toHaveBeenCalledWith(
      'Fatal shutdown failed',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'gateway shutdown threw',
      })
    );
    expect(exitNow).toHaveBeenCalledWith(1);
  });
});
