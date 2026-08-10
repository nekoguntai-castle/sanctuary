import { vi, Mock } from 'vitest';
/**
 * Rate Limit Middleware Tests
 *
 * Tests for rate limiting middleware behavior, especially fail-closed on errors.
 */

// Unmock the rate limit middleware to test the real implementation
// (global setup.ts mocks it to bypass Redis in other tests)
vi.unmock('../../../src/middleware/rateLimit');

import { Request, Response, NextFunction } from 'express';
import {
  rateLimit,
  rateLimitByUser,
  rateLimitByIpAndKey,
  rateLimitByKey,
  skipRateLimitIf,
  combineRateLimits,
} from '../../../src/middleware/rateLimit';
import { rateLimitService } from '../../../src/services/rateLimiting';

// Mock the rate limit service
vi.mock('../../../src/services/rateLimiting', () => ({
  rateLimitService: {
    consume: vi.fn(),
    getPolicy: vi.fn().mockReturnValue({ message: 'Rate limit exceeded' }),
  },
}));

// Mock logger to avoid console output during tests
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Rate Limit Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: Mock;
  let setHeaderMock: Mock;
  let statusMock: Mock;
  let sendMock: Mock;
  let typeMock: Mock;

  beforeEach(() => {
    jsonMock = vi.fn();
    sendMock = vi.fn();
    typeMock = vi.fn();
    const statusReturn = {
      json: jsonMock,
      type: typeMock,
      send: sendMock,
    };
    typeMock.mockReturnValue(statusReturn);
    setHeaderMock = vi.fn();
    statusMock = vi.fn().mockReturnValue(statusReturn);

    mockReq = {
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as any,
      body: {},
    };

    mockRes = {
      setHeader: setHeaderMock,
      status: statusMock,
      json: jsonMock,
      headersSent: false,
    };

    mockNext = vi.fn();

    vi.clearAllMocks();
  });

  describe('rateLimit (by IP)', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should block request when rate limit is exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(429);
    });

    it('should return 503 when rate limit service throws error (fail-closed)', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    });

    it('should ignore raw x-forwarded-for and use Express trusted req.ip', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });
      mockReq.headers = { 'x-forwarded-for': '203.0.113.1, 198.51.100.2' };
      mockReq = { ...mockReq, ip: '198.51.100.2' };

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'ip:198.51.100.2');
    });

    it('should ignore array x-forwarded-for spoofing', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });
      mockReq.headers = { 'x-forwarded-for': [' 198.51.100.10 ', '203.0.113.9'] as any };
      mockReq = { ...mockReq, ip: '203.0.113.9' };

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'ip:203.0.113.9');
    });

    it('falls back to socket remoteAddress when req.ip is unavailable', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });
      mockReq = { ...mockReq, ip: undefined };
      mockReq.socket = { remoteAddress: '10.0.0.15' } as any;

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'ip:10.0.0.15');
    });

    it('falls back to unknown when no client IP can be determined', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });
      mockReq = { ...mockReq, ip: undefined };
      mockReq.socket = {} as any;

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'ip:unknown');
    });

    it('uses default JSON message when no policy or option message is configured', async () => {
      (rateLimitService.getPolicy as Mock).mockReturnValueOnce(undefined);
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(429);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
          message: expect.stringContaining("You've exceeded the rate limit (10 requests)"),
        }),
      });
    });
  });

  describe('rateLimitByUser', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      (mockReq as any).user = { userId: 'user-123' };

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'user:user-123');
    });

    it('should fall back to IP when no user ID', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'ip:127.0.0.1');
    });

    it('should return 503 when rate limit service throws error (fail-closed) - with user', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));
      (mockReq as any).user = { userId: 'user-123' };

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    });

    it('should return 503 when rate limit service throws error (fail-closed) - IP fallback', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
    });

    it('should block IP fallback request when rate limit is exceeded without user', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(429);
    });

    it('should block user request when user rate limit is exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });
      (mockReq as any).user = { userId: 'user-123' };

      const middleware = rateLimitByUser('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(429);
    });
  });

  describe('rateLimitByIpAndKey', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      mockReq.body = { username: 'testuser' };

      const middleware = rateLimitByIpAndKey('test-policy', (req) => req.body?.username);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', '127.0.0.1:testuser');
    });

    it('should return 503 when rate limit service throws error (fail-closed)', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimitByIpAndKey('test-policy', (req) => req.body?.username);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
    });

    it('should use unknown key when extractor returns undefined and block when exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });

      const middleware = rateLimitByIpAndKey('test-policy', () => undefined);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', '127.0.0.1:unknown');
      expect(statusMock).toHaveBeenCalledWith(429);
    });
  });

  describe('rateLimitByKey', () => {
    it('should allow request when rate limit is not exceeded', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimitByKey('test-policy', () => 'custom-key');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(rateLimitService.consume).toHaveBeenCalledWith('test-policy', 'custom-key');
    });

    it('should return 503 when rate limit service throws error (fail-closed)', async () => {
      (rateLimitService.consume as Mock).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = rateLimitByKey('test-policy', () => 'custom-key');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    });

    it('should return text response when configured and blocked', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 2,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });

      const middleware = rateLimitByKey(
        'test-policy',
        () => 'custom-key',
        {
          responseType: 'text',
          contentType: 'text/html',
          message: 'Too many custom requests',
        }
      );
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(429);
      expect(typeMock).toHaveBeenCalledWith('text/html');
      expect(sendMock).toHaveBeenCalledWith('Too many custom requests');
    });

    it('should return default text response when no message/content type provided', async () => {
      (rateLimitService.getPolicy as Mock).mockReturnValueOnce(undefined);
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 2,
        remaining: 0,
        resetAt: Date.now() + 60000,
      });

      const middleware = rateLimitByKey(
        'test-policy',
        () => 'custom-key',
        {
          responseType: 'text',
        }
      );
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(429);
      expect(typeMock).toHaveBeenCalledWith('text/plain');
      expect(sendMock).toHaveBeenCalledWith(expect.stringContaining("You've exceeded the rate limit"));
    });
  });

  describe('Rate limit headers', () => {
    it('should set rate limit headers on successful request', async () => {
      const resetAt = Date.now() + 60000;
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
      expect(setHeaderMock).toHaveBeenCalledWith('X-RateLimit-Reset', Math.ceil(resetAt / 1000));
    });

    it('should set Retry-After header when rate limited', async () => {
      (rateLimitService.consume as Mock).mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
      });

      const middleware = rateLimit('test-policy');
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Retry-After', 60);
    });
  });

  describe('skipRateLimitIf', () => {
    it('skips wrapped middleware when condition matches', async () => {
      const wrapped = vi.fn();
      const middleware = skipRateLimitIf(() => true, wrapped as any);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(wrapped).not.toHaveBeenCalled();
    });

    it('invokes wrapped middleware when condition does not match', async () => {
      const wrapped = vi.fn((_req, _res, next) => next());
      const middleware = skipRateLimitIf(() => false, wrapped as any);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(wrapped).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('combineRateLimits', () => {
    it('runs all middlewares and calls next when none block', async () => {
      const first = vi.fn((_req, _res, next) => next());
      const second = vi.fn((_req, _res, next) => next());
      const middleware = combineRateLimits(first as any, second as any);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(first).toHaveBeenCalled();
      expect(second).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('stops processing when a middleware sends a response', async () => {
      const first = vi.fn((_req, res, next) => {
        (res as any).headersSent = true;
        next();
      });
      const second = vi.fn((_req, _res, next) => next());
      const middleware = combineRateLimits(first as any, second as any);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(first).toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('passes middleware errors to next', async () => {
      const first = vi.fn((_req, _res, next) => next(new Error('rate limit failure')));
      const second = vi.fn((_req, _res, next) => next());
      const middleware = combineRateLimits(first as any, second as any);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(second).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
