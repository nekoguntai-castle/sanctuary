/**
 * Metrics Middleware
 *
 * Express middleware for automatic HTTP request metrics collection.
 * Records request duration, count, and size metrics.
 *
 * ## Usage
 *
 * ```typescript
 * import { metricsMiddleware, metricsHandler } from '../middleware/metrics';
 *
 * // Add middleware early in the chain
 * app.use(metricsMiddleware());
 *
 * // Expose /metrics endpoint for Prometheus scraping
 * app.get('/metrics', metricsHandler);
 * ```
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  metricsService,
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestSize,
  httpResponseSize,
  normalizePath,
} from '../observability/metrics';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('MW:METRICS');

/**
 * Metrics middleware options
 */
interface MetricsMiddlewareOptions {
  /** Paths to exclude from metrics */
  excludePaths?: string[];
  /** Include request/response size metrics */
  includeSizes?: boolean;
  /** Custom path normalizer */
  pathNormalizer?: (path: string) => string;
}

/**
 * Default paths to exclude from metrics
 */
const DEFAULT_EXCLUDE_PATHS = [
  '/health',
  '/metrics',
  '/favicon.ico',
];

/**
 * Metrics collection middleware
 *
 * Automatically records:
 * - Request duration
 * - Request count
 * - Request/response sizes (optional)
 */
export function metricsMiddleware(options: MetricsMiddlewareOptions = {}): RequestHandler {
  const {
    excludePaths = DEFAULT_EXCLUDE_PATHS,
    includeSizes = false,
    pathNormalizer = normalizePath,
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip excluded paths
    if (excludePaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    const startTime = process.hrtime.bigint();
    const method = req.method;
    const path = pathNormalizer(req.path);

    // Record request size if enabled
    if (includeSizes) {
      const requestSize = parseInt(req.headers['content-length'] || '0', 10);
      if (requestSize > 0) {
        httpRequestSize.observe({ method, path }, requestSize);
      }
    }

    // Intercept response to record metrics
    const originalEnd = res.end;
    let responseSize = 0;

    // @ts-expect-error - res.end has multiple overloaded signatures that cannot be satisfied by a single typed wrapper
    res.end = function (chunk?: string | Buffer | Uint8Array, encoding?: BufferEncoding, callback?: () => void): Response {
      // Calculate response size
      if (chunk && typeof chunk !== 'function') {
        if (typeof chunk === 'string') {
          responseSize = Buffer.byteLength(chunk, encoding || 'utf8');
        } else if (Buffer.isBuffer(chunk)) {
          responseSize = chunk.length;
        }
      }

      // Record metrics
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9; // Convert to seconds
      const status = String(res.statusCode);

      httpRequestDuration.observe({ method, path, status }, duration);
      httpRequestsTotal.inc({ method, path, status });

      if (includeSizes && responseSize > 0) {
        httpResponseSize.observe({ method, path, status }, responseSize);
      }

      // Call original end
      return originalEnd.call(this, chunk, encoding as BufferEncoding, callback);
    };

    next();
  };
}

/**
 * Metrics endpoint handler
 *
 * Exposes Prometheus metrics at /metrics
 */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', metricsService.getContentType());
    res.send(metrics);
  } catch (error) {
    log.error('Failed to get metrics', { error: getErrorMessage(error) });
    res.status(500).send('Failed to collect metrics');
  }
}

/**
 * Request timing middleware (lightweight alternative)
 *
 * Just adds X-Response-Time header without Prometheus metrics.
 * Use this if you want timing info without full metrics.
 */
export function responseTimeMiddleware(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const startTime = process.hrtime.bigint();

    const originalEnd = res.end;
    // @ts-expect-error - res.end has multiple overloaded signatures that cannot be satisfied by a single typed wrapper
    res.end = function (chunk?: string | Buffer | Uint8Array, encoding?: BufferEncoding, callback?: () => void): Response {
      const duration = Number(process.hrtime.bigint() - startTime) / 1e6; // Convert to ms
      res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
      return originalEnd.call(this, chunk, encoding as BufferEncoding, callback);
    };

    next();
  };
}
