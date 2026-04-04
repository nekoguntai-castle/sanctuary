/**
 * Intelligence Worker Jobs Tests
 *
 * Tests for the Treasury Intelligence recurring worker jobs:
 * - analyzeJob: runs analysis pipelines every 30 minutes
 * - cleanupJob: cleans up expired insights daily
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunAnalysis, mockCleanup } = vi.hoisted(() => ({
  mockRunAnalysis: vi.fn(),
  mockCleanup: vi.fn(),
}));

vi.mock('../../../../src/services/intelligence/analysisService', () => ({
  runAnalysisPipelines: mockRunAnalysis,
}));

vi.mock('../../../../src/services/intelligence/insightService', () => ({
  cleanupExpiredInsights: mockCleanup,
}));

import {
  analyzeJob,
  cleanupJob,
  intelligenceJobs,
} from '../../../../src/worker/jobs/intelligenceJobs';

describe('Intelligence Worker Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeJob', () => {
    it('has correct job metadata', () => {
      expect(analyzeJob.name).toBe('intelligence:analyze');
      expect(analyzeJob.queue).toBe('maintenance');
      expect(analyzeJob.options?.attempts).toBe(1);
    });

    it('has lock configuration with 5-minute TTL', () => {
      expect(analyzeJob.lockOptions).toBeDefined();
      expect(analyzeJob.lockOptions!.lockKey(undefined)).toBe('intelligence:analyze');
      expect(analyzeJob.lockOptions!.lockTtlMs).toBe(300_000);
    });

    it('delegates to runAnalysisPipelines', async () => {
      mockRunAnalysis.mockResolvedValueOnce(undefined);

      await analyzeJob.handler({} as any);

      expect(mockRunAnalysis).toHaveBeenCalledOnce();
    });

    it('propagates errors from runAnalysisPipelines', async () => {
      mockRunAnalysis.mockRejectedValueOnce(new Error('AI endpoint unreachable'));

      await expect(analyzeJob.handler({} as any)).rejects.toThrow('AI endpoint unreachable');
    });
  });

  describe('cleanupJob', () => {
    it('has correct job metadata', () => {
      expect(cleanupJob.name).toBe('intelligence:cleanup');
      expect(cleanupJob.queue).toBe('maintenance');
      expect(cleanupJob.options?.attempts).toBe(2);
    });

    it('has no lock configuration', () => {
      expect(cleanupJob.lockOptions).toBeUndefined();
    });

    it('delegates to cleanupExpiredInsights', async () => {
      mockCleanup.mockResolvedValueOnce(5);

      await cleanupJob.handler({} as any);

      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('propagates errors from cleanupExpiredInsights', async () => {
      mockCleanup.mockRejectedValueOnce(new Error('Database unreachable'));

      await expect(cleanupJob.handler({} as any)).rejects.toThrow('Database unreachable');
    });
  });

  describe('intelligenceJobs array', () => {
    it('exports both jobs', () => {
      expect(intelligenceJobs).toHaveLength(2);
    });

    it('contains analyzeJob and cleanupJob in order', () => {
      expect(intelligenceJobs[0]).toBe(analyzeJob);
      expect(intelligenceJobs[1]).toBe(cleanupJob);
    });

    it('all jobs target the maintenance queue', () => {
      expect(intelligenceJobs.every(j => j.queue === 'maintenance')).toBe(true);
    });

    it('lists correct job names', () => {
      expect(intelligenceJobs.map(j => j.name)).toEqual([
        'intelligence:analyze',
        'intelligence:cleanup',
      ]);
    });
  });
});
