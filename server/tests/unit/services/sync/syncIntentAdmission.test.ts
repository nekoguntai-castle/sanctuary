import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromBullMqJobId } from '../../../../src/jobs/bullMqJobIds';

const processMocks = vi.hoisted(() => ({
  enqueueWakeup: vi.fn(),
  inspectActivation: vi.fn(),
  isLocked: vi.fn(),
}));

vi.mock('../../../../src/services/workerSyncQueue', () => ({
  enqueueIncrementalSyncWakeup: processMocks.enqueueWakeup,
}));

vi.mock('../../../../src/infrastructure/distributedLock', () => ({
  isLocked: processMocks.isLocked,
}));

vi.mock('../../../../src/services/sync/walletSyncActivationGate', () => ({
  walletSyncActivationGate: { inspect: processMocks.inspectActivation },
}));

import { syncIntentRepository } from '../../../../src/repositories/syncIntentRepository';
import type { IncrementalSyncIntentState } from '../../../../src/repositories/types';
import {
  createSyncIntentAdmission,
  incrementalSyncWakeupJobId,
  syncIntentAdmission,
} from '../../../../src/services/sync/syncIntentAdmission';
import type { WalletSyncActivationState } from '../../../../src/services/sync/walletSyncActivationGate';

const NOW = new Date('2026-08-22T07:00:00.000Z');
const ACTIVE = {
  status: 'active',
  requiredFloor: 1,
  activatedAt: '2026-08-22T06:00:00.000Z',
} satisfies WalletSyncActivationState;
const DORMANT = {
  status: 'dormant',
  requiredFloor: 1,
} satisfies WalletSyncActivationState;
const STABILIZING = {
  status: 'stabilizing',
  requiredFloor: 1,
  candidateReadySince: '2026-08-22T06:30:00.000Z',
} satisfies WalletSyncActivationState;
const FLEET_BLOCKED = {
  status: 'fleet_blocked',
  requiredFloor: 1,
  reason: 'worker_below_floor',
} satisfies WalletSyncActivationState;
const UNAVAILABLE = {
  status: 'unavailable',
  requiredFloor: 1,
  reason: 'fleet_unavailable',
} satisfies WalletSyncActivationState;
const TOKEN_A = '10000000-0000-4000-8000-000000000001';
const TOKEN_B = '20000000-0000-4000-8000-000000000002';

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
    findExpiredIncrementalSyncClaims: vi.fn(),
  } as unknown as typeof syncIntentRepository;
}

describe('syncIntentAdmission', () => {
  const enqueueWakeup = vi.fn();
  const inspectActivation = vi.fn();
  const isExecutionLockHeld = vi.fn();

  function createAdmission(repository?: ReturnType<typeof repositoryMock>) {
    return createSyncIntentAdmission({
      enqueueWakeup,
      inspectActivation,
      isExecutionLockHeld,
      ...(repository ? { repository } : {}),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    inspectActivation.mockResolvedValue(ACTIVE);
    isExecutionLockHeld.mockResolvedValue(false);
    processMocks.inspectActivation.mockResolvedValue(ACTIVE);
    processMocks.isLocked.mockResolvedValue(false);
    processMocks.enqueueWakeup.mockResolvedValue(true);
  });

  it('enqueues newly requested and merged work with one stable generation identity', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.requestIncrementalSync)
      .mockResolvedValueOnce({ status: 'requested', state: intentState() })
      .mockResolvedValueOnce({ status: 'merged', state: intentState() });
    enqueueWakeup.mockResolvedValue(true);
    const admission = createAdmission(repository);

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
    const admission = createAdmission(repository);

    await expect(admission.request('wallet-1', { now: NOW })).resolves
      .toMatchObject({ status: 'requested', wakeup: 'unavailable' });
    await expect(admission.request('wallet-1', { now: NOW })).resolves
      .toMatchObject({ status: 'requested', wakeup: 'unavailable' });
    expect(repository.requestIncrementalSync).toHaveBeenCalledTimes(2);
  });

  it('keeps newly durable intent queued when activation drifts before enqueue', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.requestIncrementalSync).mockResolvedValue({
      status: 'requested',
      state: intentState(),
    });
    inspectActivation
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(FLEET_BLOCKED);
    const admission = createAdmission(repository);

    await expect(admission.request('wallet-1', { now: NOW })).resolves.toEqual({
      status: 'requested',
      generation: 1,
      wakeup: 'unavailable',
    });
    expect(repository.requestIncrementalSync).toHaveBeenCalledOnce();
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it('best-effort wakes an already durable exact generation', async () => {
    const repository = repositoryMock();
    enqueueWakeup.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Redis down'));
    const admission = createAdmission(repository);

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
    const admission = createAdmission(repository);

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
    const admission = createAdmission(repository);

    await expect(admission.request('missing', { mode: 'explicit_reopen' }))
      .resolves.toEqual({ status: 'not_found' });
    expect(repository.requestIncrementalSync)
      .toHaveBeenCalledWith('missing', 'explicit_reopen');
  });

  it('uses the canonical repository when no repository override is supplied', async () => {
    const requestSpy = vi.spyOn(syncIntentRepository, 'requestIncrementalSync')
      .mockResolvedValueOnce({ status: 'not_found' });
    const admission = createAdmission();

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
    const admission = createAdmission(repository);

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
    const admission = createAdmission(repository);

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

  it.each([
    ['dormant', DORMANT],
    ['stabilizing', STABILIZING],
    ['fleet blocked', FLEET_BLOCKED],
    ['unavailable', UNAVAILABLE],
  ] as const)('fails closed while activation is %s', async (_label, activation) => {
    const repository = repositoryMock();
    inspectActivation.mockResolvedValue(activation);
    const admission = createAdmission(repository);
    const reclaim = {
      leaseToken: TOKEN_B,
      expectedRequestedGeneration: 1,
      claimedAt: NOW,
      leaseExpiresAt: new Date('2026-08-22T07:05:00.000Z'),
    };

    await expect(admission.request('wallet-1')).resolves.toEqual({
      status: 'blocked',
      activation,
    });
    await expect(admission.recover({ now: NOW })).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      unavailable: 0,
      activation,
    });
    await expect(admission.recoverExpired({ now: NOW })).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      locked: 0,
      unavailable: 0,
      activation,
    });
    await expect(admission.wake('wallet-1', 1)).resolves.toBe(false);
    await expect(admission.reclaimExpired('wallet-1', reclaim)).resolves.toEqual({
      status: 'blocked',
      activation,
    });
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
    expect(enqueueWakeup).not.toHaveBeenCalled();
    expect(isExecutionLockHeld).not.toHaveBeenCalled();
  });

  it('stops ordinary recovery when the live activation gate drifts between rows', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findActionableIncrementalSyncIntents).mockResolvedValue([
      intentState({ id: 'wallet-1', requestedIncrementalSyncGeneration: 2 }),
      intentState({ id: 'wallet-2', requestedIncrementalSyncGeneration: 3 }),
    ]);
    inspectActivation
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(FLEET_BLOCKED);
    enqueueWakeup.mockResolvedValue(true);
    const admission = createAdmission(repository);

    await expect(admission.recover({ now: NOW })).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      unavailable: 1,
      nextCursor: 'wallet-1',
      activation: FLEET_BLOCKED,
    });
    expect(enqueueWakeup).toHaveBeenCalledTimes(1);
    expect(enqueueWakeup).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'wallet-1',
      generation: 2,
    }));
  });

  it('does not advance an ordinary recovery cursor past a first blocked row', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findActionableIncrementalSyncIntents).mockResolvedValue([
      intentState({ id: 'wallet-2', requestedIncrementalSyncGeneration: 3 }),
      intentState({ id: 'wallet-3', requestedIncrementalSyncGeneration: 4 }),
    ]);
    inspectActivation
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(FLEET_BLOCKED);
    const admission = createAdmission(repository);

    await expect(admission.recover({ now: NOW, cursor: 'wallet-1' })).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      unavailable: 1,
      activation: FLEET_BLOCKED,
    });
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it('recovers expired rows only after an exact live lock probe', async () => {
    const repository = repositoryMock();
    const expiry = new Date('2026-08-22T06:00:00.000Z');
    vi.mocked(repository.findExpiredIncrementalSyncClaims).mockResolvedValue([
      { walletId: 'locked', generation: 1, leaseToken: TOKEN_A, leaseExpiresAt: expiry },
      { walletId: 'unknown', generation: 2, leaseToken: TOKEN_B, leaseExpiresAt: expiry },
      {
        walletId: 'available',
        generation: 3,
        leaseToken: '30000000-0000-4000-8000-000000000003',
        leaseExpiresAt: expiry,
      },
      {
        walletId: 'queue-unavailable',
        generation: 4,
        leaseToken: '40000000-0000-4000-8000-000000000004',
        leaseExpiresAt: expiry,
      },
    ]);
    isExecutionLockHeld
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    enqueueWakeup.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const admission = createAdmission(repository);

    await expect(admission.recoverExpired({ now: NOW, limit: 4 })).resolves.toEqual({
      scanned: 4,
      enqueued: 1,
      locked: 1,
      unavailable: 2,
      nextCursor: { leaseExpiresAt: expiry, walletId: 'queue-unavailable' },
    });
    expect(repository.findExpiredIncrementalSyncClaims)
      .toHaveBeenCalledWith({ now: NOW, limit: 4 });
    expect(isExecutionLockHeld.mock.calls).toEqual([
      ['locked'],
      ['unknown'],
      ['available'],
      ['queue-unavailable'],
    ]);
    expect(enqueueWakeup).toHaveBeenCalledWith({
      walletId: 'available',
      generation: 3,
      jobId: incrementalSyncWakeupJobId('available', 3),
    });
    expect(enqueueWakeup.mock.calls.every(([wakeup]) => (
      !Object.prototype.hasOwnProperty.call(wakeup, 'leaseToken')
    ))).toBe(true);
    expect(JSON.stringify(enqueueWakeup.mock.calls)).not.toContain(TOKEN_A);
    expect(JSON.stringify(enqueueWakeup.mock.calls)).not.toContain(TOKEN_B);
  });

  it('wires the process adapter through the activation and execution-lock authorities', async () => {
    const expiry = new Date('2026-08-22T06:00:00.000Z');
    const expiredSpy = vi.spyOn(syncIntentRepository, 'findExpiredIncrementalSyncClaims')
      .mockResolvedValueOnce([{
        walletId: 'wallet-1',
        generation: 1,
        leaseToken: TOKEN_A,
        leaseExpiresAt: expiry,
      }]);

    try {
      await expect(syncIntentAdmission.wake('wallet-1', 1)).resolves.toBe(true);
      await expect(syncIntentAdmission.recoverExpired({ now: NOW })).resolves.toMatchObject({
        scanned: 1,
        enqueued: 1,
      });
      expect(processMocks.inspectActivation).toHaveBeenCalledTimes(4);
      expect(processMocks.isLocked).toHaveBeenCalledWith('sync:wallet:wallet-1');
      expect(processMocks.enqueueWakeup).toHaveBeenCalledWith(expect.objectContaining({
        walletId: 'wallet-1',
        generation: 1,
      }));
    } finally {
      expiredSpy.mockRestore();
    }
  });

  it('contains per-row activation drift during expired recovery', async () => {
    const repository = repositoryMock();
    const expiry = new Date('2026-08-22T06:00:00.000Z');
    vi.mocked(repository.findExpiredIncrementalSyncClaims).mockResolvedValue([
      { walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_A, leaseExpiresAt: expiry },
      { walletId: 'wallet-2', generation: 2, leaseToken: TOKEN_B, leaseExpiresAt: expiry },
    ]);
    inspectActivation
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(FLEET_BLOCKED);
    enqueueWakeup.mockResolvedValue(true);
    const admission = createAdmission(repository);

    await expect(admission.recoverExpired({ now: NOW })).resolves.toEqual({
      scanned: 1,
      enqueued: 1,
      locked: 0,
      unavailable: 1,
      nextCursor: { leaseExpiresAt: expiry, walletId: 'wallet-1' },
      activation: FLEET_BLOCKED,
    });
    expect(isExecutionLockHeld).toHaveBeenCalledTimes(1);
    expect(isExecutionLockHeld).toHaveBeenCalledWith('wallet-1');
    expect(enqueueWakeup).toHaveBeenCalledTimes(1);
  });

  it('rechecks activation after proving an expired execution lock absent', async () => {
    const repository = repositoryMock();
    const expiry = new Date('2026-08-22T06:00:00.000Z');
    vi.mocked(repository.findExpiredIncrementalSyncClaims).mockResolvedValue([
      { walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_A, leaseExpiresAt: expiry },
    ]);
    inspectActivation
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(FLEET_BLOCKED);
    const admission = createAdmission(repository);

    await expect(admission.recoverExpired({ now: NOW })).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      locked: 0,
      unavailable: 1,
      activation: FLEET_BLOCKED,
    });
    expect(isExecutionLockHeld).toHaveBeenCalledWith('wallet-1');
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it('reclaims only the exact expired database fence after a second activation check', async () => {
    const repository = repositoryMock();
    const oldExpiry = new Date('2026-08-22T06:00:00.000Z');
    vi.mocked(repository.findIncrementalSyncIntent).mockResolvedValue(intentState({
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncLeaseToken: TOKEN_A,
      incrementalSyncLeaseExpiresAt: oldExpiry,
    }));
    vi.mocked(repository.claimIncrementalSync).mockResolvedValue({ status: 'not_claimed' });
    const admission = createAdmission(repository);
    const input = {
      leaseToken: TOKEN_B,
      expectedRequestedGeneration: 1,
      claimedAt: NOW,
      leaseExpiresAt: new Date('2026-08-22T07:05:00.000Z'),
    };

    await expect(admission.reclaimExpired('wallet-1', input)).resolves
      .toEqual({ status: 'not_claimed' });
    expect(inspectActivation).toHaveBeenCalledTimes(2);
    expect(repository.claimIncrementalSync).toHaveBeenCalledWith('wallet-1', {
      ...input,
      expectedExpiredFence: {
        walletId: 'wallet-1',
        generation: 1,
        leaseToken: TOKEN_A,
      },
    });
  });

  it.each([
    ['missing', null],
    ['wrong generation', intentState({
      claimedIncrementalSyncGeneration: 2,
      incrementalSyncLeaseToken: TOKEN_A,
      incrementalSyncLeaseExpiresAt: new Date('2026-08-22T06:00:00.000Z'),
    })],
    ['already processed', intentState({
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_A,
      incrementalSyncLeaseExpiresAt: new Date('2026-08-22T06:00:00.000Z'),
    })],
    ['missing token', intentState({
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseExpiresAt: new Date('2026-08-22T06:00:00.000Z'),
    })],
    ['missing expiry', intentState({
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_A,
    })],
    ['unexpired', intentState({
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_A,
      incrementalSyncLeaseExpiresAt: new Date('2026-08-22T08:00:00.000Z'),
    })],
  ] as const)('does not reclaim a %s claim snapshot', async (_label, state) => {
    const repository = repositoryMock();
    vi.mocked(repository.findIncrementalSyncIntent).mockResolvedValue(state);
    const admission = createAdmission(repository);

    await expect(admission.reclaimExpired('wallet-1', {
      leaseToken: TOKEN_B,
      expectedRequestedGeneration: 1,
      claimedAt: NOW,
      leaseExpiresAt: new Date('2026-08-22T07:05:00.000Z'),
    })).resolves.toEqual({ status: 'not_claimed' });
    expect(repository.claimIncrementalSync).not.toHaveBeenCalled();
    expect(inspectActivation).toHaveBeenCalledTimes(1);
  });

  it('blocks a reclaim when activation drifts after the exact expired read', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findIncrementalSyncIntent).mockResolvedValue(intentState({
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_A,
      incrementalSyncLeaseExpiresAt: new Date('2026-08-22T06:00:00.000Z'),
    }));
    inspectActivation
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce(FLEET_BLOCKED);
    const admission = createAdmission(repository);

    await expect(admission.reclaimExpired('wallet-1', {
      leaseToken: TOKEN_B,
      expectedRequestedGeneration: 1,
      claimedAt: NOW,
      leaseExpiresAt: new Date('2026-08-22T07:05:00.000Z'),
    })).resolves.toEqual({ status: 'blocked', activation: FLEET_BLOCKED });
    expect(repository.claimIncrementalSync).not.toHaveBeenCalled();
  });

  it('returns an empty recovery cursor and delegates fenced lifecycle operations', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findActionableIncrementalSyncIntents).mockResolvedValue([]);
    vi.mocked(repository.findExpiredIncrementalSyncClaims).mockResolvedValue([]);
    vi.mocked(repository.claimIncrementalSync).mockResolvedValue({ status: 'not_claimed' });
    vi.mocked(repository.completeIncrementalSync).mockResolvedValue({ status: 'lost_fence' });
    vi.mocked(repository.releaseIncrementalSyncForRetry).mockResolvedValue({ status: 'lost_fence' });
    vi.mocked(repository.releaseIncrementalSyncAsActionRequired)
      .mockResolvedValue({ status: 'lost_fence' });
    const admission = createAdmission(repository);
    const fence = { generation: 1, leaseToken: TOKEN_A };
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
    await expect(admission.recoverExpired({ now: NOW })).resolves.toEqual({
      scanned: 0,
      enqueued: 0,
      locked: 0,
      unavailable: 0,
    });
    await admission.claimFresh('wallet-1', claim);
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

  it('settles an admitted claim even when activation later becomes blocked', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.completeIncrementalSync).mockResolvedValue({ status: 'lost_fence' });
    vi.mocked(repository.releaseIncrementalSyncForRetry).mockResolvedValue({ status: 'lost_fence' });
    vi.mocked(repository.releaseIncrementalSyncAsActionRequired)
      .mockResolvedValue({ status: 'lost_fence' });
    inspectActivation.mockResolvedValue(FLEET_BLOCKED);
    const admission = createAdmission(repository);
    const fence = { generation: 1, leaseToken: TOKEN_A };

    await admission.complete('wallet-1', fence, {
      syncedAt: NOW,
      lastSyncedBlockHeight: 900_000,
    });
    await admission.releaseForRetry('wallet-1', fence, {
      releasedAt: NOW,
      nextRetryAt: new Date('2026-08-22T07:01:00.000Z'),
      errorMessage: 'retry',
      failureClass: 'other',
    });
    await admission.releaseAsActionRequired('wallet-1', fence, {
      actionRequiredAt: NOW,
      errorMessage: 'action required',
      failureClass: 'other',
    });
    expect(inspectActivation).not.toHaveBeenCalled();
    expect(repository.completeIncrementalSync).toHaveBeenCalledTimes(1);
    expect(repository.releaseIncrementalSyncForRetry).toHaveBeenCalledTimes(1);
    expect(repository.releaseIncrementalSyncAsActionRequired).toHaveBeenCalledTimes(1);
  });

  it('rejects a fresh claim before touching durable state when activation is blocked', async () => {
    const repository = repositoryMock();
    inspectActivation.mockResolvedValue(FLEET_BLOCKED);
    const admission = createAdmission(repository);
    const claim = {
      leaseToken: TOKEN_A,
      expectedRequestedGeneration: 1,
      claimedAt: NOW,
      leaseExpiresAt: new Date('2026-08-22T07:05:00.000Z'),
    };

    await expect(admission.claimFresh('wallet-1', claim)).resolves.toEqual({
      status: 'blocked',
      activation: FLEET_BLOCKED,
    });
    expect(repository.claimIncrementalSync).not.toHaveBeenCalled();
  });
});
