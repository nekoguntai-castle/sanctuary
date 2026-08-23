import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromBullMqJobId } from '../../../../src/jobs/bullMqJobIds';
import { syncIntentRepository } from '../../../../src/repositories/syncIntentRepository';
import type { IncrementalSyncIntentState } from '../../../../src/repositories/types';
import {
  createSyncIntentAdmission,
  incrementalSyncWakeupJobId,
} from '../../../../src/services/sync/syncIntentAdmission';

const NOW = new Date('2026-08-22T07:00:00.000Z');

function intentState(
  overrides: Partial<IncrementalSyncIntentState> = {},
): IncrementalSyncIntentState {
  return {
    id: 'wallet-1',
    requestedIncrementalSyncGeneration: 1,
    claimedIncrementalSyncGeneration: 0,
    processedIncrementalSyncGeneration: 0,
    incrementalSyncLeaseToken: null,
    incrementalSyncClaimedAt: null,
    incrementalSyncLeaseExpiresAt: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncActionRequiredAt: null,
    requestedFullResyncGeneration: 0,
    preparedFullResyncGeneration: 0,
    processedFullResyncGeneration: 0,
    ...overrides,
  };
}

function repositoryMock() {
  return {
    findIncrementalSyncIntent: vi.fn(),
    requestIncrementalSync: vi.fn(),
    claimIncrementalSync: vi.fn(),
    completeIncrementalSync: vi.fn(),
    releaseIncrementalSyncForRetry: vi.fn(),
    releaseIncrementalSyncAsActionRequired: vi.fn(),
    findActionableIncrementalSyncIntents: vi.fn(),
  } as unknown as typeof syncIntentRepository;
}

describe('syncIntentAdmission', () => {
  const enqueueWakeup = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('enqueues newly requested and merged work with one stable generation identity', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.requestIncrementalSync)
      .mockResolvedValueOnce({ status: 'requested', state: intentState() })
      .mockResolvedValueOnce({ status: 'merged', state: intentState() });
    enqueueWakeup.mockResolvedValue(true);
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });

    await expect(admission.request('wallet-1', { now: NOW })).resolves.toEqual({
      status: 'requested',
      generation: 1,
      wakeup: 'enqueued',
    });
    await expect(admission.request('wallet-1', { now: NOW })).resolves.toEqual({
      status: 'merged',
      generation: 1,
      wakeup: 'enqueued',
    });
    expect(enqueueWakeup).toHaveBeenNthCalledWith(1, {
      walletId: 'wallet-1',
      generation: 1,
      jobId: incrementalSyncWakeupJobId('wallet-1', 1),
    });
    expect(enqueueWakeup.mock.calls[0]).toEqual(enqueueWakeup.mock.calls[1]);
    expect(fromBullMqJobId(enqueueWakeup.mock.calls[0][0].jobId))
      .toBe('sync:intent:wallet-1:1');
  });

  it('keeps durable intent when enqueue returns false or throws', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.requestIncrementalSync).mockResolvedValue({
      status: 'requested',
      state: intentState(),
    });
    enqueueWakeup.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Redis down'));
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });

    await expect(admission.request('wallet-1', { now: NOW })).resolves
      .toMatchObject({ status: 'requested', wakeup: 'unavailable' });
    await expect(admission.request('wallet-1', { now: NOW })).resolves
      .toMatchObject({ status: 'requested', wakeup: 'unavailable' });
    expect(repository.requestIncrementalSync).toHaveBeenCalledTimes(2);
  });

  it('best-effort wakes an already durable exact generation', async () => {
    const repository = repositoryMock();
    enqueueWakeup.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Redis down'));
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });

    await expect(admission.wake('wallet-1', 4)).resolves.toBe(true);
    await expect(admission.wake('wallet-1', 4)).resolves.toBe(false);
    expect(enqueueWakeup).toHaveBeenNthCalledWith(1, {
      walletId: 'wallet-1',
      generation: 4,
      jobId: incrementalSyncWakeupJobId('wallet-1', 4),
    });
    expect(repository.requestIncrementalSync).not.toHaveBeenCalled();
  });

  it.each([
    [
      'deferred_action_required',
      { syncActionRequiredAt: NOW },
    ],
    [
      'deferred_full_resync',
      { requestedFullResyncGeneration: 1 },
    ],
    [
      'deferred_retry',
      { syncNextRetryAt: new Date('2026-08-22T07:01:00.000Z') },
    ],
  ] as const)('does not enqueue %s work', async (wakeup, overrides) => {
    const repository = repositoryMock();
    vi.mocked(repository.requestIncrementalSync).mockResolvedValue({
      status: 'merged',
      state: intentState(overrides),
    });
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });

    await expect(admission.request('wallet-1', { now: NOW })).resolves.toEqual({
      status: 'merged',
      generation: 1,
      wakeup,
    });
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it('passes explicit reopen policy to the repository', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.requestIncrementalSync).mockResolvedValue({ status: 'not_found' });
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });

    await expect(admission.request('missing', { mode: 'explicit_reopen' }))
      .resolves.toEqual({ status: 'not_found' });
    expect(repository.requestIncrementalSync)
      .toHaveBeenCalledWith('missing', 'explicit_reopen');
  });

  it('uses the canonical repository when no repository override is supplied', async () => {
    const requestSpy = vi.spyOn(syncIntentRepository, 'requestIncrementalSync')
      .mockResolvedValueOnce({ status: 'not_found' });
    const admission = createSyncIntentAdmission({ enqueueWakeup });

    try {
      await expect(admission.request('missing')).resolves.toEqual({ status: 'not_found' });
      expect(requestSpy).toHaveBeenCalledWith('missing', 'automatic');
    } finally {
      requestSpy.mockRestore();
    }
  });

  it('uses the current time when a request does not provide one', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.requestIncrementalSync).mockResolvedValue({
      status: 'requested',
      state: intentState(),
    });
    enqueueWakeup.mockResolvedValue(true);
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });

    await expect(admission.request('wallet-1')).resolves.toEqual({
      status: 'requested',
      generation: 1,
      wakeup: 'enqueued',
    });
  });

  it('repairs a bounded page by enqueueing only stable wake-ups and never claiming', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findActionableIncrementalSyncIntents).mockResolvedValue([
      intentState({ id: 'wallet-1', requestedIncrementalSyncGeneration: 2 }),
      intentState({ id: 'wallet-2', requestedIncrementalSyncGeneration: 7 }),
    ]);
    enqueueWakeup.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Redis down'));
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });

    await expect(admission.recover({ now: NOW, cursor: 'wallet-0', limit: 20 }))
      .resolves.toEqual({
        scanned: 2,
        enqueued: 1,
        unavailable: 1,
        nextCursor: 'wallet-2',
      });
    expect(repository.findActionableIncrementalSyncIntents)
      .toHaveBeenCalledWith({ now: NOW, cursor: 'wallet-0', limit: 20 });
    expect(repository.claimIncrementalSync).not.toHaveBeenCalled();
    expect(enqueueWakeup).toHaveBeenNthCalledWith(2, expect.objectContaining({
      walletId: 'wallet-2',
      generation: 7,
    }));
  });

  it('returns an empty recovery cursor and delegates fenced lifecycle operations', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findActionableIncrementalSyncIntents).mockResolvedValue([]);
    vi.mocked(repository.claimIncrementalSync).mockResolvedValue({ status: 'not_claimed' });
    vi.mocked(repository.completeIncrementalSync).mockResolvedValue({ status: 'lost_fence' });
    vi.mocked(repository.releaseIncrementalSyncForRetry).mockResolvedValue({ status: 'lost_fence' });
    vi.mocked(repository.releaseIncrementalSyncAsActionRequired)
      .mockResolvedValue({ status: 'lost_fence' });
    const admission = createSyncIntentAdmission({ repository, enqueueWakeup });
    const fence = { generation: 1, leaseToken: '10000000-0000-4000-8000-000000000001' };
    const claim = {
      leaseToken: fence.leaseToken,
      expectedRequestedGeneration: fence.generation,
      claimedAt: NOW,
      leaseExpiresAt: new Date('2026-08-22T07:05:00.000Z'),
    };
    const success = { syncedAt: NOW, lastSyncedBlockHeight: 900_000 };
    const retry = {
      releasedAt: NOW,
      nextRetryAt: new Date('2026-08-22T07:01:00.000Z'),
      errorMessage: 'retry',
      failureClass: 'other' as const,
    };
    const actionRequired = {
      actionRequiredAt: NOW,
      errorMessage: 'action required',
      failureClass: 'other' as const,
    };

    await expect(admission.recover({ now: NOW })).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      unavailable: 0,
    });
    await admission.claim('wallet-1', claim);
    await admission.complete('wallet-1', fence, success);
    await admission.releaseForRetry('wallet-1', fence, retry);
    await admission.releaseAsActionRequired('wallet-1', fence, actionRequired);
    expect(repository.claimIncrementalSync).toHaveBeenCalledWith('wallet-1', claim);
    expect(repository.completeIncrementalSync).toHaveBeenCalledWith('wallet-1', fence, success);
    expect(repository.releaseIncrementalSyncForRetry).toHaveBeenCalledWith(
      'wallet-1', fence, retry,
    );
    expect(repository.releaseIncrementalSyncAsActionRequired)
      .toHaveBeenCalledWith('wallet-1', fence, actionRequired);
  });
});
