/**
 * Request Logger Middleware Tests
 *
 * Tests for request logging and correlation ID functionality including:
 * - Request ID generation and propagation
 * - Request/response logging
 * - Excluded and sensitive path handling
 * - Duration tracking
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';

type TestNextFunction = (error?: unknown) => void;

// Mock logger
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

// Mock request context
const mockContext = vi.hoisted(() => ({
  requestId: 'generated-request-id',
  userId: undefined as string | undefined,
  username: undefined as string | undefined,
}));

const mockRequestContext = vi.hoisted(() => ({
  generateRequestId: vi.fn(() => 'generated-request-id'),
  run: vi.fn((context: any, callback: () => void) => callback()),
  get: vi.fn(() => mockContext),
  getDuration: vi.fn(() => 150),
  getRequestId: vi.fn(() => mockContext.requestId),
}));

vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: mockRequestContext,
}));

// Mock redact utility
const mockRedactObject = vi.hoisted(() => vi.fn((obj) => ({ ...obj, password: '[REDACTED]' })));
vi.mock('../../../src/utils/redact', () => ({
  redactObject: mockRedactObject,
}));

import { requestLogger, getRequestId } from '../../../src/middleware/requestLogger';

describe('Request Logger Middleware', () => {
  let req: any;
  let res: any;
  let next: Mock<TestNextFunction>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'GET',
      path: '/api/v1/wallets',
      headers: {
        'user-agent': 'TestClient/1.0',
      },
      socket: {
        remoteAddress: '192.168.1.1',
      },
      body: {},
    };

    res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: vi.fn(),
    });

    next = vi.fn<TestNextFunction>();
  });

  describe('request ID handling', () => {
    it('should generate request ID when not provided', () => {
      requestLogger(req, res, next);

      expect(mockRequestContext.generateRequestId).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'generated-request-id');
    });

    it('should use existing X-Request-Id header', () => {
      req.headers['x-request-id'] = 'existing-request-id';

      requestLogger(req, res, next);

      expect(mockRequestContext.generateRequestId).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'existing-request-id');
    });

    it('should use X-Correlation-Id header as fallback', () => {
      req.headers['x-correlation-id'] = 'correlation-id';

      requestLogger(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'correlation-id');
    });

    it('should prefer X-Request-Id over X-Correlation-Id', () => {
      req.headers['x-request-id'] = 'request-id';
      req.headers['x-correlation-id'] = 'correlation-id';

      requestLogger(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'request-id');
    });

    it('should call next to continue middleware chain', () => {
      requestLogger(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('request logging', () => {
    it('should log incoming request with details', () => {
      requestLogger(req, res, next);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'GET /api/v1/wallets',
        expect.objectContaining({
          requestId: 'generated-request-id',
          ip: '192.168.1.1',
          userAgent: 'TestClient/1.0',
        })
      );
    });

    it('should use X-Forwarded-For header for IP', () => {
      req.headers['x-forwarded-for'] = '10.0.0.1';

      requestLogger(req, res, next);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          ip: '10.0.0.1',
        })
      );
    });

    it('should truncate long user agent strings', () => {
      req.headers['user-agent'] = 'A'.repeat(100);

      requestLogger(req, res, next);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userAgent: 'A'.repeat(50),
        })
      );
    });
  });

  describe('excluded paths', () => {
    it('should not log /health requests', () => {
      req.path = '/health';

      requestLogger(req, res, next);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should not log /api/v1/health requests', () => {
      req.path = '/api/v1/health';

      requestLogger(req, res, next);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should not log /favicon.ico requests', () => {
      req.path = '/favicon.ico';

      requestLogger(req, res, next);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should not log response for excluded paths', () => {
      req.path = '/health';

      requestLogger(req, res, next);
      res.emit('finish');

      expect(mockLogger.info).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('response logging', () => {
    it('should log successful response at info level', () => {
      res.statusCode = 200;

      requestLogger(req, res, next);
      res.emit('finish');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'GET /api/v1/wallets completed',
        expect.objectContaining({
          requestId: 'generated-request-id',
          status: 200,
          duration: '150ms',
        })
      );
    });

    it('should log 4xx responses at warn level', () => {
      res.statusCode = 401;

      requestLogger(req, res, next);
      res.emit('finish');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'GET /api/v1/wallets completed',
        expect.objectContaining({
          status: 401,
        })
      );
    });

    it('should log 5xx responses at error level', () => {
      res.statusCode = 500;

      requestLogger(req, res, next);
      res.emit('finish');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'GET /api/v1/wallets completed',
        expect.objectContaining({
          status: 500,
        })
      );
    });

    it('should include userId when authenticated', () => {
      mockContext.userId = 'user-123';

      requestLogger(req, res, next);
      res.emit('finish');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userId: 'user-123',
        })
      );

      // Reset
      mockContext.userId = undefined;
    });
  });

  describe('getRequestId', () => {
    it('should return current request ID from context', () => {
      const requestId = getRequestId();

      expect(requestId).toBe('generated-request-id');
      expect(mockRequestContext.getRequestId).toHaveBeenCalled();
    });
  });

  describe('request body logging', () => {
    it('logs redacted body when LOG_REQUEST_BODY is enabled', async () => {
      const original = process.env.LOG_REQUEST_BODY;
      process.env.LOG_REQUEST_BODY = 'true';
      vi.resetModules();

      const { requestLogger: requestLoggerWithBody } = await import('../../../src/middleware/requestLogger');

      req.body = { password: 'secret', note: 'hello' };
      requestLoggerWithBody(req, res, next);

      expect(mockRedactObject).toHaveBeenCalledWith(req.body);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'GET /api/v1/wallets',
        expect.objectContaining({
          body: expect.objectContaining({
            password: '[REDACTED]',
            note: 'hello',
          }),
        })
      );

      if (original === undefined) {
        delete process.env.LOG_REQUEST_BODY;
      } else {
        process.env.LOG_REQUEST_BODY = original;
      }
    });

    it('redacts arbitrary webhook static header values before body logging', async () => {
      const original = process.env.LOG_REQUEST_BODY;
      process.env.LOG_REQUEST_BODY = 'true';
      vi.resetModules();

      const { requestLogger: requestLoggerWithBody } = await import('../../../src/middleware/requestLogger');
      req.body = {
        headerConfig: {
          headers: {
            Authorization: 'Bearer secret',
            'X-API-Key': 'api-key',
            'X-Arbitrary': 'arbitrary-secret',
          },
          hmac: { signatureHeader: 'X-Proof' },
        },
      };

      requestLoggerWithBody(req, res, next);

      expect(mockRedactObject).toHaveBeenCalledWith({
        headerConfig: {
          headers: {
            Authorization: '[REDACTED]',
            'X-API-Key': '[REDACTED]',
            'X-Arbitrary': '[REDACTED]',
          },
          hmac: { signatureHeader: 'X-Proof' },
        },
      });

      if (original === undefined) {
        delete process.env.LOG_REQUEST_BODY;
      } else {
        process.env.LOG_REQUEST_BODY = original;
      }
    });

    it.each([
      '/api/v1/admin/support-package/incident',
      '/api/v1/admin/support-package/incident-capture',
      '/api/v1/admin/support-package/incident-capture/status',
      '/api/v1/hardware/jade/pin',
    ])('never logs selector-bearing diagnostics bodies for %s', async (path) => {
      const original = process.env.LOG_REQUEST_BODY;
      process.env.LOG_REQUEST_BODY = 'true';
      vi.resetModules();

      const { requestLogger: requestLoggerWithBody } = await import('../../../src/middleware/requestLogger');
      req.method = 'POST';
      req.path = path;
      req.body = {
        txid: 'a'.repeat(64),
        senderWalletId: 'sender-wallet-selector',
        receiverWalletId: 'receiver-wallet-selector',
      };

      requestLoggerWithBody(req, res, next);

      expect(mockRedactObject).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();

      if (original === undefined) {
        delete process.env.LOG_REQUEST_BODY;
      } else {
        process.env.LOG_REQUEST_BODY = original;
      }
    });
  });
});
