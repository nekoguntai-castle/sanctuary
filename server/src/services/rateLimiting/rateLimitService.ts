/**
 * Rate Limit Service
 *
 * Distributed rate limiting service that uses Redis when available,
 * with automatic fallback to in-memory storage.
 *
 * ## Features
 *
 * - Sliding window algorithm for accurate rate limiting
 * - Redis-backed for distributed deployments
 * - Graceful degradation to in-memory when Redis unavailable
 * - Policy-based configuration
 * - Health monitoring
 *
 * ## Usage
 *
 * ```typescript
 * import { rateLimitService } from './services/rateLimiting';
 *
 * // Check and consume
 * const result = await rateLimitService.consume('auth:login', 'user:123');
 * if (!result.allowed) {
 *   res.status(429).json({ retryAfter: result.retryAfter });
 * }
 * ```
 */

import { getRedisClient, isRedisConnected } from '../../infrastructure';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { IRateLimiter, IRateLimitService, RateLimitPolicy, RateLimitResult } from './types';
import { RedisRateLimiter } from './redisRateLimiter';
import { MemoryRateLimiter } from './memoryRateLimiter';
import { RATE_LIMIT_POLICIES } from './policies';

const log = createLogger('RATE_LIMIT:SVC');

class RateLimitService implements IRateLimitService {
  private redisLimiter: RedisRateLimiter | null = null;
  private memoryLimiter: MemoryRateLimiter;
  private policies: Map<string, RateLimitPolicy> = new Map();
  private initialized = false;

  constructor() {
    this.memoryLimiter = new MemoryRateLimiter();

    // Register default policies
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      this.policies.set(policy.name, policy);
    }
  }

  /**
   * Initialize the service (called after Redis is ready)
   */
  initialize(): void {
    if (this.initialized) return;

    const redisClient = getRedisClient();
    if (!redisClient || !isRedisConnected()) {
      throw new Error('Redis is required for rate limiting');
    }

    this.redisLimiter = new RedisRateLimiter(redisClient);
    log.info('Rate limit service initialized with Redis backend');

    this.initialized = true;
  }

  /**
   * Get the active limiter (Redis or memory fallback)
   */
  private getLimiter(): IRateLimiter {
    if (this.redisLimiter && isRedisConnected()) {
      return this.redisLimiter;
    }

    throw new Error('Redis rate limiter unavailable');
  }

  registerPolicy(policy: RateLimitPolicy): void {
    this.policies.set(policy.name, policy);
    log.debug('Registered rate limit policy', { policy: policy.name });
  }

  async consume(
    policyName: string,
    key: string,
    cost = 1
  ): Promise<RateLimitResult> {
    const policy = this.policies.get(policyName);
    if (!policy) {
      log.warn('Unknown rate limit policy', { policy: policyName });
      // Allow request if policy not found
      return {
        allowed: true,
        remaining: 999,
        limit: 1000,
        resetAt: Date.now() + 60000,
      };
    }

    const limiter = this.getLimiter();
    const fullKey = `${policy.name}:${key}`;

    try {
      const result = await limiter.consume(
        fullKey,
        policy.limit,
        policy.windowSeconds,
        cost
      );

      if (!result.allowed) {
        log.debug('Rate limit exceeded', {
          policy: policyName,
          key,
          remaining: result.remaining,
          retryAfter: result.retryAfter,
        });
      }

      return result;
    } catch (error) {
      log.error('Rate limit check failed', { policy: policyName, key, error: getErrorMessage(error) });
      // Fail open on error
      return {
        allowed: true,
        remaining: policy.limit,
        limit: policy.limit,
        resetAt: Date.now() + policy.windowSeconds * 1000,
      };
    }
  }

  async check(policyName: string, key: string): Promise<RateLimitResult> {
    const policy = this.policies.get(policyName);
    if (!policy) {
      return {
        allowed: true,
        remaining: 999,
        limit: 1000,
        resetAt: Date.now() + 60000,
      };
    }

    const limiter = this.getLimiter();
    const fullKey = `${policy.name}:${key}`;

    try {
      return await limiter.check(fullKey, policy.limit, policy.windowSeconds);
    } catch (error) {
      log.error('Rate limit check failed', { policy: policyName, key, error: getErrorMessage(error) });
      return {
        allowed: true,
        remaining: policy.limit,
        limit: policy.limit,
        resetAt: Date.now() + policy.windowSeconds * 1000,
      };
    }
  }

  async reset(policyName: string, key: string): Promise<void> {
    const policy = this.policies.get(policyName);
    if (!policy) return;

    const limiter = this.getLimiter();
    const fullKey = `${policy.name}:${key}`;

    await limiter.reset(fullKey);
    log.debug('Rate limit reset', { policy: policyName, key });
  }

  async getRemaining(policyName: string, key: string): Promise<number> {
    const policy = this.policies.get(policyName);
    if (!policy) return 999;

    const limiter = this.getLimiter();
    const fullKey = `${policy.name}:${key}`;

    return limiter.getRemaining(fullKey, policy.limit, policy.windowSeconds);
  }

  async getHealth(): Promise<{
    healthy: boolean;
    backend: string;
    latencyMs?: number;
  }> {
    try {
      const limiter = this.getLimiter();
      const start = Date.now();
      const healthy = await limiter.isHealthy();
      const latencyMs = Date.now() - start;

      return {
        healthy,
        backend: limiter.getType(),
        latencyMs,
      };
    } catch {
      return {
        healthy: false,
        backend: 'redis',
      };
    }
  }

  /**
   * Get policy configuration
   */
  getPolicy(name: string): RateLimitPolicy | undefined {
    return this.policies.get(name);
  }

  /**
   * Get all policy names
   */
  getPolicyNames(): string[] {
    return Array.from(this.policies.keys());
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    this.memoryLimiter.shutdown();
    log.info('Rate limit service shutdown');
  }
}

// Singleton instance
export const rateLimitService = new RateLimitService();

export default rateLimitService;
