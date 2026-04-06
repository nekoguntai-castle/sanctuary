/**
 * Metrics Middleware Tests
 *
 * Tests for HTTP metrics collection middleware including:
 * - Request duration recording
 * - Request/response count and size
 * - Path normalization
 * - Excluded paths
 * - Metrics endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist all mocks
const { mockLogger, mockObserve, mockInc, mockGetMetrics, mockGetContentType, mockNormalizePath } = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const mockObserve = vi.fn();
  const mockInc = vi.fn();
  const mockGetMetrics = vi.fn().mockResolvedValue('# HELP test_metric\ntest_metric 1');
  const mockGetContentType = vi.fn().mockReturnValue('text/plain; version=0.0.4');
  const mockNormalizePath = vi.fn((path: string) => {
    // Simple normalization - replace UUIDs and numeric IDs
    return path
      .replace(/[a-f0-9-]{36}/g, ':id')
      .replace(/\/\d+/g, '/:id');
  });

  return { mockLogger, mockObserve, mockInc, mockGetMetrics, mockGetContentType, mockNormalizePath };
});

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../src/observability/metrics', () => ({
  metricsService: {
    getMetrics: mockGetMetrics,
    getContentType: mockGetContentType,
  },
  httpRequestDuration: { observe: mockObserve },
  httpRequestsTotal: { inc: mockInc },
  httpRequestSize: { observe: mockObserve },
  httpResponseSize: { observe: mockObserve },
  normalizePath: mockNormalizePath,
}));

import { metricsMiddleware, metricsHandler, responseTimeMiddleware } from '../../../src/middleware/metrics';

describe('Metrics Middleware', () => {
  let req: any;
  let res: any;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      method: 'GET',
      path: '/api/v1/wallets',
      headers: {},
    };

    res = {
      statusCode: 200,
      setHeader: vi.fn(),
      set: vi.fn(),
      send: vi.fn(),
      end: function (chunk?: any, encoding?: any, callback?: any) {
        if (typeof callback === 'function') callback();
        return this;
      },
    };

    next = vi.fn();
  });

  describe('metricsMiddleware', () => {
    describe('excluded paths', () => {
      it('should skip /health path', () => {
        req.path = '/health';
        const middleware = metricsMiddleware();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(mockObserve).not.toHaveBeenCalled();
      });

      it('should skip /metrics path', () => {
        req.path = '/metrics';
        const middleware = metricsMiddleware();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(mockObserve).not.toHaveBeenCalled();
      });

      it('should skip /favicon.ico path', () => {
        req.path = '/favicon.ico';
        const middleware = metricsMiddleware();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(mockObserve).not.toHaveBeenCalled();
      });

      it('should allow custom excluded paths', () => {
        req.path = '/custom-health';
        const middleware = metricsMiddleware({ excludePaths: ['/custom-health'] });

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(mockObserve).not.toHaveBeenCalled();
      });
    });

    describe('metrics recording', () => {
      it('should record request duration on response end', () => {
        const middleware = metricsMiddleware();

        middleware(req, res, next);
        res.end();

        expect(mockObserve).toHaveBeenCalledWith(
          { method: 'GET', path: '/api/v1/wallets', status: '200' },
          expect.any(Number)
        );
      });

      it('should increment request counter on response end', () => {
        const middleware = metricsMiddleware();

        middleware(req, res, next);
        res.end();

        expect(mockInc).toHaveBeenCalledWith(
          { method: 'GET', path: '/api/v1/wallets', status: '200' }
        );
      });

      it('should normalize path with UUIDs', () => {
        req.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transactions';
        const middleware = metricsMiddleware();

        middleware(req, res, next);
        res.end();

        expect(mockNormalizePath).toHaveBeenCalledWith(req.path);
        expect(mockInc).toHaveBeenCalledWith(
          expect.objectContaining({
            path: '/api/v1/wallets/:id/transactions',
          })
        );
      });

      it('should record different status codes', () => {
        const middleware = metricsMiddleware();
        res.statusCode = 404;

        middleware(req, res, next);
        res.end();

        expect(mockInc).toHaveBeenCalledWith(
          expect.objectContaining({
            status: '404',
          })
        );
      });

      it('should record POST method', () => {
        req.method = 'POST';
        const middleware = metricsMiddleware();

        middleware(req, res, next);
        res.end();

        expect(mockInc).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });

    describe('size metrics', () => {
      it('should not record sizes by default', () => {
        req.headers['content-length'] = '1000';
        const middleware = metricsMiddleware();

        middleware(req, res, next);
        res.end('response body');

        // Only duration and count should be recorded
        expect(mockObserve).toHaveBeenCalledTimes(1);
      });

      it('should record request size when enabled', () => {
        req.headers['content-length'] = '1000';
        const middleware = metricsMiddleware({ includeSizes: true });

        middleware(req, res, next);
        res.end();

        expect(mockObserve).toHaveBeenCalledWith(
          { method: 'GET', path: '/api/v1/wallets' },
          1000
        );
      });

      it('should record response size when enabled', () => {
        const middleware = metricsMiddleware({ includeSizes: true });
        const responseBody = 'test response body';

        middleware(req, res, next);
        res.end(responseBody);

        expect(mockObserve).toHaveBeenCalledWith(
          { method: 'GET', path: '/api/v1/wallets', status: '200' },
          Buffer.byteLength(responseBody)
        );
      });

      it('should handle Buffer response body', () => {
        const middleware = metricsMiddleware({ includeSizes: true });
        const buffer = Buffer.from('test buffer content');

        middleware(req, res, next);
        res.end(buffer);

        expect(mockObserve).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'GET' }),
          buffer.length
        );
      });

      it('should ignore non-string non-buffer response chunks for size metrics', () => {
        const middleware = metricsMiddleware({ includeSizes: true });

        middleware(req, res, next);
        res.end({ unexpected: true } as any);

        expect(mockObserve).toHaveBeenCalledTimes(1);
      });
    });

    describe('custom path normalizer', () => {
      it('should use custom path normalizer', () => {
        const customNormalizer = vi.fn((path: string) => '/normalized');
        const middleware = metricsMiddleware({ pathNormalizer: customNormalizer });

        middleware(req, res, next);
        res.end();

        expect(customNormalizer).toHaveBeenCalledWith('/api/v1/wallets');
        expect(mockInc).toHaveBeenCalledWith(
          expect.objectContaining({
            path: '/normalized',
          })
        );
      });
    });
  });

  describe('metricsHandler', () => {
    it('should return metrics in Prometheus format', async () => {
      await metricsHandler(req, res);

      expect(mockGetMetrics).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4');
      expect(res.send).toHaveBeenCalledWith('# HELP test_metric\ntest_metric 1');
    });

    it('should return 500 on metrics error', async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error('Metrics error'));
      res.status = vi.fn().mockReturnThis();

      await metricsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Failed to collect metrics');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get metrics',
        expect.objectContaining({ error: 'Metrics error' })
      );
    });
  });

  describe('responseTimeMiddleware', () => {
    it('should add X-Response-Time header', () => {
      const middleware = responseTimeMiddleware();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();

      res.end();

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Response-Time',
        expect.stringMatching(/^\d+\.\d{2}ms$/)
      );
    });

    it('should work without recording Prometheus metrics', () => {
      const middleware = responseTimeMiddleware();

      middleware(req, res, next);
      res.end();

      // Should only set header, not call metric functions
      expect(res.setHeader).toHaveBeenCalled();
      expect(mockInc).not.toHaveBeenCalled();
    });
  });
});
