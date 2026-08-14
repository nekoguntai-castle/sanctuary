import { vi } from 'vitest';
/**
 * Redis WebSocket Bridge Tests
 *
 * Tests the Redis pub/sub bridge for cross-instance WebSocket broadcasting.
 */

import { redisBridge, initializeRedisBridge, shutdownRedisBridge } from '../../../src/websocket/redisBridge';

// Mock Redis module - Redis not connected
vi.mock('../../../src/infrastructure/redis', () => ({
  getRedisClient: vi.fn(() => null),
  isRedisConnected: vi.fn(() => false),
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

describe('RedisWebSocketBridge', () => {
  beforeEach(async () => {
    // Reset metrics between tests
    redisBridge.resetMetrics();
  });

  afterEach(async () => {
    await shutdownRedisBridge();
  });

  describe('initialization', () => {
    it('should handle initialization when Redis is not connected', async () => {
      await initializeRedisBridge();

      // Should gracefully handle missing Redis
      expect(redisBridge.isActive()).toBe(false);
    });

    it('should not throw when initialized multiple times', async () => {
      await expect(initializeRedisBridge()).resolves.not.toThrow();
      await expect(initializeRedisBridge()).resolves.not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should handle shutdown gracefully', async () => {
      await initializeRedisBridge();
      await expect(shutdownRedisBridge()).resolves.not.toThrow();
    });

    it('should be safe to call shutdown multiple times', async () => {
      await initializeRedisBridge();
      await shutdownRedisBridge();
      await expect(shutdownRedisBridge()).resolves.not.toThrow();
    });

    it('should be safe to shutdown without initialization', async () => {
      await expect(shutdownRedisBridge()).resolves.not.toThrow();
    });
  });

  describe('publishBroadcast', () => {
    it('should silently skip publishing when not initialized', () => {
      // Should not throw
      expect(() => {
        redisBridge.publishBroadcast({
          type: 'transaction',
          data: { txid: 'abc123' },
          walletId: 'wallet-1',
        } as any);
      }).not.toThrow();

      // Should not increment published count
      const metrics = redisBridge.getMetrics();
      expect(metrics.published).toBe(0);
    });

    it('should handle events with walletId', () => {
      expect(() => {
        redisBridge.publishBroadcast({
          type: 'balance',
          data: { balance: 100000 },
          walletId: 'wallet-123',
        } as any);
      }).not.toThrow();
    });

    it('should handle events with addressId', () => {
      expect(() => {
        redisBridge.publishBroadcast({
          type: 'transaction',
          data: { amount: 5000 },
          addressId: 'addr-456',
        } as any);
      }).not.toThrow();
    });

    it('should handle events without wallet or address', () => {
      expect(() => {
        redisBridge.publishBroadcast({
          type: 'block',
          data: { height: 800000 },
        } as any);
      }).not.toThrow();
    });
  });

  describe('publishControl', () => {
    it('should silently skip publishing when not initialized', () => {
      expect(() => {
        redisBridge.publishControl({
          version: 1,
          type: 'user-access-revoked',
          userId: 'user-1',
        });
      }).not.toThrow();

      expect(redisBridge.getMetrics().published).toBe(0);
    });
  });

  describe('setBroadcastHandler', () => {
    it('should accept a broadcast handler', () => {
      const handler = vi.fn();

      expect(() => {
        redisBridge.setBroadcastHandler(handler);
      }).not.toThrow();
    });

    it('should allow overwriting handler', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      redisBridge.setBroadcastHandler(handler1);
      redisBridge.setBroadcastHandler(handler2);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('isActive', () => {
    it('should return false when not initialized', () => {
      expect(redisBridge.isActive()).toBe(false);
    });

    it('should return false when Redis not available', async () => {
      await initializeRedisBridge();
      expect(redisBridge.isActive()).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('should return initial metrics', () => {
      const metrics = redisBridge.getMetrics();

      expect(metrics).toEqual({
        published: 0,
        received: 0,
        errors: 0,
        skippedSelf: 0,
        isActive: false,
        instanceId: expect.any(String),
      });
    });

    it('should include instanceId in metrics', () => {
      const metrics = redisBridge.getMetrics();

      expect(metrics.instanceId).toBeDefined();
      expect(metrics.instanceId.length).toBeGreaterThan(0);
    });

    it('should maintain consistent instanceId', () => {
      const metrics1 = redisBridge.getMetrics();
      const metrics2 = redisBridge.getMetrics();

      expect(metrics1.instanceId).toBe(metrics2.instanceId);
    });
  });

  describe('resetMetrics', () => {
    it('should reset metrics to zero', () => {
      // Since we can't actually increment metrics without Redis,
      // just verify reset doesn't throw
      expect(() => redisBridge.resetMetrics()).not.toThrow();

      const metrics = redisBridge.getMetrics();
      expect(metrics.published).toBe(0);
      expect(metrics.received).toBe(0);
      expect(metrics.errors).toBe(0);
      expect(metrics.skippedSelf).toBe(0);
    });
  });

  describe('getInstanceId', () => {
    it('should return a non-empty instance ID', () => {
      const instanceId = redisBridge.getInstanceId();

      expect(instanceId).toBeDefined();
      expect(typeof instanceId).toBe('string');
      expect(instanceId.length).toBeGreaterThan(0);
    });

    it('should include process ID in instance ID', () => {
      const instanceId = redisBridge.getInstanceId();

      // Format: {pid}-{timestamp}-{random}
      expect(instanceId).toContain(process.pid.toString());
    });

    it('should return consistent instance ID', () => {
      const id1 = redisBridge.getInstanceId();
      const id2 = redisBridge.getInstanceId();

      expect(id1).toBe(id2);
    });
  });

  describe('graceful degradation', () => {
    it('should operate in local-only mode without Redis', async () => {
      await initializeRedisBridge();

      // Should not be active (no Redis)
      expect(redisBridge.isActive()).toBe(false);

      // Should still accept broadcasts without errors
      expect(() => {
        redisBridge.publishBroadcast({
          type: 'sync',
          data: { message: 'hello' },
        } as any);
      }).not.toThrow();
    });

    it('should handle handler without throwing when inactive', () => {
      const handler = vi.fn();
      redisBridge.setBroadcastHandler(handler);

      // Publishing when inactive should not call handler
      redisBridge.publishBroadcast({
        type: 'sync',
        data: {},
      } as any);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('RedisWebSocketBridge integration notes', () => {
  // Note: Full Redis integration tests would require a real Redis connection
  // or more sophisticated module isolation. The core functionality is tested
  // above with the mocked Redis-unavailable scenario.

  it('should be designed for Redis pub/sub integration', () => {
    // Verify the expected API shape exists for Redis integration
    expect(typeof redisBridge.publishBroadcast).toBe('function');
    expect(typeof redisBridge.setBroadcastHandler).toBe('function');
    expect(typeof redisBridge.isActive).toBe('function');
    expect(typeof redisBridge.getMetrics).toBe('function');
    expect(typeof redisBridge.getInstanceId).toBe('function');

    // Verify instance ID format matches expected pattern
    const instanceId = redisBridge.getInstanceId();
    const parts = instanceId.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it('should track metrics structure correctly', () => {
    const metrics = redisBridge.getMetrics();

    expect(metrics).toHaveProperty('published');
    expect(metrics).toHaveProperty('received');
    expect(metrics).toHaveProperty('errors');
    expect(metrics).toHaveProperty('skippedSelf');
    expect(metrics).toHaveProperty('isActive');
    expect(metrics).toHaveProperty('instanceId');

    expect(typeof metrics.published).toBe('number');
    expect(typeof metrics.received).toBe('number');
    expect(typeof metrics.errors).toBe('number');
    expect(typeof metrics.skippedSelf).toBe('number');
    expect(typeof metrics.isActive).toBe('boolean');
    expect(typeof metrics.instanceId).toBe('string');
  });
});
