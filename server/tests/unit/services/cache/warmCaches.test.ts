import { vi } from 'vitest';
/**
 * Cache Warming Tests
 *
 * Tests the warmCaches() function that pre-populates commonly accessed
 * data into the cache during server startup.
 */

import { warmCaches } from '../../../../src/services/cache/cacheService';

// Mock the logger to avoid console noise
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock metrics
vi.mock('../../../../src/observability/metrics', () => ({
  cacheOperationsTotal: { inc: vi.fn() },
}));

// Mock feature flags service
const mockGetAllFlags = vi.fn();
vi.mock('../../../../src/services/featureFlagService', () => ({
  featureFlagService: {
    getAllFlags: mockGetAllFlags,
  },
}));

// Mock block height service
const mockGetBlockHeight = vi.fn();
vi.mock('../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getBlockHeight: () => mockGetBlockHeight(),
}));

// Mock price service
const mockGetPrice = vi.fn();
vi.mock('../../../../src/services/price', () => ({
  getPriceService: () => ({
    getPrice: () => mockGetPrice(),
  }),
}));

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('warmCaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default successful mocks
    mockGetAllFlags.mockResolvedValue([{ key: 'test', enabled: true }]);
    mockGetBlockHeight.mockResolvedValue(850000);
    mockGetPrice.mockResolvedValue({ usd: 50000 });
  });

  describe('successful warming', () => {
    it('should warm all caches by default', async () => {
      const result = await warmCaches();

      expect(result.warmed).toContain('featureFlags');
      expect(result.warmed).toContain('blockHeight');
      expect(result.warmed).toContain('priceData');
      expect(result.failed).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should warm only specified caches when configured', async () => {
      const result = await warmCaches({
        featureFlags: true,
        blockHeight: false,
        priceData: false,
      });

      expect(result.warmed).toContain('featureFlags');
      expect(result.warmed).not.toContain('blockHeight');
      expect(result.warmed).not.toContain('priceData');
      expect(result.failed).toHaveLength(0);
    });

    it('should skip all warming when all options are false', async () => {
      const result = await warmCaches({
        featureFlags: false,
        blockHeight: false,
        priceData: false,
      });

      expect(result.warmed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should track duration accurately', async () => {
      const dateNowSpy = vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(1_012);

      try {
        const result = await warmCaches({ featureFlags: false, priceData: false });

        expect(result.durationMs).toBe(12);
      } finally {
        dateNowSpy.mockRestore();
      }
    });
  });

  describe('feature flags warming', () => {
    it('should call getAllFlags to warm feature flags cache', async () => {
      await warmCaches({ blockHeight: false, priceData: false });

      expect(mockGetAllFlags).toHaveBeenCalled();
    });

    it('should mark as failed when getAllFlags returns empty array', async () => {
      mockGetAllFlags.mockResolvedValue([]);

      const result = await warmCaches({ blockHeight: false, priceData: false });

      expect(result.warmed).not.toContain('featureFlags');
      expect(result.failed).toContain('featureFlags');
    });

    it('should handle feature flags service errors gracefully', async () => {
      mockGetAllFlags.mockRejectedValue(new Error('Database connection failed'));

      const result = await warmCaches({ blockHeight: false, priceData: false });

      expect(result.warmed).not.toContain('featureFlags');
      expect(result.failed).toContain('featureFlags');
    });
  });

  describe('block height warming', () => {
    it('should call getBlockHeight to warm block height cache', async () => {
      await warmCaches({ featureFlags: false, priceData: false });

      expect(mockGetBlockHeight).toHaveBeenCalled();
    });

    it('should mark as warmed when block height is positive', async () => {
      mockGetBlockHeight.mockResolvedValue(850000);

      const result = await warmCaches({ featureFlags: false, priceData: false });

      expect(result.warmed).toContain('blockHeight');
    });

    it('should mark as failed when block height is 0', async () => {
      mockGetBlockHeight.mockResolvedValue(0);

      const result = await warmCaches({ featureFlags: false, priceData: false });

      expect(result.failed).toContain('blockHeight');
    });

    it('should mark as failed when block height is negative', async () => {
      mockGetBlockHeight.mockResolvedValue(-1);

      const result = await warmCaches({ featureFlags: false, priceData: false });

      expect(result.failed).toContain('blockHeight');
    });

    it('should handle block height service errors gracefully', async () => {
      mockGetBlockHeight.mockRejectedValue(new Error('Network timeout'));

      const result = await warmCaches({ featureFlags: false, priceData: false });

      expect(result.warmed).not.toContain('blockHeight');
      expect(result.failed).toContain('blockHeight');
    });
  });

  describe('price data warming', () => {
    it('should call getPrice to warm price cache', async () => {
      await warmCaches({ featureFlags: false, blockHeight: false });

      expect(mockGetPrice).toHaveBeenCalled();
    });

    it('should mark as warmed when price data is available', async () => {
      mockGetPrice.mockResolvedValue({ usd: 50000 });

      const result = await warmCaches({ featureFlags: false, blockHeight: false });

      expect(result.warmed).toContain('priceData');
    });

    it('should mark as failed when price data is null', async () => {
      mockGetPrice.mockResolvedValue(null);

      const result = await warmCaches({ featureFlags: false, blockHeight: false });

      expect(result.failed).toContain('priceData');
    });

    it('should mark as failed when price data is undefined', async () => {
      mockGetPrice.mockResolvedValue(undefined);

      const result = await warmCaches({ featureFlags: false, blockHeight: false });

      expect(result.failed).toContain('priceData');
    });

    it('should handle price service errors gracefully', async () => {
      mockGetPrice.mockRejectedValue(new Error('Price API unavailable'));

      const result = await warmCaches({ featureFlags: false, blockHeight: false });

      expect(result.warmed).not.toContain('priceData');
      expect(result.failed).toContain('priceData');
    });
  });

  describe('partial failures', () => {
    it('should continue warming other caches when one fails', async () => {
      mockGetAllFlags.mockRejectedValue(new Error('Feature flags error'));
      mockGetBlockHeight.mockResolvedValue(850000);
      mockGetPrice.mockResolvedValue({ usd: 50000 });

      const result = await warmCaches();

      expect(result.warmed).toContain('blockHeight');
      expect(result.warmed).toContain('priceData');
      expect(result.failed).toContain('featureFlags');
    });

    it('should track all failures when multiple caches fail', async () => {
      mockGetAllFlags.mockRejectedValue(new Error('Error 1'));
      mockGetBlockHeight.mockRejectedValue(new Error('Error 2'));
      mockGetPrice.mockRejectedValue(new Error('Error 3'));

      const result = await warmCaches();

      expect(result.warmed).toHaveLength(0);
      expect(result.failed).toContain('featureFlags');
      expect(result.failed).toContain('blockHeight');
      expect(result.failed).toContain('priceData');
    });

    it('should use Promise.allSettled for fault tolerance', async () => {
      const blockHeight = createDeferred<number>();
      mockGetAllFlags.mockRejectedValue(new Error('Fast failure'));
      mockGetBlockHeight.mockImplementation(() => blockHeight.promise);
      mockGetPrice.mockResolvedValue({ usd: 50000 });

      const resultPromise = warmCaches();
      await vi.waitFor(() => expect(mockGetBlockHeight).toHaveBeenCalled());
      blockHeight.resolve(850000);
      const result = await resultPromise;

      // Should still complete all tasks even though one failed immediately
      expect(result.warmed).toContain('blockHeight');
      expect(result.warmed).toContain('priceData');
      expect(result.failed).toContain('featureFlags');
    });
  });

  describe('concurrent execution', () => {
    it('should execute warming tasks in parallel', async () => {
      const executionOrder: string[] = [];
      const featureFlags = createDeferred<Array<{ key: string; enabled: boolean }>>();
      const blockHeight = createDeferred<number>();
      const priceData = createDeferred<{ usd: number }>();

      mockGetAllFlags.mockImplementation(async () => {
        executionOrder.push('featureFlags:start');
        await featureFlags.promise;
        executionOrder.push('featureFlags:end');
        return [{ key: 'test', enabled: true }];
      });

      mockGetBlockHeight.mockImplementation(async () => {
        executionOrder.push('blockHeight:start');
        await blockHeight.promise;
        executionOrder.push('blockHeight:end');
        return 850000;
      });

      mockGetPrice.mockImplementation(async () => {
        executionOrder.push('priceData:start');
        await priceData.promise;
        executionOrder.push('priceData:end');
        return { usd: 50000 };
      });

      const resultPromise = warmCaches();
      await vi.waitFor(() => expect(executionOrder.filter(item => item.endsWith(':start'))).toHaveLength(3));
      priceData.resolve({ usd: 50000 });
      await vi.waitFor(() => expect(executionOrder).toContain('priceData:end'));

      // All should start before any ends (parallel execution)
      const startEndCounts = executionOrder.reduce(
        (acc, item) => {
          if (item.endsWith(':start')) acc.starts++;
          if (item.endsWith(':end')) acc.ends++;
          return acc;
        },
        { starts: 0, ends: 0 }
      );

      // With parallel execution, we should see all 3 starts happen
      // before the first end (priceData at 10ms)
      const firstEndIndex = executionOrder.findIndex(item => item.endsWith(':end'));
      const startsBeforeFirstEnd = executionOrder
        .slice(0, firstEndIndex)
        .filter(item => item.endsWith(':start')).length;

      expect(startsBeforeFirstEnd).toBe(3); // All tasks started before first completed

      blockHeight.resolve(850000);
      featureFlags.resolve([{ key: 'test', enabled: true }]);
      await resultPromise;
    });
  });
});
