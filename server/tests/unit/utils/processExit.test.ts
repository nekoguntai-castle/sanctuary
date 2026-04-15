import { afterEach, describe, expect, it, vi } from 'vitest';

import { exitAfterDelay, exitNow } from '../../../src/utils/processExit';

describe('processExit utility', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delegates immediate exits to process.exit', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    exitNow(1);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('schedules delayed exits', () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    exitAfterDelay(1, 250);

    expect(exitSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('tolerates timer handles without unref', () => {
    let callback: (() => void) | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler) => {
        callback = typeof cb === 'function' ? cb as () => void : undefined;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    expect(exitAfterDelay(1, 250)).toBe(0);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 250);

    callback?.();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
