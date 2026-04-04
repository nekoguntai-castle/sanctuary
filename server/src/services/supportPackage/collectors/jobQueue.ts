/**
 * Job Queue Collector
 *
 * Collects background job queue health: waiting/active/failed counts,
 * registered job types, and availability. Stuck or failed jobs can
 * prevent sync from running, which means notifications never fire.
 */

import { jobQueue } from '../../../jobs';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('jobQueue', async () => {
  try {
    const available = jobQueue.isAvailable();
    if (!available) {
      return {
        available: false,
        message: 'Job queue not initialized in this process (runs in worker)',
        registeredJobs: jobQueue.getRegisteredJobs(),
      };
    }

    const health = await jobQueue.getHealth();
    return {
      available: true,
      health,
      registeredJobs: jobQueue.getRegisteredJobs(),
    };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
