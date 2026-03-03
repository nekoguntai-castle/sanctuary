/**
 * Treasury Autopilot Worker Jobs
 *
 * Two recurring jobs:
 * - Record fee snapshots every 10 minutes
 * - Evaluate all opted-in wallets every 10 minutes (offset by 5 min)
 */

import type { WorkerJobHandler } from './types';

const EVALUATE_LOCK_TTL_MS = 120_000;

export const recordFeesJob: WorkerJobHandler = {
  name: 'autopilot:record-fees',
  queue: 'maintenance',
  handler: async () => {
    const { recordFeeSnapshot } = await import('../../services/autopilot/feeMonitor');
    await recordFeeSnapshot();
  },
  options: { attempts: 2 },
};

export const evaluateJob: WorkerJobHandler = {
  name: 'autopilot:evaluate',
  queue: 'maintenance',
  handler: async () => {
    const { evaluateAllWallets } = await import('../../services/autopilot/evaluator');
    await evaluateAllWallets();
  },
  options: { attempts: 1 },
  lockOptions: {
    lockKey: () => 'autopilot:evaluate',
    lockTtlMs: EVALUATE_LOCK_TTL_MS,
  },
};

export const autopilotJobs: WorkerJobHandler<unknown, unknown>[] = [
  recordFeesJob,
  evaluateJob,
];
