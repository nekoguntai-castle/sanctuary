/**
 * Sync Collector
 *
 * Collects sync service health metrics.
 */

import { getSyncService } from '../../syncService';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('sync', async () => {
  try {
    const metrics = getSyncService().getHealthMetrics();
    return { metrics };
  } catch (error) {
    return { error: getErrorMessage(error), metrics: null };
  }
});
