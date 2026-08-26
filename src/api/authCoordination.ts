/**
 * Coordinates cookie-authenticated mutations with access-token refresh.
 *
 * Unsafe network attempts hold a shared lock only from CSRF-header creation
 * through receipt of the response. Refresh attempts hold the same named lock
 * exclusively. Decisions and replays happen after releasing the prior lock so
 * a request never tries to upgrade a lock that it already owns.
 */

export const AUTH_COORDINATION_LOCK_NAME = 'sanctuary-auth-refresh';

type AuthLockMode = 'shared' | 'exclusive';

const runWithAuthLock = <T>(
  mode: AuthLockMode,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (navigator.locks?.request) {
    const options: LockOptions = signal ? { mode, signal } : { mode };
    return navigator.locks.request(
      AUTH_COORDINATION_LOCK_NAME,
      options,
      operation,
    );
  }
  // Preserve the existing compatibility behavior when Web Locks are absent.
  // Same-tab refresh remains single-flight in refresh.ts, but cross-tab
  // coordination cannot be claimed without a browser-provided shared lock.
  return operation();
};

export const runSharedAuthAttempt = <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => runWithAuthLock('shared', operation, signal);

export const runExclusiveAuthRefresh = <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => runWithAuthLock('exclusive', operation, signal);
