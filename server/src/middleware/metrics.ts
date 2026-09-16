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
 * Hard bound on the number of distinct normalized path label values this
 * process will ever emit on `sanctuary_http_*` series. The current route
 * table is well under 300 templates, so 500 leaves generous headroom for
 * legitimate growth while still bounding a client that probes many distinct
 * unrecognized paths. A 404 response never consumes a slot here — it always
 * collapses to `/:unmatched` before this cap is consulted (see
 * decideRequestPathLabel).
 */
export const MAX_DISTINCT_HTTP_PATH_LABELS = 500;

const seenPathLabels = new Set<string>();
let capWarningLogged = false;

/**
 * Bounds the number of distinct path label values this process will ever
 * emit. A path is admitted to the cache only by a non-error response: a
 * request that was rejected before or during routing (version 400/410,
 * CSRF 403, rate limit 429, auth 401 on a path nothing has ever served
 * successfully) cannot spend a slot, so junk paths can neither fill the cap
 * nor pollute it, while an already-admitted path keeps its real label for
 * every status. Once the cap is reached, every further new path collapses
 * into the shared `/:other` bucket so cardinality stops growing; a single
 * warning is logged the first time the cap is hit.
 */
function boundPathLabelCardinality(path: string, admit: boolean): string {
  if (seenPathLabels.has(path)) {
    return path;
  }
  if (!admit) {
    return '/:other';
  }
  if (seenPathLabels.size >= MAX_DISTINCT_HTTP_PATH_LABELS) {
    if (!capWarningLogged) {
      capWarningLogged = true;
      log.warn('HTTP path label cardinality cap reached; further new paths collapse to /:other', {
        cap: MAX_DISTINCT_HTTP_PATH_LABELS,
      });
    }
    return '/:other';
  }
  seenPathLabels.add(path);
  return path;
}

/**
 * Test-only reset for the per-process distinct-path-label cache and its
 * warning latch. Exported and called explicitly from tests rather than
 * wired into MetricsService.reset(): registry.ts is imported by
 * middleware/metrics.ts (via the observability/metrics barrel), so having
 * registry.ts import back into middleware/metrics.ts to clear this cache
 * would create a circular import.
 */
export function resetHttpPathLabelCache(): void {
  seenPathLabels.clear();
  capWarningLogged = false;
}

/**
 * Decides the path label for a completed request. A 404 always collapses to
 * `/:unmatched` regardless of the requested path — the only producer of a
 * 404 for an unrouted path is notFoundHandler, and a routed handler that
 * legitimately 404s for a missing object collapses too (method+status still
 * distinguishes it, and its path was already normalized to `:id`). Every
 * other response is run through the distinct-label cap, which only a
 * successful (< 400) or server-error (>= 500) response may extend: a 5xx
 * proves the request reached a real route (an unrouted path can only 404),
 * so per-route error visibility survives a restart during an incident,
 * while client-side rejections (400/401/403/410/429) on never-served paths
 * cannot spend a slot.
 */
function decideRequestPathLabel(
  statusCode: number,
  rawPath: string,
  pathNormalizer: (path: string) => string
): string {
  if (statusCode === 404) {
    return '/:unmatched';
  }
  const admit = statusCode < 400 || statusCode >= 500;
  return boundPathLabelCardinality(pathNormalizer(rawPath), admit);
}

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
    const rawPath = req.path;
    const requestSize = includeSizes ? parseInt(req.headers['content-length'] || '0', 10) : 0;

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

      // Record metrics — the path label is decided here, now that
      // res.statusCode is known (see decideRequestPathLabel).
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9; // Convert to seconds
      const status = String(res.statusCode);
      const path = decideRequestPathLabel(res.statusCode, rawPath, pathNormalizer);

      httpRequestDuration.observe({ method, path, status }, duration);
      httpRequestsTotal.inc({ method, path, status });

      if (includeSizes) {
        if (requestSize > 0) {
          httpRequestSize.observe({ method, path }, requestSize);
        }
        if (responseSize > 0) {
          httpResponseSize.observe({ method, path, status }, responseSize);
        }
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
