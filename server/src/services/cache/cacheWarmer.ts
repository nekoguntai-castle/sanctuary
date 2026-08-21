/**
 * Cache Warming
 *
 * Startup orchestration for pre-populating commonly accessed cache data.
 * Kept separate from cacheService so cache primitives do not depend on their
 * higher-level consumers.
 */

import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';

const log = createLogger('CACHE:SVC');

/** Cache warming configuration. */
export interface CacheWarmConfig {
  /** Warm feature flags (default: true) */
  featureFlags?: boolean;
  /** Warm block height (default: true) */
  blockHeight?: boolean;
  /** Warm price data (default: true) */
  priceData?: boolean;
}

export interface CacheWarmResult {
  warmed: string[];
  failed: string[];
  durationMs: number;
}

/**
 * Warm caches on startup to reduce cold-start latency.
 *
 * Service imports remain lazy so warming preserves the existing startup and
 * failure-isolation behavior.
 */
export async function warmCaches(
  config: CacheWarmConfig = {},
): Promise<CacheWarmResult> {
  const startTime = Date.now();
  const warmed: string[] = [];
  const failed: string[] = [];

  const {
    featureFlags = true,
    blockHeight = true,
    priceData = true,
  } = config;

  const warmingTasks: Promise<void>[] = [];

  if (featureFlags) {
    warmingTasks.push(
      (async () => {
        try {
          const { featureFlagService } = await import('../featureFlagService');
          const flags = await featureFlagService.getAllFlags();
          if (flags.length > 0) {
            warmed.push('featureFlags');
          } else {
            failed.push('featureFlags');
          }
        } catch (error) {
          log.warn('Failed to warm feature flags cache', { error: getErrorMessage(error) });
          failed.push('featureFlags');
        }
      })()
    );
  }

  if (blockHeight) {
    warmingTasks.push(
      (async () => {
        try {
          const { getBlockHeight } = await import('../bitcoin/utils/blockHeight');
          const height = await getBlockHeight();
          if (height > 0) {
            warmed.push('blockHeight');
          } else {
            failed.push('blockHeight');
          }
        } catch (error) {
          log.warn('Failed to warm block height cache', { error: getErrorMessage(error) });
          failed.push('blockHeight');
        }
      })()
    );
  }

  if (priceData) {
    warmingTasks.push(
      (async () => {
        try {
          const { getPriceService } = await import('../price');
          const price = await getPriceService().getPrice();
          if (price) {
            warmed.push('priceData');
          } else {
            failed.push('priceData');
          }
        } catch (error) {
          log.warn('Failed to warm price cache', { error: getErrorMessage(error) });
          failed.push('priceData');
        }
      })()
    );
  }

  await Promise.allSettled(warmingTasks);

  const durationMs = Date.now() - startTime;

  if (warmed.length > 0) {
    log.info(`Cache warming completed in ${durationMs}ms`, {
      warmed,
      failed: failed.length > 0 ? failed : undefined,
    });
  }

  return { warmed, failed, durationMs };
}
