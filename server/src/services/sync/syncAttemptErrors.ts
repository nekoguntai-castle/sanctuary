export class SyncAttemptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Sync attempt timed out after ${timeoutMs}ms`);
    this.name = 'SyncAttemptTimeoutError';
  }
}

export function isSyncAttemptTimeoutError(error: unknown): error is SyncAttemptTimeoutError {
  return error instanceof SyncAttemptTimeoutError;
}
