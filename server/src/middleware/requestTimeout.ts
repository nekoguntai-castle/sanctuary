/**
 * Request Timeout Middleware
 *
 * Prevents requests from hanging indefinitely by enforcing timeouts.
 * - Default timeout: 30 seconds for most routes
 * - Configurable per-route timeouts for long-running operations
 * - Returns 408 Request Timeout when exceeded
 * - Logs timeout events for monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import { requestContext } from '../utils/requestContext';

const log = createLogger('MW:TIMEOUT');

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const AI_REQUEST_TIMEOUT_MS = 125000; // local/LAN models can be slow
const CONSOLE_REQUEST_TIMEOUT_MS = 280000; // planner + tools + synthesis

/**
 * Routes that need longer timeouts (pattern -> timeout ms)
 */
const EXTENDED_TIMEOUT_ROUTES: Array<{
  pattern: RegExp;
  timeout: number;
  reason: string;
}> = [
  // Backup/restore operations handle large data
  { pattern: /^\/api\/v1\/admin\/backup/, timeout: 120000, reason: 'backup/restore' },
  { pattern: /^\/api\/v1\/admin\/restore/, timeout: 120000, reason: 'backup/restore' },
  // Full wallet sync may take time with many UTXOs
  { pattern: /^\/api\/v1\/sync\/.*\/full/, timeout: 90000, reason: 'full sync' },
  // Transaction broadcasts may have network delays
  { pattern: /^\/api\/v1\/wallets\/.*\/transactions\/broadcast/, timeout: 60000, reason: 'tx broadcast' },
  // AI analysis endpoints
  { pattern: /^\/api\/v1\/ai\//, timeout: 60000, reason: 'AI analysis' },
  { pattern: /^\/internal\/ai\//, timeout: 60000, reason: 'AI analysis' },
  // Console turn/replay routes wait for planning, read-only tool execution, and synthesis
  { pattern: /^\/api\/v1\/console\/turns$/, timeout: CONSOLE_REQUEST_TIMEOUT_MS, reason: 'Console AI turn' },
  { pattern: /^\/api\/v1\/console\/prompts\/[^/]+\/replay$/, timeout: CONSOLE_REQUEST_TIMEOUT_MS, reason: 'Console AI replay' },
];

/**
 * Routes to exclude from timeout (health checks, WebSocket upgrades)
 */
const EXCLUDED_ROUTES = ['/health', '/api/v1/health', '/ws', '/gateway', '/metrics'];

/**
 * Get the appropriate timeout for a given path
 */
function getTimeoutForPath(path: string): { timeout: number; reason?: string } {
  // Check excluded routes first
  if (EXCLUDED_ROUTES.some((r) => path === r || path.startsWith(r))) {
    return { timeout: 0 }; // No timeout
  }

  // Check for extended timeout routes
  for (const route of EXTENDED_TIMEOUT_ROUTES) {
    if (route.pattern.test(path)) {
      return { timeout: route.timeout, reason: route.reason };
    }
  }

  return { timeout: DEFAULT_TIMEOUT_MS };
}

/**
 * Request timeout middleware
 *
 * Wraps requests with a timeout handler that responds with 408
 * if the request takes too long.
 */
export function requestTimeout(req: Request, res: Response, next: NextFunction): void {
  const { timeout, reason } = getTimeoutForPath(req.path);

  // Skip timeout for excluded routes
  if (timeout === 0) {
    return next();
  }

  let timedOut = false;

  // Set up the timeout
  const timeoutHandle = setTimeout(() => {
    timedOut = true;

    const requestId = requestContext.getRequestId();
    const duration = requestContext.getDuration();

    log.error('Request timeout', {
      requestId,
      method: req.method,
      path: req.path,
      timeout: `${timeout}ms`,
      duration: `${duration}ms`,
      reason: reason || 'default timeout',
    });

    // Don't send response if headers already sent
    if (!res.headersSent) {
      res.status(408).json({
        error: 'Request Timeout',
        message: 'The request took too long to process',
        timeout: `${timeout}ms`,
      });
    }
  }, timeout);

  // Clean up timeout when response finishes
  res.on('finish', () => {
    clearTimeout(timeoutHandle);
  });

  res.on('close', () => {
    clearTimeout(timeoutHandle);
  });

  // Wrap next to prevent further processing after timeout
  const wrappedNext: NextFunction = (err?: unknown) => {
    if (!timedOut) {
      next(err);
    }
  };

  wrappedNext();
}

/**
 * Create a custom timeout middleware for specific routes
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns Express middleware function
 *
 * @example
 * router.post('/long-operation', withTimeout(120000), handler);
 */
export function withTimeout(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;

      const requestId = requestContext.getRequestId();
      log.error('Custom route timeout', {
        requestId,
        method: req.method,
        path: req.path,
        timeout: `${timeoutMs}ms`,
      });

      if (!res.headersSent) {
        res.status(408).json({
          error: 'Request Timeout',
          message: 'The request took too long to process',
          timeout: `${timeoutMs}ms`,
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timeoutHandle));
    res.on('close', () => clearTimeout(timeoutHandle));

    if (!timedOut) {
      next();
    }
  };
}

export default requestTimeout;
