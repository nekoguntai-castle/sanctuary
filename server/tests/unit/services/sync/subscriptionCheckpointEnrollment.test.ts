import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SubscriptionCheckpointState,
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
  };
}

function repositoryMock(): SubscriptionCheckpointEnrollmentRepositoryPort {
  return {
    findPendingSubscriptionEnrollments: vi.fn(),
    completeSubscriptionEnrollment: vi.fn(),
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
      .mockResolvedValueOnce({ status: 'applied', state: appliedState(first, STATUS_1) })
      .mockResolvedValueOnce({ status: 'applied', state: appliedState(second, null) });
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
      .mockResolvedValue({ status: 'applied', state: appliedState(first, null) });
    const enrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });

    await expect(enrollment.enrollPage({ network: 'mainnet' })).resolves.toEqual({
      scanned: 3,
      enrolled: 1,
      unavailable: 2,
      nextCursor: 'address-3',
    });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledTimes(1);
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ addressId: 'address-1', observedStatus: null }),
    );
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
      nextCursor: 'address-2',
    });
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
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
      nextCursor: 'address-1',
    });
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
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
      nextCursor: 'address-3',
    });
    expect(repository.completeSubscriptionEnrollment).toHaveBeenCalledTimes(3);
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
    const invalidNetworkEnrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
      now: () => NOW,
    });
    const invalidClockEnrollment = createSubscriptionCheckpointEnrollment({
      repository,
      subscribeBatch,
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
    expect(repository.completeSubscriptionEnrollment).not.toHaveBeenCalled();
  });
});
