/**
 * Async Utilities
 *
 * Utilities for managing async operations, including concurrency limiting.
 */

/**
 * Map an array with a concurrency limit
 * Unlike Promise.all which runs all promises at once, this limits how many
 * concurrent operations run at a time to prevent overwhelming resources.
 *
 * @param items - Array of items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum number of concurrent operations (default: 5)
 * @returns Promise resolving to array of results in original order
 *
 * @example
 * // Fetch transactions with max 5 concurrent requests
 * const results = await mapWithConcurrency(txids, async (txid) => {
 *   return await fetchTransaction(txid);
 * }, 5);
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  };

  // Start workers up to the concurrency limit
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

/**
 * Batch process items with a limit on concurrent batches
 * Useful when you want to process items in chunks but also limit
 * how many chunks run at once.
 *
 * @param items - Array of items to process
 * @param batchSize - Size of each batch
 * @param processBatch - Async function to process a batch
 * @param batchConcurrency - Maximum concurrent batches (default: 1)
 */
export async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  processBatch: (batch: T[], batchIndex: number) => Promise<R[]>,
  batchConcurrency = 1
): Promise<R[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const batchResults = await mapWithConcurrency(
    batches,
    async (batch, index) => processBatch(batch, index),
    batchConcurrency
  );

  return batchResults.flat();
}

/**
 * Execute promises with a timeout
 * Useful for preventing operations from hanging indefinitely.
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Optional custom error message
 * @param onLateRejection - Optional observer for source-promise rejections after timeout
 * @throws Error if the promise doesn't resolve within the timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out',
  onLateRejection?: (error: unknown) => void
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  let timedOut = false;

  void promise.catch((error) => {
    if (timedOut) {
      onLateRejection?.(error);
    }
  });

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Execute async operations with retry logic
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: Error) => boolean;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error = new Error('No attempts made');
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt > maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }

      onRetry?.(lastError, attempt);
      await sleep(currentDelay);
      currentDelay *= backoffMultiplier;
    }
  }

  throw lastError;
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
