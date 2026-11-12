import type { Request } from 'express';
import expressRateLimit, { MemoryStore, ipKeyGenerator } from 'express-rate-limit';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from './constants';
import { createLogger } from './logger';

const log = createLogger('AI:RATE_LIMIT');

export const RATE_LIMIT_KEY_HEADER = 'x-llm-egress-rate-key';
const RATE_LIMIT_KEY_PATTERN = /^(user|worker|admin):[A-Za-z0-9_-]{1,64}$/;

/**
 * Returns the backend-supplied principal key (user:/worker:/admin:<id>) when it
 * is well formed, otherwise undefined. The header is only trusted because the
 * shared-secret middleware runs before any rate-limited route.
 */
export function principalRateLimitKey(req: Pick<Request, 'headers'>): string | undefined {
  const value = req.headers?.[RATE_LIMIT_KEY_HEADER];
  return typeof value === 'string' && RATE_LIMIT_KEY_PATTERN.test(value) ? value : undefined;
}

// One store for the whole proxy. Every rate-limited route uses the single
// `rateLimit` instance below, so a principal has one budget across all AI
// routes. A second limiter with its own store would give each caller the
// advertised limit twice.
const store = new MemoryStore();

export function stopRateLimitCleanup(): void {
  store.shutdown();
}

export const rateLimit = expressRateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: false,
  legacyHeaders: false,
  store,
  keyGenerator: (req) =>
    principalRateLimitKey(req) ?? ipKeyGenerator(req.ip ?? 'unknown'),
  handler: (req, res) => {
    log.warn('Rate limit exceeded', { key: principalRateLimitKey(req) ?? 'ip' });
    const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
    return res.status(429).json({
      error: `Rate limit exceeded. AI requests are limited to ${RATE_LIMIT_MAX_REQUESTS} per minute. Please wait ${retryAfter}s before trying again.`,
      retryAfter,
    });
  },
});
