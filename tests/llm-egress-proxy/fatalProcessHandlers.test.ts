import { describe, expect, it, vi } from 'vitest';

import { registerFatalProcessHandlers } from '../../llm-egress-proxy/src/fatalProcessHandlers';

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

describe('llm-egress-proxy fatalProcessHandlers', () => {
  it('logs and starts one fatal shutdown for unhandled rejections', async () => {
    const { handlers, log, shutdown } = createHarness();

    handlers.unhandledRejection(new Error('AI promise boom'));
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal process event - shutting down',
      expect.objectContaining({
        event: 'unhandledRejection',
        reason: 'AI promise boom',
        stack: expect.any(String),
      })
    );
    expect(shutdown).toHaveBeenCalledWith('unhandledRejection', 1);

    handlers.uncaughtException(new Error('second AI boom'));

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Fatal process event ignored; shutdown already in progress',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'second AI boom',
      })
    );
  });

  it('exits non-zero when fatal shutdown rejects', async () => {
    const { handlers, log, shutdown, exitNow } = createHarness();
    shutdown.mockRejectedValueOnce(new Error('AI shutdown failed'));

    handlers.uncaughtException(new Error('AI uncaught'));
    await Promise.resolve();
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledWith(
      'Fatal shutdown failed',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'AI shutdown failed',
      })
    );
    expect(exitNow).toHaveBeenCalledWith(1);
  });

  it('exits non-zero when fatal shutdown throws synchronously', () => {
    const { handlers, log, shutdown, exitNow } = createHarness();
    shutdown.mockImplementationOnce(() => {
      throw new Error('AI shutdown threw');
    });

    handlers.uncaughtException(new Error('AI uncaught'));

    expect(log.error).toHaveBeenCalledWith(
      'Fatal shutdown failed',
      expect.objectContaining({
        event: 'uncaughtException',
        reason: 'AI shutdown threw',
      })
    );
    expect(exitNow).toHaveBeenCalledWith(1);
  });
});
