import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IncrementalSyncLifecycleState,
  SubscriptionCheckpointOwner,
  SubscriptionCheckpointSyncIntent,
  SubscriptionEnrollmentCandidate,
} from '../../../src/repositories/types';
import {
  createProductionSubscriptionCheckpointRuntime,
  createSubscriptionCheckpointRuntime,
  type SubscriptionCheckpointRuntimeDependencies,
} from '../../../src/worker/subscriptionCheckpointRuntime';

const productionMocks = vi.hoisted(() => ({
  findPendingSubscriptionEnrollments: vi.fn(),
  findSubscriptionCheckpointOwners: vi.fn(),
  requestSubscriptionEnrollment: vi.fn(),
  completeSubscriptionEnrollment: vi.fn(),
  recordSubscriptionComparisonFailure: vi.fn(),
  publish: vi.fn(),
  wake: vi.fn(),
}));

vi.mock('../../../src/repositories/subscriptionCheckpointRepository', () => ({
  findPendingSubscriptionEnrollments: productionMocks.findPendingSubscriptionEnrollments,
  findSubscriptionCheckpointOwners: productionMocks.findSubscriptionCheckpointOwners,
  requestSubscriptionEnrollment: productionMocks.requestSubscriptionEnrollment,
  completeSubscriptionEnrollment: productionMocks.completeSubscriptionEnrollment,
}));

vi.mock('../../../src/repositories/subscriptionCoverageRepository', () => ({
  recordSubscriptionComparisonFailure: productionMocks.recordSubscriptionComparisonFailure,
}));

vi.mock('../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: productionMocks.publish },
}));

vi.mock('../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: { wake: productionMocks.wake },
}));

const NOW = new Date('2026-08-23T12:00:00.000Z');
const ADDRESS_1 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ADDRESS_2 = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const SCRIPT_HASH = 'a'.repeat(64);
const STATUS = 'b'.repeat(64);

function lifecycleState(
  walletId: string,
  generation: number,
): IncrementalSyncLifecycleState {
  return {
    id: walletId,
    requestedIncrementalSyncGeneration: generation,
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
    syncInProgress: false,
    lastSyncedAt: null,
    lastSyncedBlockHeight: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncExecutionOwner: null,
    syncStartedAt: null,
    syncStateVersion: generation,
  };
}

function intent(walletId: string, generation: number): SubscriptionCheckpointSyncIntent {
  return { walletId, generation, state: lifecycleState(walletId, generation) };
}

function candidate(
  addressId: string,
  address = ADDRESS_1,
): SubscriptionEnrollmentCandidate {
  return {
    addressId,
    walletId: `wallet-${addressId}`,
    address,
    network: 'mainnet',
    scriptHash: null,
    statusKnown: false,
    observedStatus: null,
    lastObservedAt: null,
    requestedEnrollmentGeneration: 1,
    processedEnrollmentGeneration: 0,
    coverageGapStartedAt: NOW,
    checkpointMissing: false,
  };
}

function owner(addressId: string, walletId: string): SubscriptionCheckpointOwner {
  return {
    addressId,
    walletId,
    address: ADDRESS_1,
    network: 'mainnet',
    scriptHash: SCRIPT_HASH,
    statusKnown: true,
    observedStatus: null,
    lastObservedAt: NOW,
    requestedEnrollmentGeneration: 1,
    processedEnrollmentGeneration: 1,
    coverageGapStartedAt: null,
  };
}

function createDependencies(): SubscriptionCheckpointRuntimeDependencies {
  return {
    repository: {
      findPendingSubscriptionEnrollments: vi.fn(),
      findSubscriptionCheckpointOwners: vi.fn(),
      requestSubscriptionEnrollment: vi.fn(),
      completeSubscriptionEnrollment: vi.fn(),
      recordSubscriptionComparisonFailure: vi.fn().mockResolvedValue({
        status: 'recorded',
        historicalCount: 1,
      }),
    },
    subscribeBatch: vi.fn(),
    publishTransition: vi.fn(),
    wake: vi.fn(),
    now: () => NOW,
  };
}

describe('subscriptionCheckpointRuntime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bounds pending enrollment and dispatches the exact committed generation', async () => {
    const dependencies = createDependencies();
    const candidates = Array.from({ length: 201 }, (_, index) => (
      candidate(`address-${String(index).padStart(3, '0')}`)
    ));
    const committed = intent('wallet-shared', 7);
    vi.mocked(dependencies.repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue(candidates);
    vi.mocked(dependencies.subscribeBatch)
      .mockResolvedValue(new Map([[ADDRESS_1, STATUS]]));
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'applied',
        state: { ...candidates[0], statusKnown: true, observedStatus: STATUS },
        syncIntent: committed,
      });
    vi.mocked(dependencies.wake).mockResolvedValue(true);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.enrollPendingPage({
      network: 'mainnet',
      limit: 500,
    })).resolves.toMatchObject({
      scanned: 200,
      enrolled: 200,
      unavailable: 0,
      syncIntents: [committed],
      dispatch: {
        intents: 1,
        published: 1,
        publicationFailed: 0,
        woken: 1,
        wakeUnavailable: 0,
      },
    });
    expect(dependencies.repository.findPendingSubscriptionEnrollments)
      .toHaveBeenCalledWith({ network: 'mainnet', limit: 200 });
    expect(dependencies.subscribeBatch).toHaveBeenCalledWith({
      network: 'mainnet',
      addresses: Array.from({ length: 200 }, () => ADDRESS_1),
    });
    expect(dependencies.publishTransition).toHaveBeenCalledWith({
      walletId: 'wallet-shared',
      transition: 'requested',
      state: committed.state,
    });
    expect(dependencies.wake).toHaveBeenCalledWith('wallet-shared', 7);
    expect(dependencies.repository.requestSubscriptionEnrollment).not.toHaveBeenCalled();
  });

  it('forwards exact wallet scope to bounded enrollment', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([]);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await runtime.enrollPendingPage({
      network: 'mainnet',
      walletId: 'wallet-1',
      cursor: 'address-previous',
    });

    expect(dependencies.repository.findPendingSubscriptionEnrollments)
      .toHaveBeenCalledWith({
        network: 'mainnet',
        walletId: 'wallet-1',
        cursor: 'address-previous',
        limit: 200,
      });
  });

  it('checks exact wallet pending state without requiring subscription ownership', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([candidate('address-1')]);
    dependencies.isActive = () => false;
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.hasPendingWalletEnrollment({
      network: 'mainnet',
      walletId: 'wallet-1',
    })).resolves.toBe(true);
    expect(dependencies.repository.findPendingSubscriptionEnrollments)
      .toHaveBeenCalledWith({ network: 'mainnet', walletId: 'wallet-1', limit: 1 });
    expect(dependencies.subscribeBatch).not.toHaveBeenCalled();
  });

  it('rejects an invalid network before checking wallet pending state', async () => {
    const dependencies = createDependencies();
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.hasPendingWalletEnrollment({
      network: 'testnet' as 'mainnet',
      walletId: 'wallet-1',
    })).rejects.toThrow('network is invalid');
    expect(dependencies.repository.findPendingSubscriptionEnrollments)
      .not.toHaveBeenCalled();
  });

  it('reports when an exact wallet has no pending checkpoint enrollment', async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([]);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.hasPendingWalletEnrollment({
      network: 'mainnet',
      walletId: 'wallet-current',
    })).resolves.toBe(false);
  });

  it('keeps missing subscription results unavailable without checkpoint completion', async () => {
    const dependencies = createDependencies();
    const first = candidate('address-1', ADDRESS_1);
    const second = candidate('address-2', ADDRESS_2);
    vi.mocked(dependencies.repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([first, second]);
    vi.mocked(dependencies.subscribeBatch)
      .mockResolvedValue(new Map([[ADDRESS_1, null]]));
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'applied',
        state: { ...first, statusKnown: true },
        syncIntent: null,
      });
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.enrollPendingPage({ network: 'mainnet' })).resolves.toMatchObject({
      scanned: 2,
      enrolled: 1,
      unavailable: 1,
      syncIntents: [],
      dispatch: { intents: 0 },
    });
    expect(dependencies.repository.completeSubscriptionEnrollment).toHaveBeenCalledOnce();
  });

  it('reports publication and wake failures without undoing committed enrollment', async () => {
    const dependencies = createDependencies();
    const pending = candidate('address-1');
    const committed = intent('wallet-1', 3);
    vi.mocked(dependencies.repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([pending]);
    vi.mocked(dependencies.subscribeBatch)
      .mockResolvedValue(new Map([[ADDRESS_1, STATUS]]));
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'applied',
        state: { ...pending, statusKnown: true, observedStatus: STATUS },
        syncIntent: committed,
      });
    vi.mocked(dependencies.publishTransition).mockRejectedValue(new Error('event unavailable'));
    vi.mocked(dependencies.wake).mockRejectedValue(new Error('queue unavailable'));
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.enrollPendingPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 1,
      dispatch: {
        intents: 1,
        published: 0,
        publicationFailed: 1,
        woken: 0,
        wakeUnavailable: 1,
      },
    });
    expect(dependencies.wake).toHaveBeenCalledWith('wallet-1', 3);
  });

  it('reports a false exact-generation wake as unavailable', async () => {
    const dependencies = createDependencies();
    const pending = candidate('address-1');
    const committed = intent('wallet-1', 5);
    vi.mocked(dependencies.repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([pending]);
    vi.mocked(dependencies.subscribeBatch)
      .mockResolvedValue(new Map([[ADDRESS_1, STATUS]]));
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'applied',
        state: { ...pending, statusKnown: true, observedStatus: STATUS },
        syncIntent: committed,
      });
    vi.mocked(dependencies.wake).mockResolvedValue(false);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.enrollPendingPage({ network: 'mainnet' })).resolves.toMatchObject({
      dispatch: { intents: 1, published: 1, woken: 0, wakeUnavailable: 1 },
    });
  });

  it('returns an empty live-owner page without reading the clock or dispatching', async () => {
    const dependencies = createDependencies();
    const now = vi.fn(() => NOW);
    dependencies.now = now;
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([]);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
    })).resolves.toEqual({
      scanned: 0,
      completed: 0,
      unavailable: 0,
      syncIntents: [],
      dispatch: {
        intents: 0,
        published: 0,
        publicationFailed: 0,
        woken: 0,
        wakeUnavailable: 0,
      },
    });
    expect(now).not.toHaveBeenCalled();
    expect(dependencies.publishTransition).not.toHaveBeenCalled();
    expect(dependencies.wake).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-date', () => 'not-a-date' as never],
    ['an invalid date', () => new Date(Number.NaN)],
  ])('rejects %s observation clock value before owner mutation', async (_label, now) => {
    const dependencies = createDependencies();
    dependencies.now = now;
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([owner('address-1', 'wallet-1')]);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    })).rejects.toThrow('clock must return a valid date');
    expect(dependencies.repository.requestSubscriptionEnrollment).not.toHaveBeenCalled();
  });

  it('processes a bounded duplicate-owner page and returns its exact continuation cursor', async () => {
    const dependencies = createDependencies();
    const owners = [owner('address-1', 'wallet-1'), owner('address-2', 'wallet-2')];
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue(owners);
    vi.mocked(dependencies.repository.requestSubscriptionEnrollment)
      .mockResolvedValueOnce({
        status: 'requested',
        state: { ...owners[0], requestedEnrollmentGeneration: 2 },
      })
      .mockResolvedValueOnce({
        status: 'requested',
        state: { ...owners[1], requestedEnrollmentGeneration: 2 },
      });
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockResolvedValueOnce({
        status: 'applied',
        state: { ...owners[0], requestedEnrollmentGeneration: 2,
          processedEnrollmentGeneration: 2, observedStatus: STATUS },
        syncIntent: intent('wallet-1', 4),
      })
      .mockResolvedValueOnce({
        status: 'applied',
        state: { ...owners[1], requestedEnrollmentGeneration: 2,
          processedEnrollmentGeneration: 2, observedStatus: STATUS },
        syncIntent: intent('wallet-2', 9),
      });
    vi.mocked(dependencies.wake).mockResolvedValue(true);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
      cursor: 'address-0',
      limit: 500,
    })).resolves.toMatchObject({
      scanned: 2,
      completed: 2,
      unavailable: 0,
      nextCursor: 'address-2',
      dispatch: { intents: 2, published: 2, woken: 2 },
    });
    expect(dependencies.repository.findSubscriptionCheckpointOwners)
      .toHaveBeenCalledWith('mainnet', SCRIPT_HASH, { cursor: 'address-0', limit: 200 });
    expect(dependencies.repository.completeSubscriptionEnrollment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        addressId: 'address-1',
        generation: 2,
        scriptHash: SCRIPT_HASH,
        observedStatus: STATUS,
        observedAt: NOW,
      }),
    );
    expect(dependencies.wake).toHaveBeenNthCalledWith(1, 'wallet-1', 4);
    expect(dependencies.wake).toHaveBeenNthCalledWith(2, 'wallet-2', 9);
  });

  it('leaves failed owner completion unavailable for later reconciliation', async () => {
    const dependencies = createDependencies();
    const first = owner('address-1', 'wallet-1');
    const second = owner('address-2', 'wallet-2');
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([first, second]);
    vi.mocked(dependencies.repository.requestSubscriptionEnrollment)
      .mockResolvedValueOnce({ status: 'not_applied' })
      .mockResolvedValueOnce({
        status: 'merged',
        state: { ...second, requestedEnrollmentGeneration: 2 },
      });
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockResolvedValue({ status: 'generation_exhausted' });
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
    })).resolves.toMatchObject({
      scanned: 2,
      completed: 0,
      unavailable: 2,
      syncIntents: [],
      dispatch: { intents: 0 },
    });
    expect(dependencies.wake).not.toHaveBeenCalled();
  });

  it('records only the exact owner generation whose completion throws', async () => {
    const dependencies = createDependencies();
    const first = owner('address-1', 'wallet-1');
    const second = owner('address-2', 'wallet-2');
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([first, second]);
    vi.mocked(dependencies.repository.requestSubscriptionEnrollment)
      .mockResolvedValueOnce({
        status: 'requested',
        state: { ...first, requestedEnrollmentGeneration: 2 },
      })
      .mockResolvedValueOnce({
        status: 'requested',
        state: { ...second, requestedEnrollmentGeneration: 2 },
      });
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockRejectedValueOnce(new Error('comparison write failed'))
      .mockResolvedValueOnce({
        status: 'applied',
        state: {
          ...second,
          requestedEnrollmentGeneration: 2,
          processedEnrollmentGeneration: 2,
          coverageGapStartedAt: null,
        },
        syncIntent: null,
      });
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    })).resolves.toMatchObject({ completed: 1, unavailable: 1 });
    expect(dependencies.repository.recordSubscriptionComparisonFailure).toHaveBeenCalledOnce();
    expect(dependencies.repository.recordSubscriptionComparisonFailure).toHaveBeenCalledWith({
      addressId: 'address-1',
      network: 'mainnet',
      enrollmentGeneration: 2,
      failedAt: NOW,
    });
  });

  it('keeps completion unavailable when durable failure evidence also rejects', async () => {
    const dependencies = createDependencies();
    const currentOwner = owner('address-1', 'wallet-1');
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([currentOwner]);
    vi.mocked(dependencies.repository.requestSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'requested',
        state: { ...currentOwner, requestedEnrollmentGeneration: 2 },
      });
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockRejectedValue(new Error('completion unavailable'));
    vi.mocked(dependencies.repository.recordSubscriptionComparisonFailure)
      .mockRejectedValue(new Error('evidence unavailable'));
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    })).resolves.toMatchObject({
      scanned: 1,
      completed: 0,
      unavailable: 1,
      syncIntents: [],
    });
    expect(dependencies.repository.recordSubscriptionComparisonFailure).toHaveBeenCalledWith({
      addressId: 'address-1',
      network: 'mainnet',
      enrollmentGeneration: 2,
      failedAt: NOW,
    });
  });

  it('counts an applied status checkpoint without a sync intent as completed', async () => {
    const dependencies = createDependencies();
    const currentOwner = owner('address-1', 'wallet-1');
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([currentOwner]);
    vi.mocked(dependencies.repository.requestSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'requested',
        state: { ...currentOwner, requestedEnrollmentGeneration: 2 },
      });
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'applied',
        state: {
          ...currentOwner,
          requestedEnrollmentGeneration: 2,
          processedEnrollmentGeneration: 2,
        },
        syncIntent: null,
      });
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
    })).resolves.toMatchObject({
      scanned: 1,
      completed: 1,
      unavailable: 0,
      syncIntents: [],
      dispatch: { intents: 0 },
    });
  });

  it('recovers the same authoritative status after an initial request failure', async () => {
    const dependencies = createDependencies();
    const checkpointOwner = owner('address-1', 'wallet-1');
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([checkpointOwner]);
    vi.mocked(dependencies.repository.requestSubscriptionEnrollment)
      .mockRejectedValueOnce(new Error('checkpoint database unavailable'))
      .mockResolvedValueOnce({
        status: 'requested',
        state: { ...checkpointOwner, requestedEnrollmentGeneration: 2 },
      });
    vi.mocked(dependencies.repository.completeSubscriptionEnrollment).mockResolvedValueOnce({
      status: 'applied',
      state: {
        ...checkpointOwner,
        requestedEnrollmentGeneration: 2,
        processedEnrollmentGeneration: 2,
        observedStatus: STATUS,
      },
      syncIntent: intent('wallet-1', 2),
    });
    vi.mocked(dependencies.wake).mockResolvedValue(true);
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    })).resolves.toMatchObject({
      scanned: 1,
      completed: 0,
      unavailable: 1,
      syncIntents: [],
    });
    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    })).resolves.toMatchObject({
      scanned: 1,
      completed: 1,
      unavailable: 0,
      dispatch: { intents: 1, published: 1, woken: 1 },
    });
  });

  it('stops duplicate-owner mutation after subscription ownership is lost', async () => {
    const dependencies = createDependencies();
    const active = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    dependencies.isActive = active;
    vi.mocked(dependencies.repository.findSubscriptionCheckpointOwners)
      .mockResolvedValue([owner('address-1', 'wallet-1'), owner('address-2', 'wallet-2')]);
    vi.mocked(dependencies.repository.requestSubscriptionEnrollment)
      .mockResolvedValue({ status: 'not_applied' });
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    })).resolves.toMatchObject({ scanned: 2, completed: 0, unavailable: 2 });
    expect(dependencies.repository.requestSubscriptionEnrollment).toHaveBeenCalledOnce();
  });

  it.each([
    [{ network: 'testnet' }, 'network'],
    [{ scriptHash: 'not-a-hash' }, 'script hash'],
    [{ observedStatus: 'invalid' }, 'status'],
    [{ limit: 0 }, 'positive integer'],
  ])('rejects invalid live observation input %#', async (override, message) => {
    const dependencies = createDependencies();
    const runtime = createSubscriptionCheckpointRuntime(dependencies);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      ...override,
    } as Parameters<typeof runtime.recordStatusPage>[0])).rejects.toThrow(message);
    expect(dependencies.repository.findSubscriptionCheckpointOwners).not.toHaveBeenCalled();
  });

  it('production composition forwards exact lifecycle publication and wake callbacks', async () => {
    const currentOwner = owner('address-production', 'wallet-production');
    const committed = intent('wallet-production', 11);
    productionMocks.findSubscriptionCheckpointOwners.mockResolvedValue([currentOwner]);
    productionMocks.requestSubscriptionEnrollment.mockResolvedValue({
      status: 'requested',
      state: { ...currentOwner, requestedEnrollmentGeneration: 2 },
    });
    productionMocks.completeSubscriptionEnrollment.mockResolvedValue({
      status: 'applied',
      state: {
        ...currentOwner,
        requestedEnrollmentGeneration: 2,
        processedEnrollmentGeneration: 2,
        observedStatus: STATUS,
      },
      syncIntent: committed,
    });
    productionMocks.publish.mockResolvedValue(undefined);
    productionMocks.wake.mockResolvedValue(true);
    const subscribeBatch = vi.fn();
    const isActive = vi.fn(() => true);
    const runtime = createProductionSubscriptionCheckpointRuntime(subscribeBatch, isActive);

    await expect(runtime.recordStatusPage({
      network: 'mainnet',
      scriptHash: SCRIPT_HASH,
      observedStatus: STATUS,
    })).resolves.toMatchObject({
      completed: 1,
      dispatch: { published: 1, woken: 1 },
    });
    expect(productionMocks.publish).toHaveBeenCalledWith({
      walletId: 'wallet-production',
      transition: 'requested',
      state: committed.state,
    });
    expect(productionMocks.wake).toHaveBeenCalledWith('wallet-production', 11);
    expect(isActive).toHaveBeenCalled();
  });
});
