/**
 * Refresh module tests (ADR 0002 Phase 4)
 *
 * Covers the single-flight behavior within a tab, the cross-tab Web Lock
 * serialization, the freshness check inside the lock, the proactive
 * scheduled refresh, the reactive interceptor surface, terminal failure
 * handling, and BroadcastChannel state propagation.
 *
 * The `navigator.locks` and `BroadcastChannel` mocks in tests/setup.ts
 * provide the mutex and pub/sub machinery these tests exercise. See the
 * "Why the lock alone is sufficient for correctness" section of ADR 0002
 * for the contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  refreshAccessToken,
  scheduleRefreshFromHeader,
  onTerminalLogout,
  triggerLogout,
  getAccessExpiresAtMs,
  __resetRefreshModuleForTests,
  __seedAccessExpiresAtMsForTests,
  __REFRESH_LEAD_TIME_MS_FOR_TESTS,
  RefreshFailedError,
  RefreshTransientError,
} from '../../src/api/refresh';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockFetch = vi.fn();

function authResponse(expiresAtIso: string) {
  const headersMap = new Map<string, string>([
    ['X-Access-Expires-At', expiresAtIso],
  ]);
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headersMap.get(name) ?? null },
    json: async () => ({}),
  };
}

/**
 * An OK fetch response with NO X-Access-Expires-At header. Used by
 * tests that need performRefreshRequest to succeed without scheduling
 * a follow-up refresh timer (which would complicate fake-timer-based
 * assertions).
 */
function okResponseNoExpiry() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({}),
  };
}

function isoInFuture(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

beforeEach(() => {
  __resetRefreshModuleForTests();
  global.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  __resetRefreshModuleForTests();
});

describe('refresh module — within-tab single-flight', () => {
  it('returns the same promise to concurrent callers and only fetches once', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    mockFetch.mockImplementationOnce(
      () => new Promise((r) => { resolveFetch = r; }),
    );

    const a = refreshAccessToken();
    const b = refreshAccessToken();

    // Same in-flight Promise returned to both callers.
    expect(a).toBe(b);

    // Only one fetch fired so far.
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Complete the refresh.
    resolveFetch!(authResponse(isoInFuture(60 * 60 * 1000)));
    await a;

    // Even after settling, the refresh was only called once — the
    // single-flight promise ensured both callers shared it.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('acquires the Web Lock exactly once for concurrent in-tab callers', async () => {
    // Spy on navigator.locks.request to count acquisitions.
    const locksRequestSpy = vi.spyOn(navigator.locks, 'request');
    mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(60 * 60 * 1000)));

    const a = refreshAccessToken();
    const b = refreshAccessToken();
    await Promise.all([a, b]);

    // Only ONE call to navigator.locks.request — the second caller
    // never touched the lock because it was coalesced into the
    // single-flight promise.
    expect(locksRequestSpy).toHaveBeenCalledTimes(1);
  });
});

describe('refresh module — proactive schedule', () => {
  it('schedules a refresh to fire REFRESH_LEAD_TIME_MS before expiry', async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const expiresAtIso = new Date(now + 3600_000).toISOString();
      scheduleRefreshFromHeader(expiresAtIso);

      // Mock the refresh response to NOT include X-Access-Expires-At so
      // the response handler does not schedule a follow-up timer that
      // could inflate the call count.
      mockFetch.mockResolvedValue(okResponseNoExpiry());

      // Advance to just before the lead-time boundary. No refresh yet.
      await vi.advanceTimersByTimeAsync(3600_000 - __REFRESH_LEAD_TIME_MS_FOR_TESTS - 1);
      expect(mockFetch).not.toHaveBeenCalled();

      // Cross the boundary. The proactive timer fires exactly once.
      await vi.advanceTimersByTimeAsync(2);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the previous timer when a new X-Access-Expires-At arrives', async () => {
    vi.useFakeTimers();
    try {
      // Mock fetch defensively so an unexpected timer fire does not
      // throw — assertion is about call count.
      mockFetch.mockResolvedValue(okResponseNoExpiry());

      // First schedule: 1 hour from the fake-clock anchor.
      const now = Date.now();
      const first = new Date(now + 3600_000).toISOString();
      scheduleRefreshFromHeader(first);

      // Replace the schedule with a FAR future expiry (24h). The first
      // timer must be cleared so that advancing past the 1h boundary
      // does not fire it.
      const second = new Date(now + 24 * 3600_000).toISOString();
      scheduleRefreshFromHeader(second);

      // Advance past the FIRST lead-time boundary. Use
      // advanceTimersByTimeAsync (NOT runOnlyPendingTimersAsync, which
      // would force-fire ALL queued timers regardless of deadline). The
      // second timer fires at ~24h-60s — well beyond this advance.
      await vi.advanceTimersByTimeAsync(3600_000 - __REFRESH_LEAD_TIME_MS_FOR_TESTS + 1);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an invalid X-Access-Expires-At header value', () => {
    scheduleRefreshFromHeader('not-a-date');
    expect(getAccessExpiresAtMs()).toBeNull();
  });

  it('schedules an immediate refresh when the expiry is already past the lead-time boundary', async () => {
    // Server says the access token expires in 10s, which is below our
    // 60s lead time. The module should schedule a setTimeout(..., 0)
    // so the refresh runs on the next tick.
    const expiresSoon = isoInFuture(10_000);
    mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(3600_000)));

    scheduleRefreshFromHeader(expiresSoon);

    // Give the microtask queue a chance to run the scheduled timeout.
    await new Promise((r) => setTimeout(r, 5));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('refresh module — freshness check short-circuit', () => {
  it('short-circuits when accessExpiresAtMs is already beyond the lead-time boundary', async () => {
    // Seed in-memory state to "fresh" state before calling refresh.
    scheduleRefreshFromHeader(isoInFuture(10 * 60 * 60 * 1000)); // 10h
    // Clear the mocked fetch so an unexpected call would fail the test.
    mockFetch.mockImplementation(() => {
      throw new Error('refresh should NOT have fetched');
    });

    // This fakes the "contended lock + broadcast already updated state"
    // optimistic case: we already have a fresh in-memory expiry.
    await refreshAccessToken();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('refresh module — terminal failure', () => {
  it('throws RefreshFailedError on 401 and fires terminal-logout listeners', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ message: 'Unauthorized' }),
    });

    const logoutListener = vi.fn();
    onTerminalLogout(logoutListener);

    await expect(refreshAccessToken()).rejects.toBeInstanceOf(RefreshFailedError);
    expect(logoutListener).toHaveBeenCalledTimes(1);
    expect(getAccessExpiresAtMs()).toBeNull();
  });

  it('throws RefreshTransientError on 500 WITHOUT firing terminal-logout listeners', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({ message: 'internal error' }),
    });

    const logoutListener = vi.fn();
    onTerminalLogout(logoutListener);
    // Seed an in-memory expiry that is "stale" relative to the lead
    // time so the freshness check INSIDE the lock does not short-circuit
    // the fetch. Use the test-only seeder (rather than
    // scheduleRefreshFromHeader) to avoid scheduling a real-timer
    // refresh that would race the manual call below.
    const seededExpiry = Date.now() + 30_000; // 30s — well under the 60s lead time
    __seedAccessExpiresAtMsForTests(seededExpiry);

    await expect(refreshAccessToken()).rejects.toBeInstanceOf(RefreshTransientError);
    expect(logoutListener).not.toHaveBeenCalled();
    // The in-memory expiry should still be the seeded value — a
    // transient server error must not evict credentials.
    expect(getAccessExpiresAtMs()).toBe(seededExpiry);
  });

  it('calling triggerLogout() fires terminal-logout listeners and clears state', () => {
    scheduleRefreshFromHeader(isoInFuture(3600_000));
    const listener = vi.fn();
    onTerminalLogout(listener);

    triggerLogout();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAccessExpiresAtMs()).toBeNull();
  });

  it('unsubscribe returned by onTerminalLogout prevents future fires', () => {
    const listener = vi.fn();
    const unsubscribe = onTerminalLogout(listener);
    unsubscribe();

    triggerLogout();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('refresh module — BroadcastChannel state propagation', () => {
  it('other-tab refresh-complete updates the local accessExpiresAtMs', async () => {
    // Open a second channel to simulate another tab. scheduleRefresh
    // ensures the module's own channel is opened and ready to receive.
    scheduleRefreshFromHeader(isoInFuture(3600_000));

    const otherTabChannel = new BroadcastChannel('sanctuary-auth');
    const newExpiry = isoInFuture(12 * 3600_000);

    otherTabChannel.postMessage({ type: 'refresh-complete', expiresAtIso: newExpiry });

    // Yield a microtask for the BroadcastChannel mock to deliver.
    await Promise.resolve();

    const expected = Date.parse(newExpiry);
    expect(getAccessExpiresAtMs()).toBe(expected);

    otherTabChannel.close();
  });

  it('other-tab logout-broadcast fires local terminal-logout listeners and clears state', async () => {
    scheduleRefreshFromHeader(isoInFuture(3600_000));
    const listener = vi.fn();
    onTerminalLogout(listener);

    const otherTabChannel = new BroadcastChannel('sanctuary-auth');
    otherTabChannel.postMessage({ type: 'logout-broadcast' });
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAccessExpiresAtMs()).toBeNull();

    otherTabChannel.close();
  });

  it('ignores malformed broadcast messages', async () => {
    scheduleRefreshFromHeader(isoInFuture(3600_000));
    const before = getAccessExpiresAtMs();

    const otherTabChannel = new BroadcastChannel('sanctuary-auth');
    otherTabChannel.postMessage(null);
    otherTabChannel.postMessage('string');
    otherTabChannel.postMessage({ type: 'refresh-complete', expiresAtIso: 'not-a-date' });
    otherTabChannel.postMessage({ type: 'unknown' });
    await Promise.resolve();

    expect(getAccessExpiresAtMs()).toBe(before);

    otherTabChannel.close();
  });
});

describe('refresh module — CSRF cookie + fetch headers', () => {
  it('reads sanctuary_csrf cookie and injects X-CSRF-Token header on the refresh POST', async () => {
    document.cookie = 'sanctuary_csrf=csrf-from-cookie; path=/';
    mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(60 * 60 * 1000)));

    await refreshAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.method).toBe('POST');
    expect(calledOptions.credentials).toBe('include');
    expect(calledOptions.headers['X-CSRF-Token']).toBe('csrf-from-cookie');

    // Cleanup the cookie so it does not leak to the next test.
    document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('omits X-CSRF-Token header when no sanctuary_csrf cookie is set', async () => {
    mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(60 * 60 * 1000)));

    await refreshAccessToken();

    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('parses a multi-entry Cookie header correctly', async () => {
    document.cookie = 'other=x; path=/';
    document.cookie = 'sanctuary_csrf=encoded%20value; path=/';
    mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(60 * 60 * 1000)));

    await refreshAccessToken();

    const calledOptions = mockFetch.mock.calls[0][1];
    // decodeURIComponent should turn '%20' back into a space.
    expect(calledOptions.headers['X-CSRF-Token']).toBe('encoded value');

    document.cookie = 'sanctuary_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'other=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('returns null when other cookies exist but sanctuary_csrf is not among them', async () => {
    // Exercises the "loop completed without finding sanctuary_csrf"
    // branch in readCsrfCookie (the explicit `return null` at the end
    // of the function, not the early-return for an empty document.cookie).
    document.cookie = 'unrelated=v1; path=/';
    document.cookie = 'another=v2; path=/';
    mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(60 * 60 * 1000)));

    await refreshAccessToken();

    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.headers['X-CSRF-Token']).toBeUndefined();

    document.cookie = 'unrelated=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'another=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });
});

describe('refresh module — getApiBaseUrl honors VITE_API_URL', () => {
  it('uses VITE_API_URL from import.meta.env when set', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/v1');
    try {
      mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(60 * 60 * 1000)));

      await refreshAccessToken();

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toBe('https://api.example.test/v1/auth/refresh');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('refresh module — defensive error handling', () => {
  it('catches and logs a thrown error from a terminal-logout listener so other listeners still run', () => {
    const throwingListener = vi.fn(() => {
      throw new Error('listener crashed');
    });
    const goodListener = vi.fn();

    onTerminalLogout(throwingListener);
    onTerminalLogout(goodListener);

    // triggerLogout should NOT propagate the error from the first
    // listener — it must call all registered listeners regardless.
    expect(() => triggerLogout()).not.toThrow();
    expect(throwingListener).toHaveBeenCalledTimes(1);
    expect(goodListener).toHaveBeenCalledTimes(1);
  });

  it('catches and swallows a BroadcastChannel postMessage error during logout broadcast', () => {
    // Force the channel into existence by calling scheduleRefreshFromHeader.
    scheduleRefreshFromHeader(isoInFuture(60 * 60 * 1000));

    // Replace the underlying BroadcastChannel postMessage with a thrower.
    // Since the module-scoped channel was created via `new BroadcastChannel`,
    // we patch its postMessage on the instance via the prototype-level mock.
    const allChannels = (globalThis as unknown as { BroadcastChannel: any })
      .BroadcastChannel.prototype;
    const originalPost = allChannels.postMessage;
    allChannels.postMessage = vi.fn(() => {
      throw new Error('post failed');
    });

    try {
      // triggerLogout calls postBroadcast → channel.postMessage → throws.
      // postBroadcast catches and logs at debug level. No exception leaks.
      expect(() => triggerLogout()).not.toThrow();
    } finally {
      allChannels.postMessage = originalPost;
    }
  });

  it('swallows BroadcastChannel.close errors during test-only module reset', () => {
    // Force the channel into existence by scheduling a refresh.
    scheduleRefreshFromHeader(isoInFuture(60 * 60 * 1000));

    const allChannels = (globalThis as unknown as { BroadcastChannel: any })
      .BroadcastChannel.prototype;
    const originalClose = allChannels.close;
    allChannels.close = vi.fn(() => {
      throw new Error('close failed');
    });

    try {
      // __resetRefreshModuleForTests() walks the close() branch; its catch
      // block logs at debug level and must not propagate the error.
      expect(() => __resetRefreshModuleForTests()).not.toThrow();
    } finally {
      allChannels.close = originalClose;
    }
  });
});

describe('refresh module — scheduled refresh failure swallowing', () => {
  it('immediate-fire scheduled refresh swallows a terminal failure without crashing', async () => {
    // Server has revoked the refresh token. The "fireInMs <= 0" path
    // schedules setTimeout(fn, 0) which calls refreshAccessToken; the
    // terminal failure rejects the promise. The .catch(() => {}) on the
    // scheduled timer must absorb it so the timer does not produce an
    // unhandled rejection.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ message: 'Unauthorized' }),
    });

    // Schedule with an expiry already past the lead-time boundary so
    // the immediate-fire path is taken.
    scheduleRefreshFromHeader(isoInFuture(10_000)); // 10s — under 60s LEAD_TIME

    // Let the setTimeout(0) microtask run.
    await new Promise((r) => setTimeout(r, 5));

    // Did not crash. Listeners should have fired (terminal failure).
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('normal-fire scheduled refresh swallows a terminal failure without crashing', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ message: 'Unauthorized' }),
      });

      // Schedule with a 1h expiry → fireInMs = 1h - 60s, normal path.
      const now = Date.now();
      scheduleRefreshFromHeader(new Date(now + 3600_000).toISOString());

      // Advance past the lead-time boundary so the normal-path timer fires.
      await vi.advanceTimersByTimeAsync(3600_000 - __REFRESH_LEAD_TIME_MS_FOR_TESTS + 1);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('refresh module — malformed X-Access-Expires-At header', () => {
  it('does not update accessExpiresAtMs when the header value is unparseable', async () => {
    // Server-side bug: returns the header but with a non-ISO value.
    // The module should ignore it (skip the schedule update) without
    // crashing or scheduling a bogus timer.
    const headersMap = new Map<string, string>([['X-Access-Expires-At', 'not-a-date']]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (name: string) => headersMap.get(name) ?? null },
      json: async () => ({}),
    });

    await refreshAccessToken();

    // accessExpiresAtMs should NOT have been updated since Date.parse
    // returned NaN.
    expect(getAccessExpiresAtMs()).toBeNull();
  });
});

describe('refresh module — Web Locks API fallback', () => {
  it('falls through to runUnderLock directly when navigator.locks is unavailable', async () => {
    // Simulate a very old environment with no Web Locks API. The
    // single-flight promise still serializes within the current tab,
    // and the freshness check still applies — only the cross-tab
    // mutex is missing.
    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(60 * 60 * 1000)));

      await refreshAccessToken();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'locks', {
        value: originalLocks,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe('refresh module — cross-tab Web Lock serialization', () => {
  it('queues a concurrent refresh call until the lock is released (single POST across the lifecycle)', async () => {
    // Simulate two tabs: each tab is an independent call to
    // refreshAccessToken() with its own fresh module state would require
    // two module instances. Within a single module (one tab), the
    // single-flight promise already guarantees one fetch per refresh
    // cycle — that's tested above. For cross-tab, what matters is that
    // a second simulated lock acquisition with a matching post-broadcast
    // short-circuits via the freshness check inside the lock.
    //
    // We simulate this by:
    //   1. First refresh: returns a fresh expiry (updates in-memory state).
    //   2. Second refresh: since the in-memory state is already fresh,
    //      the freshness check inside the lock should short-circuit
    //      without calling fetch.
    mockFetch.mockResolvedValueOnce(authResponse(isoInFuture(3600_000)));

    await refreshAccessToken();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockImplementation(() => {
      throw new Error('second refresh should NOT have fetched');
    });

    await refreshAccessToken();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
