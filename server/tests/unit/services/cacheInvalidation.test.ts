import { vi } from 'vitest';
/**
 * Cache Invalidation Service Tests
 *
 * Tests the event-driven cache invalidation system that subscribes
 * to event bus events and invalidates relevant caches.
 */

// Define hoisted mocks so they can be referenced in vi.mock factories
const { mockWalletCache, mockFeeCache, mockPriceCache } = vi.hoisted(() => ({
  mockWalletCache: {
    deletePattern: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue(true),
  },
  mockFeeCache: {
    clear: vi.fn().mockResolvedValue(undefined),
  },
  mockPriceCache: {
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the System 2 cache service
vi.mock('../../../src/services/cache', () => ({
  walletCache: mockWalletCache,
  feeCache: mockFeeCache,
  priceCache: mockPriceCache,
}));

// Mock logger to avoid console noise
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  initializeCacheInvalidation,
  shutdownCacheInvalidation,
  getCacheInvalidationStatus,
} from '../../../src/services/cacheInvalidation';
import { eventBus } from '../../../src/events/eventBus';

const waitForWalletCacheInvalidation = async (walletId: string) => {
  await vi.waitFor(() => {
    expect(mockWalletCache.deletePattern).toHaveBeenCalledWith(`balance-history:${walletId}:*`);
    expect(mockWalletCache.delete).toHaveBeenCalledWith(`tx-stats:${walletId}`);
  });
};

describe('CacheInvalidation', () => {
  beforeEach(() => {
    // Clean up any previous initialization
    shutdownCacheInvalidation();
    // Clear all mock calls
    vi.clearAllMocks();
  });

  afterEach(() => {
    shutdownCacheInvalidation();
  });

  describe('initializeCacheInvalidation', () => {
    it('should register event listeners on initialization', () => {
      const initialListenerCount = eventBus.listenerCount('wallet:synced');

      initializeCacheInvalidation();

      // Should have registered listeners for various events
      expect(eventBus.listenerCount('wallet:synced')).toBeGreaterThan(initialListenerCount);
      expect(eventBus.listenerCount('wallet:deleted')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('wallet:balanceChanged')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('transaction:received')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('transaction:sent')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('transaction:confirmed')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('blockchain:priceUpdated')).toBeGreaterThan(0);
      expect(eventBus.listenerCount('blockchain:feeEstimateUpdated')).toBeGreaterThan(0);
    });

    it('should not register duplicate listeners on re-initialization', () => {
      initializeCacheInvalidation();
      const listenerCount = eventBus.listenerCount('wallet:synced');

      // Try to initialize again
      initializeCacheInvalidation();

      // Should still have the same number of listeners
      expect(eventBus.listenerCount('wallet:synced')).toBe(listenerCount);
    });
  });

  describe('shutdownCacheInvalidation', () => {
    it('should remove all event listeners on shutdown', () => {
      initializeCacheInvalidation();
      expect(eventBus.listenerCount('wallet:synced')).toBeGreaterThan(0);

      shutdownCacheInvalidation();

      // All listeners registered by this service should be removed
      // (Note: other services might still have listeners)
      expect(eventBus.listenerCount('wallet:synced')).toBe(0);
      expect(eventBus.listenerCount('wallet:deleted')).toBe(0);
      expect(eventBus.listenerCount('wallet:balanceChanged')).toBe(0);
    });

    it('should be safe to call shutdown when not initialized', () => {
      // Should not throw
      expect(() => shutdownCacheInvalidation()).not.toThrow();
    });

    it('should be safe to call shutdown multiple times', () => {
      initializeCacheInvalidation();
      shutdownCacheInvalidation();

      // Second shutdown should be a no-op
      expect(() => shutdownCacheInvalidation()).not.toThrow();
    });
  });

  describe('wallet event handling', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should invalidate System 2 wallet caches on wallet:synced event', async () => {
      const walletId = 'test-wallet-123';

      eventBus.emit('wallet:synced', {
        walletId,
        balance: 100000n,
        unconfirmedBalance: 0n,
        transactionCount: 10,
        duration: 500,
      });

      await waitForWalletCacheInvalidation(walletId);
    });

    it('should invalidate caches on wallet:deleted event', async () => {
      const walletId = 'deleted-wallet-456';

      eventBus.emit('wallet:deleted', {
        walletId,
        userId: 'user-123',
      });

      await waitForWalletCacheInvalidation(walletId);
    });

    it('should invalidate caches on wallet:balanceChanged event', async () => {
      const walletId = 'balance-wallet-789';

      eventBus.emit('wallet:balanceChanged', {
        walletId,
        previousBalance: 50000n,
        newBalance: 100000n,
        difference: 50000n,
      });

      await waitForWalletCacheInvalidation(walletId);
    });
  });

  describe('transaction event handling', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should invalidate caches on transaction:received event', async () => {
      const walletId = 'tx-wallet-1';

      eventBus.emit('transaction:received', {
        walletId,
        txid: 'abc123',
        amount: 10000n,
        address: 'bc1q...',
        confirmations: 0,
      });

      await waitForWalletCacheInvalidation(walletId);
    });

    it('should invalidate caches on transaction:sent event', async () => {
      const walletId = 'tx-wallet-2';

      eventBus.emit('transaction:sent', {
        walletId,
        txid: 'def456',
        amount: 5000n,
        fee: 200n,
        recipients: [{ address: 'bc1q...', amount: 5000n }],
      });

      await waitForWalletCacheInvalidation(walletId);
    });

    it('should invalidate caches on transaction:confirmed event', async () => {
      const walletId = 'tx-wallet-3';

      eventBus.emit('transaction:confirmed', {
        walletId,
        txid: 'ghi789',
        confirmations: 6,
        blockHeight: 800000,
      });

      await waitForWalletCacheInvalidation(walletId);
    });
  });

  describe('blockchain event handling', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should clear price cache on blockchain:priceUpdated event', async () => {
      eventBus.emit('blockchain:priceUpdated', {
        btcUsd: 45000,
        source: 'coingecko',
      });

      await vi.waitFor(() => expect(mockPriceCache.clear).toHaveBeenCalled());
    });

    it('should clear System 2 fee cache on blockchain:feeEstimateUpdated event', async () => {
      eventBus.emit('blockchain:feeEstimateUpdated', {
        network: 'mainnet',
        fastestFee: 50,
        halfHourFee: 30,
        hourFee: 10,
      });

      await vi.waitFor(() => expect(mockFeeCache.clear).toHaveBeenCalled());
    });
  });

  describe('multiple events', () => {
    beforeEach(() => {
      initializeCacheInvalidation();
    });

    it('should handle multiple wallet events for different wallets', async () => {
      const walletIds = ['wallet-a', 'wallet-b', 'wallet-c'];

      for (const walletId of walletIds) {
        eventBus.emit('wallet:synced', {
          walletId,
          balance: 100000n,
          unconfirmedBalance: 0n,
          transactionCount: 5,
          duration: 100,
        });
      }

      await vi.waitFor(() => {
        expect(mockWalletCache.deletePattern).toHaveBeenCalledTimes(3);
        expect(mockWalletCache.delete).toHaveBeenCalledTimes(3);
      });
      for (const walletId of walletIds) {
        expect(mockWalletCache.deletePattern).toHaveBeenCalledWith(`balance-history:${walletId}:*`);
        expect(mockWalletCache.delete).toHaveBeenCalledWith(`tx-stats:${walletId}`);
      }
    });

    it('should handle rapid successive events', async () => {
      const walletId = 'rapid-wallet';

      // Emit multiple events in quick succession
      for (let i = 0; i < 5; i++) {
        eventBus.emit('wallet:balanceChanged', {
          walletId,
          previousBalance: BigInt(i * 1000),
          newBalance: BigInt((i + 1) * 1000),
          difference: 1000n,
        });
      }

      await vi.waitFor(() => {
        expect(mockWalletCache.deletePattern).toHaveBeenCalledTimes(5);
        expect(mockWalletCache.delete).toHaveBeenCalledTimes(5);
      });
    });
  });

  describe('initialization state', () => {
    it('should allow re-initialization after shutdown', () => {
      initializeCacheInvalidation();
      const firstCount = eventBus.listenerCount('wallet:synced');

      shutdownCacheInvalidation();
      expect(eventBus.listenerCount('wallet:synced')).toBe(0);

      initializeCacheInvalidation();
      expect(eventBus.listenerCount('wallet:synced')).toBe(firstCount);
    });

    it('should report status across init and shutdown transitions', () => {
      expect(getCacheInvalidationStatus()).toEqual({
        initialized: false,
        listeners: 0,
      });

      initializeCacheInvalidation();
      expect(getCacheInvalidationStatus()).toEqual({
        initialized: true,
        listeners: 8,
      });

      shutdownCacheInvalidation();
      expect(getCacheInvalidationStatus()).toEqual({
        initialized: false,
        listeners: 0,
      });
    });
  });
});
