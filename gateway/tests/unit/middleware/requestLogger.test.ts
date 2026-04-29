/**
 * Request Logger Middleware Tests
 *
 * Tests the request logging middleware for auditing and security events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

// Hoist mock logger so it's available during vi.mock
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

// Mock config
vi.mock('../../../src/config', () => ({
  config: {
    backendUrl: 'http://localhost:3000',
    backendRequestTimeoutMs: 5000,
    gatewaySecret: 'test-gateway-secret-32-characters',
  },
}));

// Mock shared request utilities
vi.mock('../../../shared/utils/request', () => ({
  generateRequestId: vi.fn(() => 'test-request-id-123'),
  extractClientIp: vi.fn((forwarded, fallback) => forwarded?.split(',')[0]?.trim() || fallback || 'unknown'),
  sanitizePath: vi.fn((path) => path.replace(/\/[a-f0-9-]{36}/g, '/:id')),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  requestLogger,
  logSecurityEvent,
  logAuditEvent,
} from '../../../src/middleware/requestLogger';

describe('requestLogger middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response> & EventEmitter;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });

    req = {
      method: 'GET',
      path: '/api/v1/wallets',
      headers: {
        'user-agent': 'TestClient/1.0',
      },
      ip: '192.168.1.1',
      socket: {
        remoteAddress: '192.168.1.1',
      } as any,
    };

    res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: vi.fn(),
    });

    next = vi.fn();
  });

  describe('request ID handling', () => {
    it('should generate and attach request ID to request', () => {
      requestLogger(req as Request, res as Response, next);

      expect((req as any).requestId).toBeDefined();
      expect(typeof (req as any).requestId).toBe('string');
    });

    it('should add request ID to response headers', () => {
      requestLogger(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    });

    it('should call next to continue middleware chain', () => {
      requestLogger(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('request logging', () => {
    it('should log incoming request at debug level for normal endpoints', () => {
      req.path = '/api/v1/wallets';

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          requestId: expect.any(String),
          method: 'GET',
          path: '/api/v1/wallets',
          ip: '192.168.1.1',
          userAgent: 'TestClient/1.0',
        })
      );
    });

    it('should log incoming request at info level for sensitive endpoints', () => {
      req.path = '/api/v1/auth/login';

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          path: '/api/v1/auth/login',
        })
      );
    });

    it('should include device ID when present', () => {
      req.headers = {
        ...req.headers,
        'x-device-id': 'device-abc-123',
      };

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          deviceId: 'device-abc-123',
        })
      );
    });

    it('should truncate long user agent strings', () => {
      req.headers = {
        ...req.headers,
        'user-agent': 'A'.repeat(300),
      };

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          userAgent: expect.stringMatching(/^A{200}$/),
        })
      );
    });

    it('should use "unknown" for missing user agent', () => {
      req.headers = {};

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          userAgent: 'unknown',
        })
      );
    });
  });

  describe('response logging', () => {
    it('should log successful response at debug level', () => {
      requestLogger(req as Request, res as Response, next);

      res.statusCode = 200;
      res.emit('finish');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          status: 200,
        })
      );
    });

    it('should log 4xx responses at warn level', () => {
      requestLogger(req as Request, res as Response, next);

      res.statusCode = 401;
      res.emit('finish');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Request error',
        expect.objectContaining({
          status: 401,
        })
      );
    });

    it('should log 5xx responses at error level', () => {
      requestLogger(req as Request, res as Response, next);

      res.statusCode = 500;
      res.emit('finish');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Request failed',
        expect.objectContaining({
          status: 500,
        })
      );
    });

    it('should log sensitive endpoint responses at info level', () => {
      req.path = '/api/v1/auth/login';

      requestLogger(req as Request, res as Response, next);

      res.statusCode = 200;
      res.emit('finish');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          path: '/api/v1/auth/login',
        })
      );
    });

    it('should include user ID when authenticated', () => {
      (req as any).user = { userId: 'user-123' };

      requestLogger(req as Request, res as Response, next);

      res.emit('finish');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });

    it('should include duration in response log', () => {
      vi.useFakeTimers();

      requestLogger(req as Request, res as Response, next);

      vi.advanceTimersByTime(150);

      res.emit('finish');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          duration: '150ms',
        })
      );

      vi.useRealTimers();
    });
  });

  describe('client IP extraction', () => {
    it('should use X-Forwarded-For header when present', () => {
      req.headers = {
        ...req.headers,
        'x-forwarded-for': '10.0.0.1, 192.168.1.1',
      };

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          ip: '10.0.0.1',
        })
      );
    });

    it('should fall back to req.ip when no forwarded header', () => {
      req.headers = {};

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          ip: '192.168.1.1',
        })
      );
    });

    it('should fall back to req.socket.remoteAddress when req.ip is undefined', () => {
      req.headers = {};
      req.ip = undefined;
      (req as any).socket = { remoteAddress: '10.0.0.5' };

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          ip: '10.0.0.5',
        })
      );
    });
  });

  describe('sensitive endpoint detection', () => {
    it('should detect auth endpoints as sensitive', () => {
      req.path = '/api/v1/auth/register';

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.any(Object)
      );
    });

    it('should detect push endpoints as sensitive', () => {
      req.path = '/api/v1/push/device';

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.any(Object)
      );
    });

    it('should detect sync endpoints as sensitive', () => {
      req.path = '/api/v1/sync/wallet/123';

      requestLogger(req as Request, res as Response, next);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Incoming request',
        expect.any(Object)
      );
    });
  });
});

describe('logSecurityEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('should log security event locally at warn level', () => {
    logSecurityEvent('FAILED_LOGIN', {
      ip: '192.168.1.1',
      userId: 'user-123',
    });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'SECURITY: FAILED_LOGIN',
      expect.objectContaining({
        ip: '192.168.1.1',
        userId: 'user-123',
        timestamp: expect.any(String),
      })
    );
  });

  it('should send security event to backend audit endpoint', async () => {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      ip: '10.0.0.1',
      path: '/api/v1/auth/login',
    });

    // Allow async operation
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/push/gateway-audit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Gateway-Signature': expect.stringMatching(/^[a-f0-9]{64}$/),
          'X-Gateway-Timestamp': expect.stringMatching(/^\d+$/),
        }),
        body: expect.stringContaining('RATE_LIMIT_EXCEEDED'),
      })
    );

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.outcome).toBe('failure');
  });

  it('should handle backend audit failure gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    logSecurityEvent('TEST_EVENT', { ip: '127.0.0.1' });

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Should log warning about failed audit
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('SECURITY: TEST_EVENT'),
      expect.any(Object)
    );
  });

  it('should handle non-ok response from backend', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    logSecurityEvent('TEST_EVENT', { ip: '127.0.0.1' });

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Should log warning about failed audit
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to send audit event'),
      expect.any(Object)
    );
  });

  it('should include severity in audit event', async () => {
    logSecurityEvent('CRITICAL_EVENT', {
      ip: '192.168.1.1',
      severity: 'critical',
    });

    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.severity).toBe('critical');
  });
});

describe('logAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log audit event at info level', () => {
    logAuditEvent('USER_LOGIN', {
      userId: 'user-123',
      username: 'testuser',
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      'AUDIT: USER_LOGIN',
      expect.objectContaining({
        userId: 'user-123',
        username: 'testuser',
        timestamp: expect.any(String),
      })
    );
  });

  it('should include timestamp in audit event', () => {
    logAuditEvent('DEVICE_REGISTERED', { deviceId: 'device-123' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      })
    );
  });
});
