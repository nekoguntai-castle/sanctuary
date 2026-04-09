/**
 * Rate Limit Middleware
 *
 * Express middleware for distributed rate limiting.
 * Uses Redis when available with automatic fallback to in-memory.
 *
 * ## Usage
 *
 * ```typescript
 * import { rateLimit, rateLimitByUser } from '../middleware/rateLimit';
 *
 * // By IP (public endpoints)
 * router.post('/register', rateLimit('auth:register'), handler);
 *
 * // By user (authenticated endpoints)
 * router.post('/sync', authenticate, rateLimitByUser('sync:trigger'), handler);
 *
 * // Combined IP + identifier
 * router.post('/login', rateLimitByIpAndKey('auth:login', req => req.body?.username), handler);
 * ```
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { rateLimitService, type RateLimitResult } from '../services/rateLimiting';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('MW:RATE_LIMIT');

/**
 * Set rate limit headers on response
 */
function setRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

  if (result.retryAfter !== undefined) {
    res.setHeader('Retry-After', result.retryAfter);
  }
}

/**
 * Send rate limit exceeded response
 */
interface RateLimitOptions {
  message?: string;
  responseType?: 'json' | 'text';
  contentType?: string;
}

function sendRateLimitResponse(
  res: Response,
  result: RateLimitResult,
  message?: string,
  options?: RateLimitOptions
): void {
  setRateLimitHeaders(res, result);

  if (options?.responseType === 'text') {
    res
      .status(429)
      .type(options.contentType || 'text/plain')
      .send(message || `Too many requests. You've exceeded the rate limit. Please wait ${result.retryAfter ?? 'a few'} seconds before trying again.`);
    return;
  }

  res.status(429).json({
    success: false,
    error: {
      type: 'RateLimitError',
      code: 'RATE_LIMIT_EXCEEDED',
      message: message || `Too many requests. You've exceeded the rate limit (${result.limit} requests). Please wait ${result.retryAfter ?? 'a few'} seconds before trying again.`,
      details: {
        retryAfter: result.retryAfter,
        limit: result.limit,
        remaining: result.remaining,
      },
    },
  });
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  // Trust proxy is enabled, so x-forwarded-for is reliable
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ips.trim();
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Rate limit middleware by IP address
 *
 * Use for public endpoints (unauthenticated)
 */
export function rateLimit(policyName: string, options?: RateLimitOptions): RequestHandler {
  const policy = rateLimitService.getPolicy(policyName);
  const message = options?.message || policy?.message;

  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const key = `ip:${ip}`;

    try {
      const result = await rateLimitService.consume(policyName, key);

      setRateLimitHeaders(res, result);

      if (!result.allowed) {
        return sendRateLimitResponse(res, result, message, options);
      }

      next();
    } catch (error) {
      log.error('Rate limit middleware error', { policy: policyName, error: getErrorMessage(error) });
      // Fail closed - block request on error for security
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    }
  };
}

/**
 * Rate limit middleware by user ID
 *
 * Use for authenticated endpoints
 * Requires authenticate middleware to run first
 */
export function rateLimitByUser(policyName: string, options?: RateLimitOptions): RequestHandler {
  const policy = rateLimitService.getPolicy(policyName);
  const message = options?.message || policy?.message;

  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user?.userId;

    if (!userId) {
      // No user ID - fall back to IP
      const ip = getClientIp(req);
      const key = `ip:${ip}`;

      try {
        const result = await rateLimitService.consume(policyName, key);
        setRateLimitHeaders(res, result);

        if (!result.allowed) {
          return sendRateLimitResponse(res, result, message, options);
        }
        return next();
      } catch (error) {
        log.error('Rate limit middleware error', { policy: policyName, error: getErrorMessage(error) });
        // Fail closed - block request on error for security
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Rate limiting service temporarily unavailable. Please try again.',
        });
      }
    }

    const key = `user:${userId}`;

    try {
      const result = await rateLimitService.consume(policyName, key);
      setRateLimitHeaders(res, result);

      if (!result.allowed) {
        return sendRateLimitResponse(res, result, message, options);
      }

      next();
    } catch (error) {
      log.error('Rate limit middleware error', { policy: policyName, error: getErrorMessage(error) });
      // Fail closed - block request on error for security
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    }
  };
}

/**
 * Rate limit middleware by IP + custom key
 *
 * Use for login endpoints where you want to rate limit by IP + username
 */
export function rateLimitByIpAndKey(
  policyName: string,
  keyExtractor: (req: Request) => string | undefined,
  options?: RateLimitOptions
): RequestHandler {
  const policy = rateLimitService.getPolicy(policyName);
  const message = options?.message || policy?.message;

  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const customKey = keyExtractor(req) || 'unknown';
    const key = `${ip}:${customKey}`;

    try {
      const result = await rateLimitService.consume(policyName, key);
      setRateLimitHeaders(res, result);

      if (!result.allowed) {
        return sendRateLimitResponse(res, result, message, options);
      }

      next();
    } catch (error) {
      log.error('Rate limit middleware error', { policy: policyName, error: getErrorMessage(error) });
      // Fail closed - block request on error for security
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    }
  };
}

/**
 * Rate limit middleware by custom key function
 *
 * For complete control over key generation
 */
export function rateLimitByKey(
  policyName: string,
  keyGenerator: (req: Request) => string,
  options?: RateLimitOptions
): RequestHandler {
  const policy = rateLimitService.getPolicy(policyName);
  const message = options?.message || policy?.message;

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);

    try {
      const result = await rateLimitService.consume(policyName, key);
      setRateLimitHeaders(res, result);

      if (!result.allowed) {
        return sendRateLimitResponse(res, result, message, options);
      }

      next();
    } catch (error) {
      log.error('Rate limit middleware error', { policy: policyName, error: getErrorMessage(error) });
      // Fail closed - block request on error for security
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Rate limiting service temporarily unavailable. Please try again.',
      });
    }
  };
}

/**
 * Skip rate limiting if a condition is met
 *
 * Useful for skipping rate limits for admin users
 */
export function skipRateLimitIf(
  condition: (req: Request) => boolean,
  middleware: RequestHandler
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (condition(req)) {
      return next();
    }
    return middleware(req, res, next);
  };
}

/**
 * Combine multiple rate limit middlewares
 *
 * All limits must pass for the request to proceed
 */
export function combineRateLimits(...middlewares: RequestHandler[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    for (const middleware of middlewares) {
      let blocked = false;
      let error: Error | undefined;

      await new Promise<void>((resolve) => {
        middleware(req, res, ((err?: unknown) => {
          if (err) {
            error = err instanceof Error ? err : new Error(String(err));
          }
          // Check if response was already sent (rate limited)
          if (res.headersSent) {
            blocked = true;
          }
          resolve();
        }) as NextFunction);
      });

      if (blocked) {
        return; // Response already sent
      }

      if (error) {
        return next(error);
      }
    }

    next();
  };
}
