import { describe, expect, it } from 'vitest';
import { resumeRetryCount } from '../../../../src/services/sync/retryLadder';

describe('resumeRetryCount', () => {
  it('resumes an inline retry from structured persisted state', () => {
    expect(resumeRetryCount({
      lastSyncStatus: 'retrying',
      syncExecutionOwner: 'inline',
      syncRetryCount: 2,
    }, 3)).toBe(2);
  });

  it('does not resume worker-owned or terminal state', () => {
    expect(resumeRetryCount({
      lastSyncStatus: 'retrying',
      syncExecutionOwner: 'worker',
      syncRetryCount: 2,
    }, 3)).toBe(0);
    expect(resumeRetryCount({
      lastSyncStatus: 'failed',
      syncExecutionOwner: 'inline',
      syncRetryCount: 2,
    }, 3)).toBe(0);
  });

  it('does not infer ownership for legacy rows', () => {
    expect(resumeRetryCount({
      lastSyncStatus: 'retrying',
      syncExecutionOwner: null,
      syncRetryCount: 2,
    }, 3)).toBe(0);
    expect(resumeRetryCount(null, 3)).toBe(0);
    expect(resumeRetryCount(undefined, 3)).toBe(0);
  });

  it('caps persisted retry count at the configured maximum', () => {
    expect(resumeRetryCount({
      lastSyncStatus: 'retrying',
      syncExecutionOwner: 'inline',
      syncRetryCount: 99,
    }, 3)).toBe(3);
  });

  it('rejects invalid structured retry counts defensively', () => {
    for (const syncRetryCount of [-1, 1.5, Number.NaN]) {
      expect(resumeRetryCount({
        lastSyncStatus: 'retrying',
        syncExecutionOwner: 'inline',
        syncRetryCount,
      }, 3)).toBe(0);
    }
  });
});
