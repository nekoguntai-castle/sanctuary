/**
 * Treasury Intelligence Worker Jobs
 *
 * Two recurring jobs:
 * - Analyze all opted-in wallets every 30 minutes
 * - Clean up expired insights daily at 6 AM
 */

import type { WorkerJobHandler } from './types';

const ANALYZE_LOCK_TTL_MS = 300_000; // 5 minutes

export const analyzeJob: WorkerJobHandler = {
  name: 'intelligence:analyze',
  queue: 'maintenance',
  handler: async () => {
    const { runAnalysisPipelines } = await import('../../services/intelligence/analysisService');
    await runAnalysisPipelines();
  },
  options: { attempts: 1 },
  lockOptions: {
    lockKey: () => 'intelligence:analyze',
    lockTtlMs: ANALYZE_LOCK_TTL_MS,
  },
};

export const cleanupJob: WorkerJobHandler = {
  name: 'intelligence:cleanup',
  queue: 'maintenance',
  handler: async () => {
    const { cleanupExpiredInsights } = await import('../../services/intelligence/insightService');
    await cleanupExpiredInsights();
  },
  options: { attempts: 2 },
};

export const intelligenceJobs: WorkerJobHandler<unknown, unknown>[] = [
  analyzeJob,
  cleanupJob,
];
