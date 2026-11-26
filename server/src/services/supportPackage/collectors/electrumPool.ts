/**
 * Electrum Pool Collector
 *
 * Collects Electrum connection pool stats: per-server health, connection counts,
 * backoff state, and request metrics. Reveals whether the wallet could even
 * detect the transaction that should have triggered a notification.
 */

import { getExistingElectrumPool } from '../../bitcoin/electrumPool/poolRegistry';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('electrumPool', async () => {
  try {
    const pool = getExistingElectrumPool();
    if (!pool) {
      return {
        initialized: false,
        totalConnections: 0,
        activeConnections: 0,
        idleConnections: 0,
        waitingRequests: 0,
        totalAcquisitions: 0,
        averageAcquisitionTimeMs: 0,
        healthCheckFailures: 0,
        serverCount: 0,
        servers: [],
      };
    }
    const stats = pool.getPoolStats();
    return { ...stats };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
