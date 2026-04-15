import { afterEach, describe, expect, it, vi } from 'vitest';

import { exitAfterDelay, exitNow } from '../../ai-proxy/src/processExit';

describe('ai-proxy processExit utility', () => {
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
});
