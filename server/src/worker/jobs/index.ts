/**
 * Worker Job Definitions Index
 *
 * All job handlers for the background worker.
 */

export { createSyncJobs } from './syncJobs';
export { notificationJobs } from './notificationJobs';
export { maintenanceJobs } from './maintenanceJobs';
export { autopilotJobs } from './autopilotJobs';
export { intelligenceJobs } from './intelligenceJobs';
export { diagnosticJobs } from './diagnosticJobs';
export { webhookDeliveryJobs } from './webhookDeliveryJobs';

import type { WorkerJobQueue } from '../workerJobQueue';
import type { WorkerJobHandler } from './types';
import type { SyncJobDependencies } from '../../jobs/syncJobContract';
import { createSyncJobs } from './syncJobs';
import { notificationJobs } from './notificationJobs';
import { maintenanceJobs } from './maintenanceJobs';
import { autopilotJobs } from './autopilotJobs';
import { intelligenceJobs } from './intelligenceJobs';
import { diagnosticJobs } from './diagnosticJobs';
import { webhookDeliveryJobs } from './webhookDeliveryJobs';

/**
 * Register all job handlers with the worker queue
 */
export function registerWorkerJobs(
  queue: WorkerJobQueue,
  dependencies: SyncJobDependencies,
): void {
  const allJobs: WorkerJobHandler<unknown, unknown>[] = [
    ...createSyncJobs(dependencies),
    ...notificationJobs,
    ...maintenanceJobs,
    ...autopilotJobs,
    ...intelligenceJobs,
    ...diagnosticJobs,
    ...webhookDeliveryJobs,
  ];

  for (const job of allJobs) {
    queue.registerHandler(job.queue, job);
  }
}
