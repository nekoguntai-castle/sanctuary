/**
 * Worker Health Collector
 *
 * Captures the API process' latest view of the background worker. Transaction
 * notifications are delivered by worker jobs, so this belongs in support bundles
 * next to queue and Telegram diagnostics.
 */

import { getWorkerHealthStatus } from '../../workerHealth';
import { registerCollector } from './registry';

registerCollector('workerHealth', async () => {
  const status = getWorkerHealthStatus();
  const commonIssues: string[] = [];

  if (!status.running) {
    commonIssues.push('Worker health monitor is not running');
  }

  if (!status.healthy) {
    commonIssues.push(`Worker is ${status.status}`);
  }

  return {
    status,
    diagnostics: {
      commonIssues,
    },
  };
});
