/**
 * Backoff Manager
 *
 * Manages per-server backoff state: failure/success recording,
 * exponential backoff delay calculation, cooldown management,
 * and weight adjustments for the Electrum connection pool.
 */

import { createLogger } from '../../../utils/logger';
import type {
  ServerConfig,
  ServerState,
  BackoffConfig,
} from './types';
import { DEFAULT_BACKOFF_CONFIG } from './types';
import { updateServerHealthInDb } from './healthChecker';

const log = createLogger('ELECTRUM_POOL:BACKOFF');

/**
 * Record a failure for a server (call this when requests fail).
 * Applies backoff with exponential delay and weight reduction.
 */
export function recordServerFailure(
  serverId: string,
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  backoffConfig: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
  errorType: 'timeout' | 'error' | 'disconnect' = 'error',
): void {
  const stats = serverStats.get(serverId);
  if (!stats) return;

  stats.failedRequests++;
  stats.consecutiveFailures++;
  stats.consecutiveSuccesses = 0;

  // Apply extra penalty for timeouts (they waste more time)
  const failureWeight = errorType === 'timeout' ? 2 : 1;
  const effectiveFailures = stats.consecutiveFailures * failureWeight;

  // Check if we've hit the threshold for backoff
  if (effectiveFailures >= backoffConfig.failureThreshold) {
    stats.backoffLevel = Math.min(stats.backoffLevel + 1, 5); // Max 5 levels

    // Calculate cooldown with exponential backoff + jitter
    const delay = calculateBackoffDelay(stats.backoffLevel, backoffConfig);
    stats.cooldownUntil = new Date(Date.now() + delay);

    // Reduce weight
    const newWeight = Math.max(
      backoffConfig.minWeight,
      1.0 - (stats.backoffLevel * backoffConfig.weightPenalty)
    );
    stats.weight = newWeight;

    const server = servers.find(s => s.id === serverId);
    log.warn(`Server ${server?.label || serverId} entered backoff level ${stats.backoffLevel}`, {
      cooldownMs: delay,
      cooldownUntil: stats.cooldownUntil.toISOString(),
      weight: stats.weight,
      consecutiveFailures: stats.consecutiveFailures,
      errorType,
    });

    // Update database (fire and forget)
    updateServerHealthInDb(serverId, stats.isHealthy, stats.consecutiveFailures);
  }
}

/**
 * Record a success for a server (call this when requests succeed).
 * Gradually recovers from backoff state.
 */
export function recordServerSuccess(
  serverId: string,
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  backoffConfig: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
): void {
  const stats = serverStats.get(serverId);
  if (!stats) return;

  stats.totalRequests++;
  stats.consecutiveSuccesses++;

  // Clear cooldown immediately on success
  if (stats.cooldownUntil) {
    stats.cooldownUntil = null;
  }

  // Reset consecutive failures on any success (they're no longer consecutive)
  stats.consecutiveFailures = 0;

  // Gradual recovery from backoff
  if (stats.consecutiveSuccesses >= backoffConfig.recoveryThreshold) {
    if (stats.backoffLevel > 0) {
      stats.backoffLevel = Math.max(0, stats.backoffLevel - 1);
      stats.weight = Math.min(1.0, stats.weight + backoffConfig.weightPenalty);

      const server = servers.find(s => s.id === serverId);
      if (stats.backoffLevel === 0) {
        log.info(`Server ${server?.label || serverId} fully recovered from backoff`, {
          weight: stats.weight,
        });
      } else {
        log.info(`Server ${server?.label || serverId} recovered one backoff level`, {
          newLevel: stats.backoffLevel,
          weight: stats.weight,
        });
      }

      // Update database
      updateServerHealthInDb(serverId, true, stats.consecutiveFailures);
    }
    stats.consecutiveSuccesses = 0; // Reset for next recovery cycle
  }
}

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoffDelay(
  level: number,
  backoffConfig: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
): number {
  // Exponential: baseDelay * 2^(level-1)
  const exponentialDelay = backoffConfig.baseDelayMs * Math.pow(2, level - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, backoffConfig.maxDelayMs);

  // Add jitter (+/- 20%) to prevent thundering herd
  const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);

  return Math.round(cappedDelay + jitter);
}

/**
 * Check if a server is currently in cooldown
 */
export function isServerInCooldown(
  serverId: string,
  serverStats: Map<string, ServerState>,
): boolean {
  const stats = serverStats.get(serverId);
  if (!stats || !stats.cooldownUntil) return false;
  return stats.cooldownUntil.getTime() > Date.now();
}

/**
 * Get current backoff state for a server
 */
export function getServerBackoffState(
  serverId: string,
  serverStats: Map<string, ServerState>,
): {
  level: number;
  weight: number;
  inCooldown: boolean;
  cooldownRemaining: number;
  consecutiveFailures: number;
} | null {
  const stats = serverStats.get(serverId);
  if (!stats) return null;

  const now = Date.now();
  const inCooldown = stats.cooldownUntil ? stats.cooldownUntil.getTime() > now : false;
  const cooldownRemaining = inCooldown && stats.cooldownUntil
    ? stats.cooldownUntil.getTime() - now
    : 0;

  return {
    level: stats.backoffLevel,
    weight: stats.weight,
    inCooldown,
    cooldownRemaining,
    consecutiveFailures: stats.consecutiveFailures,
  };
}

/**
 * Manually reset backoff state for a server (e.g., after manual health check)
 */
export function resetServerBackoff(
  serverId: string,
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
): void {
  const stats = serverStats.get(serverId);
  if (!stats) return;

  const server = servers.find(s => s.id === serverId);
  log.info(`Manually resetting backoff for server ${server?.label || serverId}`);

  stats.consecutiveFailures = 0;
  stats.consecutiveSuccesses = 0;
  stats.backoffLevel = 0;
  stats.cooldownUntil = null;
  stats.weight = 1.0;
  stats.isHealthy = true;

  updateServerHealthInDb(serverId, true, 0);
}
