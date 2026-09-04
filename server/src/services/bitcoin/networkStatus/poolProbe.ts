/**
 * One status-attempt probe of the pool: acquire exactly one handle, request
 * version + height in parallel via `allSettled` (never `all`, so a rejection
 * on one RPC cannot leave the other in flight when the handle is released),
 * and release exactly once after both have settled — on success, failure, or
 * abort.
 */

import type { ElectrumPool } from '../electrumPool/electrumPool';
import { getErrorMessage } from '../../../utils/errors';
import { createLogger } from '../../../utils/logger';
import { probeVersionAndHeight } from './probeVersionAndHeight';

const log = createLogger('BITCOIN_NETWORK:POOL_PROBE');

/**
 * Bound shared by every network-status probe attempt (pool acquisition and
 * the direct-singleton fallback's identity verification) so neither path can
 * hang the status endpoint waiting on an unreachable server.
 */
export const NETWORK_STATUS_PROBE_TIMEOUT_MS = 5000;

export interface PoolProbeResult {
  ok: boolean;
  serverId: string | null;
  version: { server: string; protocol: string } | null;
  blockHeight?: number;
}

export async function probePool(
  pool: ElectrumPool,
  timeoutMs = NETWORK_STATUS_PROBE_TIMEOUT_MS,
): Promise<PoolProbeResult> {
  const handle = await pool.acquire({ purpose: 'status', timeoutMs });
  try {
    const result = await probeVersionAndHeight(handle.client);
    if (result.ok) {
      return {
        ok: true,
        serverId: handle.serverId,
        version: result.version,
        blockHeight: result.blockHeight,
      };
    }

    log.debug('Pool status probe RPC failed', { error: getErrorMessage(result.failure) });
    return { ok: false, serverId: null, version: null };
  } finally {
    handle.release();
  }
}
