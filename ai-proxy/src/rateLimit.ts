import { Request, Response, NextFunction } from 'express';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from './constants';
import { createLogger } from './logger';

const log = createLogger('AI:RATE_LIMIT');

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 300000; // 5 minutes

setInterval(() => {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let cleaned = 0;

  for (const [ip, entry] of rateLimitStore.entries()) {
    if (entry.windowStart < cutoff) {
      rateLimitStore.delete(ip);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    log.debug(`Rate limit cleanup: removed ${cleaned} expired entries`);
  }
}, CLEANUP_INTERVAL_MS);

export const rateLimit = (req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = rateLimitStore.get(clientIp);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 1, windowStart: now };
    rateLimitStore.set(clientIp, entry);
  } else {
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
      log.warn('Rate limit exceeded', { clientIp });
      const retryAfter = Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
      return res.status(429).json({
        error: `Rate limit exceeded. AI requests are limited to ${RATE_LIMIT_MAX_REQUESTS} per minute. Please wait ${retryAfter}s before trying again.`,
        retryAfter,
      });
    }
  }

  next();
};
