/**
 * Access-control cache helpers.
 *
 * Lives below services so repositories can invalidate access cache after
 * role mutations without importing the access-control service layer.
 */

import { getNamespacedCache } from './redis';
import type { ICacheService } from '../services/cache/cacheService';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('ACCESS_CACHE:INFRA');

/**
 * Get the access control cache instance.
 * Uses Redis when available, falls back to in-memory.
 */
export function getAccessCache(): ICacheService {
  return getNamespacedCache('access');
}

/**
 * Clear access cache for a specific wallet.
 */
export async function invalidateWalletAccessCache(walletId: string): Promise<void> {
  try {
    const cache = getAccessCache();
    await cache.deletePattern(`*:${walletId}`);
    log.debug('Invalidated access cache for wallet', { walletId: walletId.substring(0, 8) });
  } catch (error) {
    log.warn('Failed to invalidate wallet access cache', { walletId, error: getErrorMessage(error) });
  }
}

/**
 * Clear access cache for a specific user.
 */
export async function invalidateUserAccessCache(userId: string): Promise<void> {
  try {
    const cache = getAccessCache();
    await cache.deletePattern(`${userId}:*`);
    log.debug('Invalidated access cache for user', { userId: userId.substring(0, 8) });
  } catch (error) {
    log.warn('Failed to invalidate user access cache', { userId, error: getErrorMessage(error) });
  }
}

/**
 * Clear the entire access cache.
 */
export async function clearAccessCache(): Promise<void> {
  try {
    const cache = getAccessCache();
    await cache.clear();
    log.info('Cleared entire access cache');
  } catch (error) {
    log.warn('Failed to clear access cache', { error: getErrorMessage(error) });
  }
}
