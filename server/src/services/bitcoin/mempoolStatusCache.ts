/**
 * Consolidated Mempool Status Cache
 *
 * Shared single-flight cache for mempool and recent blocks data used by both
 * the public Bitcoin network API route and assistant/MCP read tools.
 */

import { BITCOIN_NON_REGTEST_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import { singleFlight } from '../../utils/async';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import * as mempool from './mempool';

const log = createLogger('BITCOIN:MEMPOOL_CACHE');

export const MEMPOOL_CACHE_TTL_MS = 15_000;
export const MEMPOOL_STALE_TTL_MS = 300_000;

export type MempoolNetwork = (typeof BITCOIN_NON_REGTEST_NETWORKS)[number];
export type MempoolStatus = Awaited<ReturnType<typeof mempool.getBlocksAndMempool>>;

interface MempoolCacheEntry {
  data: MempoolStatus;
  timestamp: number;
}

export interface CachedMempoolStatusResult {
  data: MempoolStatus & { stale?: true };
  timestamp: number;
  stale: boolean;
  fromCache: boolean;
}

const mempoolStatusCache = new Map<MempoolNetwork, MempoolCacheEntry>();
const inFlightMempoolRequests = new Map<MempoolNetwork, Promise<CachedMempoolStatusResult>>();

export function resetMempoolStatusCacheForTests(): void {
  mempoolStatusCache.clear();
  inFlightMempoolRequests.clear();
}

export async function getCachedMempoolStatus(
  network: MempoolNetwork,
  options?: { signal?: AbortSignal },
): Promise<CachedMempoolStatusResult> {
  const now = Date.now();
  const cached = mempoolStatusCache.get(network);

  if (cached && now - cached.timestamp < MEMPOOL_CACHE_TTL_MS) {
    return {
      data: cached.data,
      timestamp: cached.timestamp,
      stale: false,
      fromCache: true,
    };
  }

  return singleFlight(inFlightMempoolRequests, network, async () => {
    try {
      const data = options?.signal
        ? await mempool.getBlocksAndMempool(network, { signal: options.signal })
        : await mempool.getBlocksAndMempool(network);
      mempoolStatusCache.set(network, { data, timestamp: now });
      return {
        data,
        timestamp: now,
        stale: false,
        fromCache: false,
      };
    } catch (error) {
      if (cached && now - cached.timestamp < MEMPOOL_STALE_TTL_MS) {
        log.warn('Returning stale mempool cache due to fetch failure', {
          network,
          error: getErrorMessage(error),
        });
        return {
          data: { ...cached.data, stale: true },
          timestamp: cached.timestamp,
          stale: true,
          fromCache: true,
        };
      }
      throw error;
    }
  });
}
