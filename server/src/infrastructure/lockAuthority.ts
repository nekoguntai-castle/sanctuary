export type LockAuthorityMode = 'redis-required' | 'local';

export class LockAuthorityUnavailableError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Distributed lock authority unavailable during ${operation}`);
    this.name = 'LockAuthorityUnavailableError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}

let authorityMode: LockAuthorityMode | null = null;

/**
 * Select the lock authority for this process lifecycle.
 *
 * Local mode is only safe for tests and deliberately single-process runtimes.
 * Production entrypoints must initialize Redis first, then select
 * `redis-required`.
 */
export function initializeDistributedLock(mode: LockAuthorityMode): void {
  if (authorityMode && authorityMode !== mode) {
    throw new Error(
      `Distributed lock authority already initialized as ${authorityMode}`,
    );
  }
  authorityMode = mode;
}

export function requireLockAuthorityMode(): LockAuthorityMode {
  if (!authorityMode) {
    throw new LockAuthorityUnavailableError('initialization');
  }
  return authorityMode;
}

export function resetLockAuthority(): void {
  authorityMode = null;
}
