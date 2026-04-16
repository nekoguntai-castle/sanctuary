/**
 * Rate Limit Policies
 *
 * Pre-defined rate limit policies for different API endpoints.
 * All limits are configurable via environment variables in config/index.ts.
 */

import type { RateLimitPolicy } from './types';
import { getConfig } from '../../config';

/**
 * Get rate limit policies
 * Uses config values which can be overridden via environment variables
 */
function buildPolicies(): Record<string, RateLimitPolicy> {
  const config = getConfig();
  const rl = config.rateLimit;

  return {
    // Authentication policies (strict)
    'auth:login': {
      name: 'auth:login',
      limit: rl.loginAttempts,
      windowSeconds: rl.loginWindowSeconds,
      keyStrategy: 'ip+user',
      message: 'Too many login attempts. Please try again in 15 minutes.',
    },

    'auth:register': {
      name: 'auth:register',
      limit: rl.registerAttempts,
      windowSeconds: rl.registerWindowSeconds,
      keyStrategy: 'ip',
      message: 'Too many registration attempts. Please try again later.',
    },

    'auth:2fa': {
      name: 'auth:2fa',
      limit: rl.twoFaAttempts,
      windowSeconds: rl.twoFaWindowSeconds,
      keyStrategy: 'ip',
      message: 'Too many 2FA attempts. Please try again in 15 minutes.',
    },

    'auth:password-change': {
      name: 'auth:password-change',
      limit: rl.passwordChangeAttempts,
      windowSeconds: rl.passwordChangeWindowSeconds,
      keyStrategy: 'user',
      message: 'Too many password change attempts. Please try again later.',
    },

    'auth:email-verify': {
      name: 'auth:email-verify',
      limit: rl.emailVerifyAttempts,
      windowSeconds: rl.emailVerifyWindowSeconds,
      keyStrategy: 'ip',
      message: 'Too many verification attempts. Please try again later.',
    },

    'auth:email-resend': {
      name: 'auth:email-resend',
      limit: rl.emailResendAttempts,
      windowSeconds: rl.emailResendWindowSeconds,
      keyStrategy: 'user',
      message: 'Too many verification email requests. Please try again later.',
    },

    'auth:email-update': {
      name: 'auth:email-update',
      limit: rl.emailUpdateAttempts,
      windowSeconds: rl.emailUpdateWindowSeconds,
      keyStrategy: 'user',
      message: 'Too many email update attempts. Please try again later.',
    },

    // API policies (general)
    'api:default': {
      name: 'api:default',
      limit: rl.apiDefaultLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      skipFailedRequests: true,
      message: 'API rate limit exceeded. Please slow down.',
    },

    'api:heavy': {
      name: 'api:heavy',
      limit: rl.apiHeavyLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Too many requests to this endpoint.',
    },

    'api:public': {
      name: 'api:public',
      limit: rl.apiPublicLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'ip',
      message: 'Rate limit exceeded. Please try again later.',
    },

    // Sync policies
    'sync:trigger': {
      name: 'sync:trigger',
      limit: rl.syncTriggerLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Too many sync requests. Please wait before syncing again.',
    },

    'sync:batch': {
      name: 'sync:batch',
      limit: rl.syncBatchLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Too many batch sync requests.',
    },

    // Transaction policies
    'tx:create': {
      name: 'tx:create',
      limit: rl.txCreateLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Too many transaction creation attempts.',
    },

    'tx:broadcast': {
      name: 'tx:broadcast',
      limit: rl.txBroadcastLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Too many broadcast attempts. Please wait.',
    },

    // AI policies (resource intensive)
    'ai:analyze': {
      name: 'ai:analyze',
      limit: rl.aiAnalyzeLimit,
      windowSeconds: rl.aiWindowSeconds,
      keyStrategy: 'user',
      message: 'AI analysis rate limit reached. Please wait.',
    },

    'ai:summarize': {
      name: 'ai:summarize',
      limit: rl.aiSummarizeLimit,
      windowSeconds: rl.aiWindowSeconds,
      keyStrategy: 'user',
      message: 'AI summary rate limit reached.',
    },

    // Admin policies (separate from regular users)
    'admin:default': {
      name: 'admin:default',
      limit: rl.adminDefaultLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Admin API rate limit exceeded.',
    },

    'mcp:default': {
      name: 'mcp:default',
      limit: config.mcp.rateLimitPerMinute,
      windowSeconds: 60,
      keyStrategy: 'api-key',
      message: 'MCP rate limit exceeded.',
    },

    // Payjoin policies
    'payjoin:create': {
      name: 'payjoin:create',
      limit: rl.payjoinCreateLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Too many PayJoin requests.',
    },

    // WebSocket policies
    'ws:connect': {
      name: 'ws:connect',
      limit: rl.wsConnectLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'ip',
      message: 'Too many WebSocket connection attempts.',
    },

    'ws:message': {
      name: 'ws:message',
      limit: rl.wsMessageLimit,
      windowSeconds: 60, // per minute
      keyStrategy: 'user',
      message: 'Too many WebSocket messages.',
    },
  };
}

// Lazy-loaded policies cache
let policiesCache: Record<string, RateLimitPolicy> | null = null;

/**
 * Get all rate limit policies
 * Cached after first call since config doesn't change at runtime
 */
export function getRateLimitPolicies(): Record<string, RateLimitPolicy> {
  if (!policiesCache) {
    policiesCache = buildPolicies();
  }
  return policiesCache;
}

/**
 * Standard rate limit policies
 * @deprecated Use getRateLimitPolicies() for lazy config loading
 */
export const RATE_LIMIT_POLICIES = getRateLimitPolicies();

/**
 * Get policy by name
 */
export function getPolicy(name: string): RateLimitPolicy | undefined {
  return RATE_LIMIT_POLICIES[name];
}

/**
 * Create a custom policy
 */
export function createPolicy(policy: RateLimitPolicy): RateLimitPolicy {
  return {
    ...policy,
    name: policy.name,
  };
}
