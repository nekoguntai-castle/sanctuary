import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runExclusiveAuthRefresh,
  runSharedAuthAttempt,
} from '../../src/api/authCoordination';

const flushTasks = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth Web Lock ordering', () => {
  it('allows shared overlap while preserving FIFO writer progress', async () => {
    const firstRelease = deferred();
    const secondRelease = deferred();
    const exclusiveRelease = deferred();
    const events: string[] = [];

    const first = navigator.locks.request(
      'auth-coordination-regression',
      { mode: 'shared' },
      async (lock) => {
        events.push(`first:${lock?.mode}`);
        await firstRelease.promise;
      },
    );
    const second = navigator.locks.request(
      'auth-coordination-regression',
      { mode: 'shared' },
      async (lock) => {
        events.push(`second:${lock?.mode}`);
        await secondRelease.promise;
      },
    );
    await flushTasks();

    const exclusive = navigator.locks.request(
      'auth-coordination-regression',
      { mode: 'exclusive' },
      async (lock) => {
        events.push(`exclusive:${lock?.mode}`);
        await exclusiveRelease.promise;
      },
    );
    const lateShared = navigator.locks.request(
      'auth-coordination-regression',
      { mode: 'shared' },
      async (lock) => {
        events.push(`late:${lock?.mode}`);
      },
    );

    expect(events).toEqual(['first:shared', 'second:shared']);
    firstRelease.resolve();
    await flushTasks();
    expect(events).toEqual(['first:shared', 'second:shared']);
    secondRelease.resolve();
    await flushTasks();
    expect(events).toEqual(['first:shared', 'second:shared', 'exclusive:exclusive']);
    exclusiveRelease.resolve();
    await Promise.all([first, second, exclusive, lateShared]);
    expect(events).toEqual([
      'first:shared',
      'second:shared',
      'exclusive:exclusive',
      'late:shared',
    ]);
  });

  it('removes an aborted queued reader without invoking its callback', async () => {
    const exclusiveRelease = deferred();
    const controller = new AbortController();
    const queuedCallback = vi.fn(async () => undefined);
    const exclusive = runExclusiveAuthRefresh(async () => {
      await exclusiveRelease.promise;
    });
    const queued = runSharedAuthAttempt(queuedCallback, controller.signal);
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(queuedCallback).not.toHaveBeenCalled();
    exclusiveRelease.resolve();
    await exclusive;
  });

  it('passes the requested modes and caller signal to the browser lock', async () => {
    const requestSpy = vi.spyOn(navigator.locks, 'request');
    const controller = new AbortController();

    await runSharedAuthAttempt(async () => undefined, controller.signal);
    await runExclusiveAuthRefresh(async () => undefined);

    expect(requestSpy.mock.calls[0][1]).toEqual({
      mode: 'shared',
      signal: controller.signal,
    });
    expect(requestSpy.mock.calls[1][1]).toEqual({ mode: 'exclusive' });
  });

  it('releases a rejected shared holder so a queued exclusive writer runs', async () => {
    const rejectShared = deferred();
    const events: string[] = [];
    const shared = runSharedAuthAttempt(async () => {
      events.push('shared');
      await rejectShared.promise;
      throw new Error('shared failed');
    });
    const exclusive = runExclusiveAuthRefresh(async () => {
      events.push('exclusive');
    });

    expect(events).toEqual(['shared']);
    rejectShared.resolve();
    await expect(shared).rejects.toThrow('shared failed');
    await exclusive;
    expect(events).toEqual(['shared', 'exclusive']);
  });

  it('releases a rejected exclusive holder so queued shared work runs', async () => {
    const rejectExclusive = deferred();
    const events: string[] = [];
    const exclusive = runExclusiveAuthRefresh(async () => {
      events.push('exclusive');
      await rejectExclusive.promise;
      throw new Error('exclusive failed');
    });
    const shared = runSharedAuthAttempt(async () => {
      events.push('shared');
    });

    expect(events).toEqual(['exclusive']);
    rejectExclusive.resolve();
    await expect(exclusive).rejects.toThrow('exclusive failed');
    await shared;
    expect(events).toEqual(['exclusive', 'shared']);
  });

  it('does not strand a later waiter when an earlier queued request aborts', async () => {
    const releaseExclusive = deferred();
    const controller = new AbortController();
    const events: string[] = [];
    const exclusive = runExclusiveAuthRefresh(async () => {
      events.push('exclusive');
      await releaseExclusive.promise;
    });
    const aborted = runSharedAuthAttempt(async () => {
      events.push('aborted');
    }, controller.signal);
    const follower = runSharedAuthAttempt(async () => {
      events.push('follower');
    });

    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    releaseExclusive.resolve();
    await Promise.all([exclusive, follower]);
    expect(events).toEqual(['exclusive', 'follower']);
  });
});

describe('auth coordination fallback', () => {
  it('preserves the direct-execution compatibility fallback without Web Locks', async () => {
    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
    const sharedRelease = deferred();
    const exclusiveRelease = deferred();
    const events: string[] = [];

    try {
      const shared = runSharedAuthAttempt(async () => {
        events.push('shared');
        await sharedRelease.promise;
      });
      const exclusive = runExclusiveAuthRefresh(async () => {
        events.push('exclusive');
        await exclusiveRelease.promise;
      });
      const lateShared = runSharedAuthAttempt(async () => {
        events.push('late-shared');
      });

      await flushTasks();
      expect(events).toEqual(['shared', 'exclusive', 'late-shared']);
      sharedRelease.resolve();
      exclusiveRelease.resolve();
      await Promise.all([shared, exclusive, lateShared]);
      expect(events).toEqual(['shared', 'exclusive', 'late-shared']);
    } finally {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: originalLocks,
      });
    }
  });

  it('releases a rejected fallback holder so the next waiter runs', async () => {
    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });

    try {
      await expect(runSharedAuthAttempt(async () => {
        throw new Error('attempt failed');
      })).rejects.toThrow('attempt failed');
      await expect(runExclusiveAuthRefresh(async () => 'continued')).resolves.toBe('continued');
    } finally {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: originalLocks,
      });
    }
  });
});
