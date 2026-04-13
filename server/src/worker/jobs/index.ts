/**
 * Worker Job Definitions Index
 *
 * All job handlers for the background worker.
 */

export { syncJobs } from './syncJobs';
export { notificationJobs } from './notificationJobs';
export { maintenanceJobs } from './maintenanceJobs';
export { autopilotJobs } from './autopilotJobs';
export { intelligenceJobs } from './intelligenceJobs';
export { diagnosticJobs } from './diagnosticJobs';

import type { WorkerJobQueue } from '../workerJobQueue';
import type { WorkerJobHandler } from './types';
import { syncJobs } from './syncJobs';
import { notificationJobs } from './notificationJobs';
import { maintenanceJobs } from './maintenanceJobs';
import { autopilotJobs } from './autopilotJobs';
import { intelligenceJobs } from './intelligenceJobs';
import { diagnosticJobs } from './diagnosticJobs';

/**
 * Register all job handlers with the worker queue
 */
export function registerWorkerJobs(queue: WorkerJobQueue): void {
  const allJobs: WorkerJobHandler<unknown, unknown>[] = [
    ...syncJobs,
    ...notificationJobs,
    ...maintenanceJobs,
    ...autopilotJobs,
    ...intelligenceJobs,
    ...diagnosticJobs,
  ];

  for (const job of allJobs) {
    queue.registerHandler(job.queue, job);
  }
}
