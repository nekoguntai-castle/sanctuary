/**
 * Fee Monitor
 *
 * Records fee snapshots to Redis sorted set and provides
 * fee trend analysis for autopilot consolidation decisions.
 */

import { getRedisClient, isRedisConnected } from '../../infrastructure';
import { getAdvancedFeeEstimates } from '../bitcoin/advancedTx/feeEstimation';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { FeeSnapshot } from './types';

const log = createLogger('AUTOPILOT:FEES');

const REDIS_KEY = 'autopilot:fees';
/** Keep ~24h of snapshots at 10-min intervals */
const MAX_SNAPSHOTS = 144;

/**
 * Record a fee snapshot to Redis.
 * Called by the recurring worker job every 10 minutes.
 */
export async function recordFeeSnapshot(): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    log.warn('Redis not available, skipping fee snapshot');
    return;
  }

  try {
    const fees = await getAdvancedFeeEstimates();
    const now = Date.now();

    const snapshot: FeeSnapshot = {
      timestamp: now,
      fastest: fees.fastest.feeRate,
      halfHour: fees.fast.feeRate,
      hour: fees.medium.feeRate,
      economy: fees.slow.feeRate,
      minimum: fees.minimum.feeRate,
    };

    // Add to sorted set (score = timestamp)
    await redis.zadd(REDIS_KEY, now, JSON.stringify(snapshot));

    // Prune old entries beyond MAX_SNAPSHOTS
    const count = await redis.zcard(REDIS_KEY);
    if (count > MAX_SNAPSHOTS) {
      await redis.zremrangebyrank(REDIS_KEY, 0, count - MAX_SNAPSHOTS - 1);
    }

    log.debug('Recorded fee snapshot', {
      economy: fees.slow.feeRate,
      minimum: fees.minimum.feeRate,
    });
  } catch (error) {
    log.error('Failed to record fee snapshot', { error: getErrorMessage(error) });
  }
}

/**
 * Get recent fee snapshots within the given window.
 */
export async function getRecentFees(windowMinutes: number = 60): Promise<FeeSnapshot[]> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return [];

  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const entries = await redis.zrangebyscore(REDIS_KEY, cutoff, '+inf');

  const snapshots: FeeSnapshot[] = [];
  for (const entry of entries) {
    try {
      snapshots.push(JSON.parse(entry) as FeeSnapshot);
    } catch {
      log.debug('Skipping corrupt fee snapshot entry');
    }
  }
  return snapshots;
}

/**
 * Get the latest fee snapshot.
 */
export async function getLatestFeeSnapshot(): Promise<FeeSnapshot | null> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return null;

  const entries = await redis.zrevrange(REDIS_KEY, 0, 0);
  if (entries.length === 0) return null;

  try {
    return JSON.parse(entries[0]) as FeeSnapshot;
  } catch {
    log.debug('Corrupt latest fee snapshot, discarding');
    return null;
  }
}

/**
 * Check if the current economy fee rate is at or below the threshold.
 */
export async function isFeeLow(maxFeeRate: number): Promise<boolean> {
  const latest = await getLatestFeeSnapshot();
  if (!latest) return false;

  return latest.economy <= maxFeeRate;
}
