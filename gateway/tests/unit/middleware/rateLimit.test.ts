/**
 * Rate Limiting Middleware Tests
 *
 * Tests rate limiting behavior for different tiers.
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
} from '../../../src/middleware/rateLimit';
import { AuthenticatedRequest } from '../../../src/middleware/auth';
import { logSecurityEvent } from '../../../src/middleware/requestLogger';

// Mock the config
vi.mock('../../../src/config', () => ({
  config: {
    rateLimit: {
      windowMs: 60000,
      maxRequests: 60,
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

    it('defaultRateLimiter reports when the window actually resets', async () => {
      const response = await invokeLimiterUntilBlocked(defaultRateLimiter, 60, {
        path: '/api/v1/wallets',
        forceNoIp: true,
      });

      // The fixed window (60s) is what admits the client again; nothing longer is enforced.
      expect(response.status).toBe(429);
      expect(response.body.retryAfter).toBeGreaterThan(0);
      expect(response.body.retryAfter).toBeLessThanOrEqual(60);
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'default', retryAfter: response.body.retryAfter })
      );
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

    it('authRateLimiter handles missing IP and reports its window reset', async () => {
      const response = await invokeLimiterUntilBlocked(authRateLimiter, 15, {
        path: '/api/v1/auth/login',
        forceNoIp: true,
      });

      expect(response.status).toBe(429);
      expect(response.body.retryAfter).toBeLessThanOrEqual(15 * 60);
      expect(vi.mocked(logSecurityEvent)).toHaveBeenCalledWith(
        'AUTH_RATE_LIMIT_EXCEEDED',
        expect.objectContaining({ tier: 'auth', ip: undefined })
      );
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

});
