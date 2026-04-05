/**
 * Health Collector
 *
 * Reuses existing health check functions to include current health status.
 */

import { checkDatabase, checkDiskSpace, checkMemory } from '../../../api/health/systemChecks';
import { checkElectrum, checkWebSocket, checkSync, checkRedis, checkJobQueue } from '../../../api/health/serviceChecks';
import { registerCollector } from './registry';

registerCollector('health', async () => {
  const [database, redis, jobQueue, disk] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkJobQueue(),
    checkDiskSpace(),
  ]);

  return {
    database,
    redis,
    electrum: checkElectrum(),
    websocket: checkWebSocket(),
    sync: checkSync(),
    jobQueue,
    memory: checkMemory(),
    disk,
  };
});
