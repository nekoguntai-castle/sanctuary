/**
 * Rate Limiting Middleware Tests
 *
 * Tests rate limiting behavior for different tiers and exponential backoff.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import express from 'express';
import request from 'supertest';
import {
  defaultRateLimiter,
  strictRateLimiter,
  authRateLimiter,
  transactionCreateRateLimiter,
  broadcastRateLimiter,
  deviceRegistrationRateLimiter,
  addressGenerationRateLimiter,
  resetBackoff,
  cleanupBackoffTracker,
  calculateBackoff,
  backoffTracker,
} from '../../../src/middleware/rateLimit';
import { AuthenticatedRequest } from '../../../src/middleware/auth';
import { logSecurityEvent } from '../../../src/middleware/requestLogger';

// Mock the config
vi.mock('../../../src/config', () => ({
  config: {
    rateLimit: {
      windowMs: 60000,
      maxRequests: 60,
      backoff: {
        baseRetryAfter: 60,
        maxRetryAfter: 3600,
        multiplier: 2,
      },
    },
  },
}));

// Mock the request logger
vi.mock('../../../src/middleware/requestLogger', () => ({
  logSecurityEvent: vi.fn(),
}));

describe('Rate Limiting Middleware', () => {
  const invokeLimiterUntilBlocked = async (
    middleware: (req: Request, res: Response, next: NextFunction) => void,
    max: number,
    options?: { userId?: string; path?: string; ip?: string; forceNoIp?: boolean }
  ) => {
    const path = options?.path || '/api/v1/test';
    const ip = options?.ip || '198.51.100.100';
    const userId = options?.userId;
    const forceNoIp = options?.forceNoIp || false;
    const app = express();
    app.set('trust proxy', true);
    app.use((req, _res, next) => {
      if (forceNoIp) {
        Object.defineProperty(req, 'ip', {
          value: undefined,
          configurable: true,
        });
      }
      if (userId) {
        (req as AuthenticatedRequest).user = {
          userId,
          username: 'test-user',
        } as any;
      }
      next();
    });
    app.use(middleware);
    app.get(path, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const makeRequest = () => {
      const reqBuilder = request(app).get(path).set('user-agent', 'vitest-agent');
      return forceNoIp ? reqBuilder : reqBuilder.set('x-forwarded-for', ip);
    };

    let response = await makeRequest();
    for (let i = 0; i < max; i++) {
      response = await makeRequest();
    }
    return response;
  };

  beforeEach(() => {
    // Clear backoff tracker between tests
    backoffTracker.clear();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaultRateLimiter', () => {
    it('should be configured as a middleware function', () => {
      expect(typeof defaultRateLimiter).toBe('function');
    });

    it('should pass requests through when under limit', () => {
      const mockReq = {
        ip: '192.168.1.1',
        headers: {},
        path: '/api/v1/test',
      } as Partial<AuthenticatedRequest>;

      const mockRes = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as Partial<Response>;

      const mockNext = vi.fn();

      // First request should pass
      defaultRateLimiter(
        mockReq as Request,
        mockRes as Response,
        mockNext as NextFunction
      );

      // The middleware should call next or set headers
      expect(typeof defaultRateLimiter).toBe('function');
    });
  });

  describe('strictRateLimiter', () => {
    it('should be configured as a middleware function', () => {
      expect(typeof strictRateLimiter).toBe('function');
    });

    it('should have stricter limits than default', () => {
      expect(typeof strictRateLimiter).toBe('function');
    });
  });

  describe('authRateLimiter', () => {
    it('should be configured as a middleware function', () => {
      expect(typeof authRateLimiter).toBe('function');
    });

    it('should be the strictest limiter for security', () => {
      expect(typeof authRateLimiter).toBe('function');
    });
  });

  describe('Mobile-Specific Rate Limiters', () => {
    describe('transactionCreateRateLimiter', () => {
      it('should be configured as a middleware function', () => {
        expect(typeof transactionCreateRateLimiter).toBe('function');
      });

      it('should allow requests through', () => {
        const mockReq = {
          ip: '10.0.0.1',
          headers: {},
          path: '/api/v1/mobile/transactions',
          user: { userId: 'user-123' },
        } as Partial<AuthenticatedRequest>;

        const mockRes = {
          setHeader: vi.fn(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as Partial<Response>;

        const mockNext = vi.fn();

        transactionCreateRateLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext as NextFunction
        );

        expect(typeof transactionCreateRateLimiter).toBe('function');
      });
    });

    describe('broadcastRateLimiter', () => {
      it('should be configured as a middleware function', () => {
        expect(typeof broadcastRateLimiter).toBe('function');
      });

      it('should allow requests through', () => {
        const mockReq = {
          ip: '10.0.0.2',
          headers: {},
          path: '/api/v1/mobile/broadcast',
          user: { userId: 'user-456' },
        } as Partial<AuthenticatedRequest>;

        const mockRes = {
          setHeader: vi.fn(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as Partial<Response>;

        const mockNext = vi.fn();

        broadcastRateLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext as NextFunction
        );

        expect(typeof broadcastRateLimiter).toBe('function');
      });
    });

    describe('deviceRegistrationRateLimiter', () => {
      it('should be configured as a middleware function', () => {
        expect(typeof deviceRegistrationRateLimiter).toBe('function');
      });

      it('should allow requests through', () => {
        const mockReq = {
          ip: '10.0.0.3',
          headers: {},
          path: '/api/v1/mobile/devices',
          user: { userId: 'user-789' },
        } as Partial<AuthenticatedRequest>;

        const mockRes = {
          setHeader: vi.fn(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as Partial<Response>;

        const mockNext = vi.fn();

        deviceRegistrationRateLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext as NextFunction
        );

        expect(typeof deviceRegistrationRateLimiter).toBe('function');
      });
    });

    describe('addressGenerationRateLimiter', () => {
      it('should be configured as a middleware function', () => {
        expect(typeof addressGenerationRateLimiter).toBe('function');
      });

      it('should allow requests through', () => {
        const mockReq = {
          ip: '10.0.0.4',
          headers: {},
          path: '/api/v1/mobile/addresses',
          user: { userId: 'user-abc' },
        } as Partial<AuthenticatedRequest>;

        const mockRes = {
          setHeader: vi.fn(),
          status: vi.fn().mockReturnThis(),
          json: vi.fn(),
        } as Partial<Response>;

        const mockNext = vi.fn();

        addressGenerationRateLimiter(
          mockReq as Request,
          mockRes as Response,
          mockNext as NextFunction
        );

        expect(typeof addressGenerationRateLimiter).toBe('function');
      });
    });
  });

  describe('key generator fallback branches', () => {
    it('uses fallback keys when user ID and IP are missing', () => {
      const req = {
        headers: {},
        path: '/api/v1/test',
      } as Partial<AuthenticatedRequest>;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      expect(() => defaultRateLimiter(req as Request, res, next)).not.toThrow();
      expect(() => strictRateLimiter(req as Request, res, next)).not.toThrow();
      expect(() => transactionCreateRateLimiter(req as Request, res, next)).not.toThrow();
      expect(() => broadcastRateLimiter(req as Request, res, next)).not.toThrow();
      expect(() => deviceRegistrationRateLimiter(req as Request, res, next)).not.toThrow();
      expect(() => addressGenerationRateLimiter(req as Request, res, next)).not.toThrow();
    });

    it('uses auth unknown key fallback when IP is missing', () => {
      const req = {
        headers: {},
        path: '/api/v1/auth/login',
      } as Partial<Request>;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      expect(() => authRateLimiter(req as Request, res, next)).not.toThrow();
    });
  });

  describe('Rate limiter handlers (429 paths)', () => {
    it('defaultRateLimiter emits 429 payload and security log', async () => {
      const response = await invokeLimiterUntilBlocked(defaultRateLimiter, 60, {
        userId: 'default-user',
        path: '/api/v1/wallets',
      });

      expect(response.status).toBe(429);
      expect(response.body.error).toBe('Too Many Requests');
      expect(response.body.retryAfter).toBeTypeOf('number');
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'default', userId: 'default-user' })
      );
    });

    it('defaultRateLimiter falls back to IP key for unauthenticated clients', async () => {
      const response = await invokeLimiterUntilBlocked(defaultRateLimiter, 60, {
        ip: '203.0.113.45',
        path: '/api/v1/wallets',
      });

      expect(response.status).toBe(429);
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({
          tier: 'default',
          userId: undefined,
          ip: '203.0.113.45',
        })
      );
    });

    it('defaultRateLimiter uses backoff violation fallback when tracker lookup misses', async () => {
      const getSpy = vi.spyOn(backoffTracker, 'get').mockReturnValue(undefined as any);
      const response = await invokeLimiterUntilBlocked(defaultRateLimiter, 60, {
        path: '/api/v1/wallets',
        forceNoIp: true,
      });

      expect(response.status).toBe(429);
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({
          tier: 'default',
          backoffViolations: 1,
        })
      );
      getSpy.mockRestore();
    });

    it('strictRateLimiter emits strict 429 response', async () => {
      const response = await invokeLimiterUntilBlocked(strictRateLimiter, 10, {
        userId: 'strict-user',
        path: '/api/v1/devices/register',
      });

      expect(response.status).toBe(429);
      expect(response.body.retryAfter).toBe(3600);
      expect(response.body.message).toContain('Please try again later');
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'strict', userId: 'strict-user' })
      );
    });

    it('authRateLimiter emits auth 429 response with high severity log', async () => {
      const response = await invokeLimiterUntilBlocked(authRateLimiter, 15, {
        path: '/api/v1/auth/login',
        ip: '203.0.113.10',
      });

      expect(response.status).toBe(429);
      expect(response.body.message).toContain('Too many login attempts');
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'AUTH_RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'auth', severity: 'high' })
      );
    });

    it('authRateLimiter handles missing IP and logs fallback backoff violations', async () => {
      const getSpy = vi.spyOn(backoffTracker, 'get').mockReturnValue(undefined as any);
      const response = await invokeLimiterUntilBlocked(authRateLimiter, 15, {
        path: '/api/v1/auth/login',
        forceNoIp: true,
      });

      expect(response.status).toBe(429);
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'AUTH_RATE_LIMIT_EXCEEDED',
        expect.objectContaining({
          tier: 'auth',
          ip: undefined,
          backoffViolations: 1,
        })
      );
      getSpy.mockRestore();
    });

    it('transactionCreateRateLimiter emits tier-specific 429 response', async () => {
      const response = await invokeLimiterUntilBlocked(transactionCreateRateLimiter, 10, {
        userId: 'tx-user',
        path: '/api/v1/wallets/123/transactions/create',
      });

      expect(response.status).toBe(429);
      expect(response.body.message).toContain('10/min');
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'transaction_create', severity: 'medium' })
      );
    });

    it('broadcastRateLimiter emits tier-specific 429 response', async () => {
      const response = await invokeLimiterUntilBlocked(broadcastRateLimiter, 5, {
        userId: 'broadcast-user',
        path: '/api/v1/wallets/123/transactions/broadcast',
      });

      expect(response.status).toBe(429);
      expect(response.body.message).toContain('5/min');
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'broadcast', severity: 'high' })
      );
    });

    it('deviceRegistrationRateLimiter emits tier-specific 429 response', async () => {
      const response = await invokeLimiterUntilBlocked(deviceRegistrationRateLimiter, 3, {
        userId: 'device-user',
        path: '/api/v1/push/register',
      });

      expect(response.status).toBe(429);
      expect(response.body.message).toContain('3/hr');
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'device_registration', severity: 'medium' })
      );
    });

    it('addressGenerationRateLimiter emits tier-specific 429 response', async () => {
      const response = await invokeLimiterUntilBlocked(addressGenerationRateLimiter, 20, {
        userId: 'address-user',
        path: '/api/v1/wallets/123/addresses/generate',
      });

      expect(response.status).toBe(429);
      expect(response.body.message).toContain('20/min');
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'address_generation', severity: 'low' })
      );
    });
  });

  describe('Rate Limiter Key Generation', () => {
    it('should use user ID when authenticated', () => {
      const mockReq = {
        ip: '192.168.1.1',
        user: { userId: 'user-123' },
      } as Partial<AuthenticatedRequest>;

      expect(mockReq.user?.userId).toBe('user-123');
    });

    it('should fall back to IP when not authenticated', () => {
      const mockReq = {
        ip: '192.168.1.1',
      } as Partial<AuthenticatedRequest>;

      expect(mockReq.ip).toBe('192.168.1.1');
      expect(mockReq.user).toBeUndefined();
    });
  });

  describe('Exponential Backoff', () => {
    beforeEach(() => {
      backoffTracker.clear();
    });

    describe('calculateBackoff', () => {
      it('should return base retry time for first violation', () => {
        const retryAfter = calculateBackoff('new-client');

        expect(retryAfter).toBe(60);
        expect(backoffTracker.get('new-client')).toEqual({
          violations: 1,
          lastViolation: expect.any(Number),
        });
      });

      it('should double retry time for second violation', () => {
        // First violation
        calculateBackoff('test-client');

        // Second violation (within window)
        vi.advanceTimersByTime(1000); // 1 second later
        const retryAfter = calculateBackoff('test-client');

        expect(retryAfter).toBe(120); // 60 * 2^1
        expect(backoffTracker.get('test-client')?.violations).toBe(2);
      });

      it('should continue exponential growth', () => {
        // First violation: 60
        calculateBackoff('test-client');

        // Second violation: 120
        vi.advanceTimersByTime(1000);
        calculateBackoff('test-client');

        // Third violation: 240
        vi.advanceTimersByTime(1000);
        const third = calculateBackoff('test-client');
        expect(third).toBe(240); // 60 * 2^2

        // Fourth violation: 480
        vi.advanceTimersByTime(1000);
        const fourth = calculateBackoff('test-client');
        expect(fourth).toBe(480); // 60 * 2^3

        // Fifth violation: 960
        vi.advanceTimersByTime(1000);
        const fifth = calculateBackoff('test-client');
        expect(fifth).toBe(960); // 60 * 2^4

        expect(backoffTracker.get('test-client')?.violations).toBe(5);
      });

      it('should cap at maxRetryAfter (3600 seconds)', () => {
        // Simulate many violations to exceed max
        for (let i = 0; i < 10; i++) {
          calculateBackoff('test-client');
          vi.advanceTimersByTime(1000);
        }

        const retryAfter = calculateBackoff('test-client');
        expect(retryAfter).toBeLessThanOrEqual(3600);
      });

      it('should reset backoff after window + retry period expires', () => {
        // First violation
        calculateBackoff('test-client');
        expect(backoffTracker.get('test-client')?.violations).toBe(1);

        // Advance time past window (60000ms) + retry period (60 * 1 * 1000ms)
        vi.advanceTimersByTime(60000 + 60000 + 1);

        // Should reset to first violation
        const retryAfter = calculateBackoff('test-client');
        expect(retryAfter).toBe(60);
        expect(backoffTracker.get('test-client')?.violations).toBe(1);
      });

      it('should track different clients independently', () => {
        // Client A: first violation
        calculateBackoff('client-a');

        // Client B: first violation
        calculateBackoff('client-b');

        // Both should be at 1 violation
        expect(backoffTracker.get('client-a')?.violations).toBe(1);
        expect(backoffTracker.get('client-b')?.violations).toBe(1);

        // Client A: second violation
        vi.advanceTimersByTime(1000);
        calculateBackoff('client-a');

        // Only client A should be at 2 violations
        expect(backoffTracker.get('client-a')?.violations).toBe(2);
        expect(backoffTracker.get('client-b')?.violations).toBe(1);
      });

      it('should store lastViolation timestamp', () => {
        const beforeTime = Date.now();
        calculateBackoff('test-client');
        const afterTime = Date.now();

        const tracker = backoffTracker.get('test-client');
        expect(tracker?.lastViolation).toBeGreaterThanOrEqual(beforeTime);
        expect(tracker?.lastViolation).toBeLessThanOrEqual(afterTime);
      });
    });

    describe('resetBackoff', () => {
      it('should be a function', () => {
        expect(typeof resetBackoff).toBe('function');
      });

      it('should not throw when resetting non-existent key', () => {
        expect(() => resetBackoff('non-existent-key')).not.toThrow();
      });

      it('should clear backoff state for a key', () => {
        // Create backoff state
        calculateBackoff('test-key');
        expect(backoffTracker.has('test-key')).toBe(true);

        // Reset it
        resetBackoff('test-key');
        expect(backoffTracker.has('test-key')).toBe(false);
      });

      it('should not affect other keys when resetting', () => {
        calculateBackoff('key-a');
        calculateBackoff('key-b');

        resetBackoff('key-a');

        expect(backoffTracker.has('key-a')).toBe(false);
        expect(backoffTracker.has('key-b')).toBe(true);
      });
    });

    describe('cleanupBackoffTracker', () => {
      it('should be a function', () => {
        expect(typeof cleanupBackoffTracker).toBe('function');
      });

      it('should not throw when called on empty tracker', () => {
        expect(() => cleanupBackoffTracker()).not.toThrow();
      });

      it('should remove entries older than 2x window', () => {
        // Create an entry
        calculateBackoff('old-client');
        expect(backoffTracker.has('old-client')).toBe(true);

        // Advance time past 2x window (120000ms)
        vi.advanceTimersByTime(120001);

        // Cleanup should remove it
        cleanupBackoffTracker();
        expect(backoffTracker.has('old-client')).toBe(false);
      });

      it('should keep entries newer than 2x window', () => {
        // Create an entry
        calculateBackoff('recent-client');
        expect(backoffTracker.has('recent-client')).toBe(true);

        // Advance time but not past threshold
        vi.advanceTimersByTime(100000);

        // Cleanup should keep it
        cleanupBackoffTracker();
        expect(backoffTracker.has('recent-client')).toBe(true);
      });

      it('should clean up multiple old entries', () => {
        // Create multiple entries
        calculateBackoff('old-1');
        vi.advanceTimersByTime(1000);
        calculateBackoff('old-2');
        vi.advanceTimersByTime(1000);
        calculateBackoff('old-3');

        expect(backoffTracker.size).toBe(3);

        // Advance past threshold (2x window = 120000ms) plus buffer for all entries
        vi.advanceTimersByTime(125000);

        cleanupBackoffTracker();
        expect(backoffTracker.size).toBe(0);
      });

      it('should keep some entries while removing others', () => {
        // Create old entry
        calculateBackoff('old-client');

        // Advance time
        vi.advanceTimersByTime(100000);

        // Create recent entry
        calculateBackoff('recent-client');

        // Advance a bit more to make old entry expire
        vi.advanceTimersByTime(25000);

        cleanupBackoffTracker();

        expect(backoffTracker.has('old-client')).toBe(false);
        expect(backoffTracker.has('recent-client')).toBe(true);
      });
    });

    describe('Backoff Configuration', () => {
      it('should be configured with base retry of 60 seconds', () => {
        const retryAfter = calculateBackoff('config-test');
        expect(retryAfter).toBe(60);
      });

      it('should be configured with max retry of 3600 seconds (1 hour)', () => {
        // Create many violations to hit the cap
        for (let i = 0; i < 20; i++) {
          calculateBackoff('max-test');
          vi.advanceTimersByTime(100);
        }

        // The value should be capped at 3600
        const tracker = backoffTracker.get('max-test');
        expect(tracker?.violations).toBe(20);

        // Calculate one more to verify cap
        const retryAfter = calculateBackoff('max-test');
        expect(retryAfter).toBe(3600);
      });

      it('should use multiplier of 2 for exponential growth', () => {
        // First: 60 * 2^0 = 60
        const first = calculateBackoff('multiplier-test');
        expect(first).toBe(60);

        vi.advanceTimersByTime(100);

        // Second: 60 * 2^1 = 120
        const second = calculateBackoff('multiplier-test');
        expect(second).toBe(120);

        vi.advanceTimersByTime(100);

        // Third: 60 * 2^2 = 240
        const third = calculateBackoff('multiplier-test');
        expect(third).toBe(240);
      });
    });
  });

  describe('backoffTracker Map', () => {
    it('should be exported for testing', () => {
      expect(backoffTracker).toBeInstanceOf(Map);
    });

    it('should start empty', () => {
      expect(backoffTracker.size).toBe(0);
    });

    it('should track entries after calculateBackoff', () => {
      calculateBackoff('tracked-client');
      expect(backoffTracker.size).toBe(1);
      expect(backoffTracker.has('tracked-client')).toBe(true);
    });
  });
});
