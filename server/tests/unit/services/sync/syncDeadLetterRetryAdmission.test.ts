import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  isEnvelope: vi.fn(),
  request: vi.fn(),
  requestFullResync: vi.fn(),
}));

vi.mock('../../../../src/jobs/staleWalletJobPolicy', () => ({
  classifyStaleWalletScheduleJob: mocks.classify,
}));
vi.mock('../../../../src/services/deadLetterJobEnvelope', () => ({
  isSyncWalletEnvelope: mocks.isEnvelope,
}));
vi.mock('../../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: {
    request: mocks.request,
    requestFullResync: mocks.requestFullResync,
  },
}));

import { retryDeadLetterSyncJob } from '../../../../src/services/sync/syncDeadLetterRetryAdmission';

const envelope = (data: Record<string, unknown> = { walletId: 'wallet-1' }) => ({
  version: 1 as const,
  queue: 'sync',
  name: 'sync-wallet',
  jobId: 'job-1',
  exhaustedAttempt: 3,
  data,
  options: {},
});

describe('sync dead-letter retry admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnvelope.mockReturnValue(true);
    mocks.classify.mockReturnValue('current');
    mocks.request.mockResolvedValue({ status: 'requested', generation: 2, wakeup: 'enqueued' });
    mocks.requestFullResync.mockResolvedValue({
      status: 'requested', generation: 2, incrementalGeneration: 2, wakeup: 'enqueued',
    });
  });

  it('rejects invalid or indeterminate envelopes', async () => {
    mocks.isEnvelope.mockReturnValueOnce(false);
    await expect(retryDeadLetterSyncJob(envelope(), 'entry-1')).resolves.toBe(false);
    mocks.classify.mockReturnValueOnce('indeterminate');
    await expect(retryDeadLetterSyncJob(envelope(), 'entry-1')).resolves.toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('converts stale compatibility replay into canonical durable intent', async () => {
    mocks.classify.mockReturnValue('stale');
    await expect(retryDeadLetterSyncJob(envelope(), 'entry-1')).resolves.toBe(true);
    mocks.request.mockResolvedValueOnce({ status: 'merged', generation: 2, wakeup: 'enqueued' });
    await expect(retryDeadLetterSyncJob(envelope(), 'entry-2')).resolves.toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('wallet-1', { mode: 'explicit_reopen' });
  });

  it('reopens ordinary wallet intent through canonical admission', async () => {
    await expect(retryDeadLetterSyncJob(envelope(), 'entry-1')).resolves.toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('wallet-1', { mode: 'explicit_reopen' });
    mocks.request.mockResolvedValueOnce({ status: 'blocked' });
    await expect(retryDeadLetterSyncJob(envelope(), 'entry-2')).resolves.toBe(false);
  });

  it('routes full-resync retries through gated full-resync admission', async () => {
    await expect(retryDeadLetterSyncJob(
      envelope({ walletId: 'wallet-1', fullResync: true }),
      'entry-1',
    )).resolves.toBe(true);
    expect(mocks.requestFullResync).toHaveBeenCalledWith('wallet-1', {
      reason: 'dead-letter-retry:entry-1',
    });
    mocks.requestFullResync.mockResolvedValueOnce({
      status: 'merged', generation: 2, incrementalGeneration: 2, wakeup: 'enqueued',
    });
    await expect(retryDeadLetterSyncJob(
      envelope({ walletId: 'wallet-1', fullResync: true }),
      'entry-2',
    )).resolves.toBe(true);
  });
});
