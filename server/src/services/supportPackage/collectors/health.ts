/**
 * Health Collector
 *
 * Reuses service-owned health check functions to include current health status.
 */

import {
  checkDatabase,
  checkDiskSpace,
  checkMemory,
  checkElectrum,
  checkWebSocket,
  checkSync,
  checkRedis,
  checkJobQueue,
} from '../../health';
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
