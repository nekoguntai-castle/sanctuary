/**
 * Request Timeout Middleware Tests
 *
 * Tests for request timeout functionality including:
 * - Default timeouts
 * - Extended timeouts for specific routes
 * - Excluded routes (no timeout)
 * - Custom timeout middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: vi.fn(() => 'test-request-id'),
    getDuration: vi.fn(() => 35000),
  },
}));

import { requestTimeout, withTimeout } from '../../../src/middleware/requestTimeout';

describe('Request Timeout Middleware', () => {
  let req: any;
  let res: any;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    req = {
      method: 'GET',
      path: '/api/v1/wallets',
    };

    res = Object.assign(new EventEmitter(), {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    });

    next = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requestTimeout', () => {
    describe('excluded routes', () => {
      it('should not apply timeout to /health endpoint', () => {
        req.path = '/health';

        requestTimeout(req, res, next);

        expect(next).toHaveBeenCalled();
        // Advance past default timeout - should not trigger
        vi.advanceTimersByTime(60000);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should not apply timeout to /api/v1/health endpoint', () => {
        req.path = '/api/v1/health';

        requestTimeout(req, res, next);

        expect(next).toHaveBeenCalled();
        vi.advanceTimersByTime(60000);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should not apply timeout to /ws endpoint', () => {
        req.path = '/ws';

        requestTimeout(req, res, next);

        expect(next).toHaveBeenCalled();
        vi.advanceTimersByTime(60000);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should not apply timeout to /gateway endpoint', () => {
        req.path = '/gateway';

        requestTimeout(req, res, next);

        expect(next).toHaveBeenCalled();
        vi.advanceTimersByTime(60000);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should not apply timeout to /metrics endpoint', () => {
        req.path = '/metrics';

        requestTimeout(req, res, next);

        expect(next).toHaveBeenCalled();
        vi.advanceTimersByTime(60000);
        expect(res.status).not.toHaveBeenCalled();
      });
    });

    describe('default timeout', () => {
      it('should apply 30s default timeout to normal routes', () => {
        req.path = '/api/v1/wallets';

        requestTimeout(req, res, next);

        expect(next).toHaveBeenCalled();

        // Should not timeout before 30s
        vi.advanceTimersByTime(29000);
        expect(res.status).not.toHaveBeenCalled();

        // Should timeout at 30s
        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Request Timeout',
          message: 'The request took too long to process',
          timeout: '30000ms',
        });
      });

      it('should log error when timeout occurs', () => {
        req.path = '/api/v1/wallets';

        requestTimeout(req, res, next);
        vi.advanceTimersByTime(31000);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Request timeout',
          expect.objectContaining({
            requestId: 'test-request-id',
            method: 'GET',
            path: '/api/v1/wallets',
            timeout: '30000ms',
          })
        );
      });

      it('should not send response if headers already sent', () => {
        req.path = '/api/v1/wallets';
        res.headersSent = true;

        requestTimeout(req, res, next);
        vi.advanceTimersByTime(31000);

        expect(res.status).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should clear timeout when response finishes', () => {
        req.path = '/api/v1/wallets';

        requestTimeout(req, res, next);

        // Simulate response finishing before timeout
        res.emit('finish');

        // Advance past timeout - should not trigger
        vi.advanceTimersByTime(35000);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should clear timeout when connection closes', () => {
        req.path = '/api/v1/wallets';

        requestTimeout(req, res, next);

        // Simulate connection close
        res.emit('close');

        // Advance past timeout - should not trigger
        vi.advanceTimersByTime(35000);
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should not call next when timeout callback fires before wrapped next executes', () => {
        req.path = '/api/v1/wallets';
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: (...args: any[]) => void) => {
          cb();
          return 1 as any;
        }) as any);

        requestTimeout(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(408);
        setTimeoutSpy.mockRestore();
      });
    });

    describe('extended timeout routes', () => {
      it('should apply 120s timeout to backup routes', () => {
        req.path = '/api/v1/admin/backup/create';

        requestTimeout(req, res, next);

        // Should not timeout at 30s
        vi.advanceTimersByTime(30000);
        expect(res.status).not.toHaveBeenCalled();

        // Should not timeout at 90s
        vi.advanceTimersByTime(60000);
        expect(res.status).not.toHaveBeenCalled();

        // Should timeout at 120s
        vi.advanceTimersByTime(31000);
        expect(res.status).toHaveBeenCalledWith(408);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            timeout: '120000ms',
          })
        );
      });

      it('should apply 120s timeout to restore routes', () => {
        req.path = '/api/v1/admin/restore/upload';

        requestTimeout(req, res, next);

        vi.advanceTimersByTime(119000);
        expect(res.status).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
      });

      it('should apply 90s timeout to full sync routes', () => {
        req.path = '/api/v1/sync/wallet-123/full';

        requestTimeout(req, res, next);

        vi.advanceTimersByTime(89000);
        expect(res.status).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
      });

      it('should apply 60s timeout to transaction broadcast', () => {
        req.path = '/api/v1/wallets/wallet-123/transactions/broadcast';

        requestTimeout(req, res, next);

        vi.advanceTimersByTime(59000);
        expect(res.status).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
      });

      it('should apply 60s timeout to AI routes', () => {
        req.path = '/api/v1/ai/analyze';

        requestTimeout(req, res, next);

        vi.advanceTimersByTime(59000);
        expect(res.status).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
      });

      it('should apply 60s timeout to internal AI routes', () => {
        req.path = '/internal/ai/data';

        requestTimeout(req, res, next);

        vi.advanceTimersByTime(59000);
        expect(res.status).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
      });

      it('should apply 280s timeout to Console turn routes', () => {
        req.path = '/api/v1/console/turns';

        requestTimeout(req, res, next);

        vi.advanceTimersByTime(279000);
        expect(res.status).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            timeout: '280000ms',
          })
        );
      });

      it('should apply 280s timeout to Console replay routes', () => {
        req.path = '/api/v1/console/prompts/prompt-1/replay';

        requestTimeout(req, res, next);

        vi.advanceTimersByTime(279000);
        expect(res.status).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);
        expect(res.status).toHaveBeenCalledWith(408);
      });

      it('should log reason for extended timeout routes', () => {
        req.path = '/api/v1/admin/backup/create';

        requestTimeout(req, res, next);
        vi.advanceTimersByTime(121000);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Request timeout',
          expect.objectContaining({
            reason: 'backup/restore',
          })
        );
      });
    });
  });

  describe('withTimeout', () => {
    it('should create middleware with custom timeout', () => {
      const customTimeoutMiddleware = withTimeout(5000);

      customTimeoutMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();

      // Should not timeout before 5s
      vi.advanceTimersByTime(4000);
      expect(res.status).not.toHaveBeenCalled();

      // Should timeout at 5s
      vi.advanceTimersByTime(2000);
      expect(res.status).toHaveBeenCalledWith(408);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Request Timeout',
        message: 'The request took too long to process',
        timeout: '5000ms',
      });
    });

    it('should log custom route timeout', () => {
      const customTimeoutMiddleware = withTimeout(5000);

      customTimeoutMiddleware(req, res, next);
      vi.advanceTimersByTime(6000);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Custom route timeout',
        expect.objectContaining({
          requestId: 'test-request-id',
          timeout: '5000ms',
        })
      );
    });

    it('should clear timeout when response finishes', () => {
      const customTimeoutMiddleware = withTimeout(5000);

      customTimeoutMiddleware(req, res, next);
      res.emit('finish');

      vi.advanceTimersByTime(10000);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should clear timeout when connection closes', () => {
      const customTimeoutMiddleware = withTimeout(5000);

      customTimeoutMiddleware(req, res, next);
      res.emit('close');

      vi.advanceTimersByTime(10000);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should not send response if headers already sent', () => {
      const customTimeoutMiddleware = withTimeout(5000);
      res.headersSent = true;

      customTimeoutMiddleware(req, res, next);
      vi.advanceTimersByTime(6000);

      expect(res.status).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not call next when custom timeout callback has already fired', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: (...args: any[]) => void) => {
        cb();
        return 1 as any;
      }) as any);

      const customTimeoutMiddleware = withTimeout(10);
      customTimeoutMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(408);
      setTimeoutSpy.mockRestore();
    });
  });
});
