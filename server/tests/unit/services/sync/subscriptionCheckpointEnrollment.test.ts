import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SubscriptionCheckpointState,
  SubscriptionCheckpointSyncIntent,
  SubscriptionEnrollmentCandidate,
} from '../../../../src/repositories/types';
import { addressToScriptHash } from '../../../../src/services/bitcoin/electrum/methods';
import {
  createSubscriptionCheckpointEnrollment,
  type SubscriptionCheckpointEnrollmentRepositoryPort,
} from '../../../../src/services/sync/subscriptionCheckpointEnrollment';

const NOW = new Date('2026-08-22T12:00:00.000Z');
const ADDRESS_1 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ADDRESS_2 = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const ADDRESS_3 = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const STATUS_1 = 'a'.repeat(64);
const STATUS_2 = 'b'.repeat(64);
const STATUS_3 = 'c'.repeat(64);

function candidate(
  addressId: string,
  address: string,
  overrides: Partial<SubscriptionEnrollmentCandidate> = {},
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
    ...overrides,
  };
}

function appliedState(
  enrollment: SubscriptionEnrollmentCandidate,
  observedStatus: string | null,
): SubscriptionCheckpointState {
  return {
    addressId: enrollment.addressId,
    network: enrollment.network,
    scriptHash: addressToScriptHash(enrollment.address, 'mainnet'),
    statusKnown: true,
    observedStatus,
    lastObservedAt: NOW,
    requestedEnrollmentGeneration: enrollment.requestedEnrollmentGeneration,
    processedEnrollmentGeneration: enrollment.requestedEnrollmentGeneration,
    coverageGapStartedAt: null,
  };
}

function syncIntent(walletId: string, generation = 1): SubscriptionCheckpointSyncIntent {
  return {
    walletId,
    generation,
    state: {
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
      syncStateVersion: 1,
    },
  };
}

function repositoryMock(): SubscriptionCheckpointEnrollmentRepositoryPort {
  return {
    findPendingSubscriptionEnrollments: vi.fn(),
    completeSubscriptionEnrollment: vi.fn(),
    recordSubscriptionComparisonFailure: vi.fn().mockResolvedValue({
      status: 'recorded',
      historicalCount: 1,
    }),
  };
}

describe('subscriptionCheckpointEnrollment', () => {
  const subscribeBatch = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('enrolls one bounded network page using canonical script hashes', async () => {
    const repository = repositoryMock();
    const first = candidate('address-1', ADDRESS_1, {
      requestedEnrollmentGeneration: 3,
    });
    const second = candidate('address-2', ADDRESS_2, { checkpointMissing: true });
    vi.mocked(repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([first, second]);
    subscribeBatch.mockResolvedValue(new Map([
      [ADDRESS_1, STATUS_1],
      [ADDRESS_2, null],
    ]));
    vi.mocked(repository.completeSubscriptionEnrollment)
      .mockResolvedValueOnce({
        status: 'applied',
        state: appliedState(first, STATUS_1),
        syncIntent: syncIntent(first.walletId, 3),
      })
      .mockResolvedValueOnce({
        status: 'applied',
        state: appliedState(second, null),
        syncIntent: null,
      });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({
      network: 'mainnet',
      cursor: 'address-0',
      limit: 500,
    })).resolves.toEqual({
      scanned: 2,
      enrolled: 2,
      unavailable: 0,
      syncIntents: [syncIntent(first.walletId, 3)],
      nextCursor: 'address-2',
    });
    expect(repository.findPendingSubscriptionEnrollments).toHaveBeenCalledWith({
      network: 'mainnet',
      cursor: 'address-0',
      limit: 200,
    });
    expect(subscribeBatch).toHaveBeenCalledWith({
      network: 'mainnet',
      addresses: [ADDRESS_1, ADDRESS_2],
    });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenNthCalledWith(1, {
      addressId: 'address-1',
      address: ADDRESS_1,
      network: 'mainnet',
      generation: 3,
      scriptHash: addressToScriptHash(ADDRESS_1, 'mainnet'),
      observedStatus: STATUS_1,
      observedAt: NOW,
    });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenNthCalledWith(2, {
      addressId: 'address-2',
      address: ADDRESS_2,
      network: 'mainnet',
      generation: 1,
      scriptHash: addressToScriptHash(ADDRESS_2, 'mainnet'),
      observedStatus: null,
      observedAt: NOW,
    });
  });

  it('scopes pending enrollment to one wallet when requested', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([]);
    const enrollment = createSubscriptionCheckpointEnrollment({ repository, subscribeBatch });

    await enrollment.enrollPage({ network: 'mainnet', walletId: 'wallet-1' });

    expect(repository.findPendingSubscriptionEnrollments).toHaveBeenCalledWith({
      network: 'mainnet',
      walletId: 'wallet-1',
      limit: 200,
    });
  });

  it('stops before network work when subscription ownership is inactive', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      isActive: () => false,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      scanned: 1,
      enrolled: 0,
      unavailable: 1,
    });
    expect(subscribeBatch).not.toHaveBeenCalled();
  });

  it('does not commit observations after subscription ownership is lost', async () => {
    const repository = repositoryMock();
    const active = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    subscribeBatch.mockResolvedValue(new Map([[ADDRESS_1, STATUS_1]]));
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      isActive: active,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 0,
      unavailable: 1,
    });
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
  });

  it('stops between candidates when subscription ownership is lost mid-commit loop', async () => {
    const repository = repositoryMock();
    const first = candidate('address-1', ADDRESS_1);
    const second = candidate('address-2', ADDRESS_2);
    const active = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([first, second]);
    subscribeBatch.mockResolvedValue(new Map([
      [ADDRESS_1, STATUS_1],
      [ADDRESS_2, STATUS_2],
    ]));
    vi.mocked(repository.completeSubscriptionEnrollment).mockResolvedValueOnce({
      status: 'applied',
      state: appliedState(first, STATUS_1),
      syncIntent: null,
    });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      isActive: active,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      scanned: 2,
      enrolled: 1,
      unavailable: 1,
    });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledTimes(1);
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'address-1' }),
    );
  });

  it('persists only returned entries and leaves missing or invalid statuses unavailable', async () => {
    const repository = repositoryMock();
    const first = candidate('address-1', ADDRESS_1);
    const second = candidate('address-2', ADDRESS_2);
    const third = candidate('address-3', ADDRESS_3);
    vi.mocked(repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([first, second, third]);
    subscribeBatch.mockResolvedValue(new Map([
      [ADDRESS_1, null],
      [ADDRESS_2, undefined],
      ['unrequested-address', STATUS_3],
    ]) as unknown as Map<string, string | null>);
    vi.mocked(repository.completeSubscriptionEnrollment)
      .mockResolvedValue({
        status: 'applied', state: appliedState(first, null), syncIntent: null,
      });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 3,
      enrolled: 1,
      unavailable: 2,
      syncIntents: [],
      nextCursor: 'address-3',
    });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledTimes(1);
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'address-1', observedStatus: null }),
    );
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledTimes(2);
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenNthCalledWith(1, {
      addressId: 'address-2',
      network: 'mainnet',
      enrollmentGeneration: 1,
      failedAt: NOW,
    });
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenNthCalledWith(2, {
      addressId: 'address-3',
      network: 'mainnet',
      enrollmentGeneration: 1,
      failedAt: NOW,
    });
  });

  it('leaves the whole page pending when the batch subscription is unavailable', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
      candidate('address-2', ADDRESS_2),
    ]);
    subscribeBatch.mockRejectedValue(new Error('Electrum unavailable'));
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 2,
      enrolled: 0,
      unavailable: 2,
      syncIntents: [],
      nextCursor: 'address-2',
    });
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledTimes(2);
  });

  it('fails a non-Map batch response closed without persisting it', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    subscribeBatch.mockResolvedValue({ [ADDRESS_1]: STATUS_1 });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 1,
      enrolled: 0,
      unavailable: 1,
      syncIntents: [],
      nextCursor: 'address-1',
    });
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledOnce();
  });

  it('uses a current failure time for an invalid-only page without a clock override', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', 'not-an-address'),
    ]);
    const enrollment = createSubscriptionCheckpointEnrollment({ repository, subscribeBatch });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 0,
      unavailable: 1,
    });
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failedAt: expect.any(Date) }),
    );
  });

  it('keeps an invalid-only page pending when the failure clock is invalid', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', 'not-an-address'),
    ]);
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => new Date(Number.NaN),
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 0,
      unavailable: 1,
    });
    expect(subscribeBatch).not.toHaveBeenCalled();
    expect(repository.recordSubscriptionComparisonFailure).not.toHaveBeenCalled();
  });

  it('stops durable failure writes when subscription ownership becomes inactive', async () => {
    const repository = repositoryMock();
    const active = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', 'not-an-address'),
      candidate('address-2', 'also-not-an-address'),
    ]);
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      isActive: active,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 0,
      unavailable: 2,
    });
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledOnce();
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'address-1' }),
    );
  });

  it('uses a current failure time for a rejected batch without a clock override', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    subscribeBatch.mockRejectedValue(new Error('Electrum unavailable'));
    const enrollment = createSubscriptionCheckpointEnrollment({ repository, subscribeBatch });

    await enrollment.enrollPage({ network: 'mainnet' });

    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failedAt: expect.any(Date) }),
    );
  });

  it('uses a current failure time for a malformed batch without a clock override', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    subscribeBatch.mockResolvedValue({ [ADDRESS_1]: STATUS_1 });
    const enrollment = createSubscriptionCheckpointEnrollment({ repository, subscribeBatch });

    await enrollment.enrollPage({ network: 'mainnet' });

    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failedAt: expect.any(Date) }),
    );
  });

  it('keeps the page pending when the failure clock is invalid', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    subscribeBatch.mockRejectedValue(new Error('Electrum unavailable'));
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => new Date(Number.NaN),
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 0,
      unavailable: 1,
    });
    expect(repository.recordSubscriptionComparisonFailure).not.toHaveBeenCalled();
  });

  it('keeps a malformed batch pending when the failure clock is invalid', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    subscribeBatch.mockResolvedValue({ [ADDRESS_1]: STATUS_1 });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => new Date(Number.NaN),
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 0,
      unavailable: 1,
    });
    expect(repository.recordSubscriptionComparisonFailure).not.toHaveBeenCalled();
  });

  it('remains fail-closed when durable failure evidence cannot be written', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    vi.mocked(repository.recordSubscriptionComparisonFailure)
      .mockRejectedValue(new Error('database unavailable'));
    subscribeBatch.mockResolvedValue(new Map<string, string | null>());
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 0,
      unavailable: 1,
    });
  });

  it('continues after stale or failed completion while preserving pending work', async () => {
    const repository = repositoryMock();
    const first = candidate('address-1', ADDRESS_1);
    const second = candidate('address-2', ADDRESS_2);
    const third = candidate('address-3', ADDRESS_3);
    vi.mocked(repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([first, second, third]);
    subscribeBatch.mockResolvedValue(new Map([
      [ADDRESS_1, STATUS_1],
      [ADDRESS_2, STATUS_2],
      [ADDRESS_3, STATUS_3],
    ]));
    vi.mocked(repository.completeSubscriptionEnrollment)
      .mockResolvedValueOnce({ status: 'not_applied' })
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({
        status: 'applied',
        state: appliedState(third, STATUS_3),
        syncIntent: null,
      });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 3,
      enrolled: 1,
      unavailable: 2,
      syncIntents: [],
      nextCursor: 'address-3',
    });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledTimes(3);
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledOnce();
    expect(repository.recordSubscriptionComparisonFailure).toHaveBeenCalledWith({
      addressId: 'address-2',
      network: 'mainnet',
      enrollmentGeneration: 1,
      failedAt: NOW,
    });
  });

  it('coalesces committed wake intents by exact wallet generation', async () => {
    const repository = repositoryMock();
    const first = candidate('address-1', ADDRESS_1, { walletId: 'wallet-shared' });
    const second = candidate('address-2', ADDRESS_2, { walletId: 'wallet-shared' });
    const intent = syncIntent('wallet-shared', 4);
    vi.mocked(repository.findPendingSubscriptionEnrollments)
      .mockResolvedValue([first, second]);
    subscribeBatch.mockResolvedValue(new Map([
      [ADDRESS_1, STATUS_1],
      [ADDRESS_2, STATUS_2],
    ]));
    vi.mocked(repository.completeSubscriptionEnrollment)
      .mockResolvedValueOnce({
        status: 'applied', state: appliedState(first, STATUS_1), syncIntent: intent,
      })
      .mockResolvedValueOnce({
        status: 'applied', state: appliedState(second, STATUS_2), syncIntent: intent,
      });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toMatchObject({
      enrolled: 2,
      unavailable: 0,
      syncIntents: [intent],
    });
  });

  it('does not subscribe invalid-address or wrong-network candidates', async () => {
    const repository = repositoryMock();
    const valid = candidate('address-3', ADDRESS_1);
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', 'not-an-address'),
      candidate('address-2', ADDRESS_2, { network: 'testnet3' }),
      valid,
    ]);
    subscribeBatch.mockResolvedValue(new Map([[ADDRESS_1, STATUS_1]]));
    vi.mocked(repository.completeSubscriptionEnrollment).mockResolvedValue({
      status: 'applied',
      state: appliedState(valid, STATUS_1),
      syncIntent: null,
    });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 3,
      enrolled: 1,
      unavailable: 2,
      syncIntents: [],
      nextCursor: 'address-3',
    });
    expect(subscribeBatch).toHaveBeenCalledWith({
      network: 'mainnet',
      addresses: [ADDRESS_1],
    });
  });

  it('keeps a page with no derivable candidate unavailable without subscribing', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', 'not-an-address'),
      candidate('address-2', ADDRESS_2, { network: 'testnet3' }),
    ]);
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 2,
      enrolled: 0,
      unavailable: 2,
      syncIntents: [],
      nextCursor: 'address-2',
    });
    expect(subscribeBatch).not.toHaveBeenCalled();
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
  });

  it('does not call the subscription boundary for an empty page', async () => {
    const repository = repositoryMock();
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([]);
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 0,
      enrolled: 0,
      unavailable: 0,
      syncIntents: [],
    });
    expect(subscribeBatch).not.toHaveBeenCalled();
  });

  it('uses a current observation time when no clock override is supplied', async () => {
    const repository = repositoryMock();
    const first = candidate('address-1', ADDRESS_1);
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([first]);
    subscribeBatch.mockResolvedValue(new Map([[ADDRESS_1, STATUS_1]]));
    vi.mocked(repository.completeSubscriptionEnrollment).mockResolvedValue({
      status: 'applied',
      state: appliedState(first, STATUS_1),
      syncIntent: null,
    });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' }))
      .resolves.toMatchObject({ enrolled: 1, unavailable: 0 });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ observedAt: expect.any(Date) }),
    );
  });

  it('releases a deferred subscription baseline after enrollment persistence', async () => {
    const repository = repositoryMock();
    const first = candidate('address-1', ADDRESS_1);
    const statuses = new Map([[ADDRESS_1, STATUS_1]]);
    const releaseBatch = vi.fn();
    const serializePersistenceMock = vi.fn(
      (operation: () => Promise<unknown>) => operation(),
    );
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([first]);
    subscribeBatch.mockResolvedValue(statuses);
    vi.mocked(repository.completeSubscriptionEnrollment).mockResolvedValue({
      status: 'applied',
      state: appliedState(first, STATUS_1),
      syncIntent: null,
    });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      releaseBatch,
      serializePersistence: serializePersistenceMock as unknown as <T>(
        operation: () => Promise<T>,
      ) => Promise<T>,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' }))
      .resolves.toMatchObject({ enrolled: 1, unavailable: 0 });

    expect(releaseBatch).toHaveBeenCalledOnce();
    expect(releaseBatch).toHaveBeenCalledWith(statuses);
    expect(subscribeBatch).toHaveBeenCalledBefore(serializePersistenceMock);
    expect(serializePersistenceMock).toHaveBeenCalledBefore(
      vi.mocked(repository.completeSubscriptionEnrollment),
    );
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledBefore(releaseBatch);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid page limit %s before reading pending work',
    async (limit) => {
      const repository = repositoryMock();
      const enrollment = createSubscriptionCheckpointEnrollment({
        repository,
        subscribeBatch,
        now: () => NOW,
      });

      await expect(enrollment.enrollPage({ network: 'mainnet', limit }))
        .rejects.toThrow('positive integer');
      expect(repository.findPendingSubscriptionEnrollments).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported networks before reads and invalid clocks before persistence', async () => {
    const repository = repositoryMock();
    const releaseBatch = vi.fn();
    const invalidNetworkEnrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });
    const invalidClockEnrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      releaseBatch,
      now: () => new Date(Number.NaN),
    });

    await expect(invalidNetworkEnrollment.enrollPage({
      network: 'testnet' as 'mainnet',
    })).rejects.toThrow('supported network');
    vi.mocked(repository.findPendingSubscriptionEnrollments).mockResolvedValue([
      candidate('address-1', ADDRESS_1),
    ]);
    subscribeBatch.mockResolvedValue(new Map([[ADDRESS_1, STATUS_1]]));
    await expect(invalidClockEnrollment.enrollPage({ network: 'mainnet' }))
      .rejects.toThrow('valid date');
    expect(repository.findPendingSubscriptionEnrollments).toHaveBeenCalledTimes(1);
    expect(subscribeBatch).toHaveBeenCalledTimes(1);
    expect(releaseBatch).toHaveBeenCalledOnce();
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
  });
});
