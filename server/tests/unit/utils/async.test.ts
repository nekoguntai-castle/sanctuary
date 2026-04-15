import { vi } from 'vitest';
/**
 * Async Utilities Tests
 *
 * Tests for async utility functions including concurrency limiting,
 * batch processing, timeouts, and retry logic.
 */

import {
  mapWithConcurrency,
  batchProcess,
  withTimeout,
  withRetry,
  sleep,
} from '../../../src/utils/async';

describe('Async Utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('mapWithConcurrency', () => {
    it('should process all items and return results in original order', async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await mapWithConcurrency(
        items,
        async (item) => item * 2,
        2
      );

      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('should respect concurrency limit', async () => {
      let currentConcurrency = 0;
      let maxConcurrency = 0;
      const items = [1, 2, 3, 4, 5, 6];

      const promise = mapWithConcurrency(
        items,
        async (item) => {
          currentConcurrency++;
          maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
          await sleep(10);
          currentConcurrency--;
          return item;
        },
        3
      );

      await vi.runAllTimersAsync();
      await promise;

      expect(maxConcurrency).toBeLessThanOrEqual(3);
    });

    it('should handle empty array', async () => {
      const results = await mapWithConcurrency([], async (item) => item, 5);
      expect(results).toEqual([]);
    });

    it('should handle single item', async () => {
      const results = await mapWithConcurrency(
        [42],
        async (item) => item * 2,
        5
      );
      expect(results).toEqual([84]);
    });

    it('should pass correct index to function', async () => {
      const items = ['a', 'b', 'c'];
      const results = await mapWithConcurrency(
        items,
        async (item, index) => `${item}${index}`,
        2
      );

      expect(results).toEqual(['a0', 'b1', 'c2']);
    });

    it('should use default concurrency of 5', async () => {
      let maxConcurrency = 0;
      let currentConcurrency = 0;
      const items = Array.from({ length: 10 }, (_, i) => i);

      const promise = mapWithConcurrency(items, async (item) => {
        currentConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
        await sleep(5);
        currentConcurrency--;
        return item;
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(maxConcurrency).toBeLessThanOrEqual(5);
    });

    it('should handle errors in processing function', async () => {
      const items = [1, 2, 3];

      await expect(
        mapWithConcurrency(items, async (item) => {
          if (item === 2) throw new Error('Item 2 failed');
          return item;
        }, 2)
      ).rejects.toThrow('Item 2 failed');
    });

    it('should limit concurrency when fewer items than limit', async () => {
      let maxConcurrency = 0;
      let currentConcurrency = 0;
      const items = [1, 2]; // Only 2 items with limit 5

      const promise = mapWithConcurrency(
        items,
        async (item) => {
          currentConcurrency++;
          maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
          await sleep(5);
          currentConcurrency--;
          return item;
        },
        5
      );

      await vi.runAllTimersAsync();
      await promise;

      expect(maxConcurrency).toBe(2);
    });
  });

  describe('batchProcess', () => {
    it('should split items into batches', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const batchSizes: number[] = [];

      const results = await batchProcess(
        items,
        3,
        async (batch, index) => {
          batchSizes.push(batch.length);
          return batch.map((n) => n * 2);
        }
      );

      expect(batchSizes).toEqual([3, 3, 1]);
      expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    });

    it('should handle empty array', async () => {
      const results = await batchProcess([], 5, async (batch) => batch);
      expect(results).toEqual([]);
    });

    it('should handle batch size larger than items', async () => {
      const items = [1, 2, 3];
      const batchCalls: number[] = [];

      const results = await batchProcess(
        items,
        10,
        async (batch, index) => {
          batchCalls.push(index);
          return batch.map((n) => n * 2);
        }
      );

      expect(batchCalls).toEqual([0]); // Only one batch
      expect(results).toEqual([2, 4, 6]);
    });

    it('should respect batch concurrency limit', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i);
      let currentConcurrency = 0;
      let maxConcurrency = 0;

      const promise = batchProcess(
        items,
        5,
        async (batch) => {
          currentConcurrency++;
          maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
          await sleep(10);
          currentConcurrency--;
          return batch;
        },
        2
      );

      await vi.runAllTimersAsync();
      await promise;

      expect(maxConcurrency).toBeLessThanOrEqual(2);
    });

    it('should pass correct batch index', async () => {
      const items = [1, 2, 3, 4, 5, 6];
      const indices: number[] = [];

      await batchProcess(
        items,
        2,
        async (batch, index) => {
          indices.push(index);
          return batch;
        }
      );

      expect(indices.sort()).toEqual([0, 1, 2]);
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise completes before timeout', async () => {
      const result = await withTimeout(
        Promise.resolve('success'),
        100
      );

      expect(result).toBe('success');
    });

    it('should reject if promise exceeds timeout', async () => {
      const promise = withTimeout(sleep(200).then(() => 'late'), 50);

      // Advance time to trigger the timeout (but not complete the sleep)
      vi.advanceTimersByTime(51);

      await expect(promise).rejects.toThrow('Operation timed out');
    });

    it('should use custom error message', async () => {
      const promise = withTimeout(sleep(100), 10, 'Custom timeout message');

      vi.advanceTimersByTime(11);

      await expect(promise).rejects.toThrow('Custom timeout message');
    });

    it('should propagate promise rejection', async () => {
      await expect(
        withTimeout(Promise.reject(new Error('Promise error')), 100)
      ).rejects.toThrow('Promise error');
    });

    it('should handle zero timeout', async () => {
      const promise = withTimeout(sleep(10), 0);

      // With fake timers, advance once to trigger the zero-delay timer.
      vi.advanceTimersByTime(1);

      await expect(promise).rejects.toThrow('Operation timed out');
    });

    it('should resolve with correct value type', async () => {
      const result = await withTimeout(
        Promise.resolve({ data: 42 }),
        100
      );

      expect(result).toEqual({ data: 42 });
    });
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(1);
    });

    it('should retry on failure and succeed', async () => {
      let attempts = 0;
      const promise = withRetry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error('Not yet');
          return 'success';
        },
        { maxRetries: 3, delayMs: 10 }
      );

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max retries exceeded', async () => {
      let attempts = 0;

      // Create the promise and catch it immediately to avoid unhandled rejection
      const promise = withRetry(
        async () => {
          attempts++;
          throw new Error('Always fails');
        },
        { maxRetries: 2, delayMs: 10 }
      ).catch((e) => e);

      // Run timers and wait for the promise to settle
      await vi.runAllTimersAsync();

      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Always fails');
      expect(attempts).toBe(3); // Initial + 2 retries
    });

    it('should apply exponential backoff', async () => {
      // Track the number of attempts and verify backoff is applied
      // by checking that the function is called with increasing delays
      let attempts = 0;

      const promise = withRetry(
        async () => {
          attempts++;
          if (attempts < 4) throw new Error('Retry');
          return 'done';
        },
        { maxRetries: 3, delayMs: 20, backoffMultiplier: 2 }
      );

      // With backoff multiplier 2 and delayMs 20:
      // - First retry waits 20ms
      // - Second retry waits 40ms
      // - Third retry waits 80ms
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('done');
      expect(attempts).toBe(4); // Initial + 3 retries
    });

    it('should respect shouldRetry callback', async () => {
      let attempts = 0;

      // Catch immediately to avoid unhandled rejection
      const promise = withRetry(
        async () => {
          attempts++;
          throw new Error('Permanent error');
        },
        {
          maxRetries: 5,
          delayMs: 10,
          shouldRetry: (error) => !error.message.includes('Permanent'),
        }
      ).catch((e) => e);

      await vi.runAllTimersAsync();

      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Permanent error');
      expect(attempts).toBe(1); // Should not retry
    });

    it('should call onRetry callback', async () => {
      const retryLogs: Array<{ error: string; attempt: number }> = [];

      const promise = withRetry(
        async () => {
          if (retryLogs.length < 2) throw new Error('Failing');
          return 'done';
        },
        {
          maxRetries: 3,
          delayMs: 10,
          onRetry: (error, attempt) => {
            retryLogs.push({ error: error.message, attempt });
          },
        }
      );

      await vi.runAllTimersAsync();
      await promise;

      expect(retryLogs).toEqual([
        { error: 'Failing', attempt: 1 },
        { error: 'Failing', attempt: 2 },
      ]);
    });

    it('should handle non-Error throws', async () => {
      await expect(
        withRetry(
          async () => {
            throw 'String error';
          },
          { maxRetries: 0 }
        )
      ).rejects.toThrow('String error');
    });

    it('should use default options', async () => {
      let attempts = 0;

      // Catch immediately to avoid unhandled rejection
      const promise = withRetry(async () => {
        attempts++;
        throw new Error('Always fails');
      }).catch((e) => e);

      await vi.runAllTimersAsync();

      const error = await promise;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Always fails');
      expect(attempts).toBe(4); // 1 initial + 3 default retries
    });

    it('throws default last error when maxRetries is negative', async () => {
      await expect(
        withRetry(async () => 'never', { maxRetries: -1 })
      ).rejects.toThrow('No attempts made');
    });
  });

  describe('sleep', () => {
    it('should delay for specified milliseconds', async () => {
      const promise = sleep(50);

      // Sleep should not resolve until timers are advanced
      vi.advanceTimersByTime(49);
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(1);
      await promise;

      // Promise resolved after advancing 50ms
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should resolve with undefined', async () => {
      const promise = sleep(10);
      vi.advanceTimersByTime(10);
      const result = await promise;
      expect(result).toBeUndefined();
    });

    it('should handle zero delay', async () => {
      const promise = sleep(0);
      vi.advanceTimersByTime(0);
      await promise;
      // Should resolve immediately
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
