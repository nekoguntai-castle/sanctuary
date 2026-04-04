/**
 * Electrum Pool Collector
 *
 * Collects Electrum connection pool stats: per-server health, connection counts,
 * backoff state, and request metrics. Reveals whether the wallet could even
 * detect the transaction that should have triggered a notification.
 */

import { getElectrumPool } from '../../bitcoin/electrumPool';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('electrumPool', async () => {
  try {
    const pool = getElectrumPool();
    const stats = pool.getPoolStats();
    return { ...stats };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
