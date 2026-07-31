const DEFAULT_MAX_RETRIES = 3;
// Only retrieval methods may be replayed after ambiguous transport failures.
// Mutations stay at-most-once because the server may already have committed.
const TRANSPORT_RETRY_METHODS = new Set(["GET", "HEAD"]);

/** Safe-read transport retry configuration. */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  enabled?: boolean;
}

/** Request-scoped retry consumption shared across authentication replay. */
export interface RetryBudget {
  maxRetries: number;
  retriesUsed: number;
}

/** Transport policy for operations that must remain single-shot. */
export const NO_RETRY: RetryOptions = { enabled: false };

/**
 * Preserve requested retry configuration only for safe retrieval methods.
 * Mutation methods deliberately ignore transport retry configuration.
 */
export function resolveRetryOptions(
  method: string,
  requested: RetryOptions = {},
): RetryOptions {
  return TRANSPORT_RETRY_METHODS.has(method.toUpperCase())
    ? requested
    : NO_RETRY;
}

/** Create the transport retry budget once for the complete logical request. */
export function createRetryBudget(options: RetryOptions): RetryBudget {
  return {
    maxRetries:
      options.enabled === false
        ? 0
        : (options.maxRetries ?? DEFAULT_MAX_RETRIES),
    retriesUsed: 0,
  };
}

/**
 * Wait with uniformly distributed jitter in the inclusive -10% to +10% range
 * and reject promptly when the caller cancels.
 * Both completion paths release the timer and abort listener.
 */
export function sleepWithJitter(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  const jitter = ms * 0.2 * (Math.random() - 0.5);
  const delay = ms + jitter;
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(
        signal.reason ??
          new DOMException("The operation was aborted", "AbortError"),
      );
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}
