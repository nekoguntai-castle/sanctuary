import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeWalletSubscriptionEnrollment } from '../../../src/worker/walletSubscriptionEnrollment';

function page(overrides: Record<string, unknown> = {}) {
  return {
    scanned: 0,
    enrolled: 0,
    unavailable: 0,
    syncIntents: [],
    dispatch: {
      intents: 0,
      published: 0,
      publicationFailed: 0,
      woken: 0,
      wakeUnavailable: 0,
    },
    ...overrides,
  };
}

function dependencies() {
  let serialized = 0;
  return {
    runtime: {
      enrollPendingPage: vi.fn(async () => page()),
      hasPendingWalletEnrollment: vi.fn(async () => false),
    },
    isSubscriptionOwner: vi.fn(() => true),
    ensureNetworkConnected: vi.fn(async () => undefined),
    serializeMutation: async <T>(operation: () => Promise<T>): Promise<T> => {
      serialized += 1;
      return operation();
    },
    onPageResult: vi.fn(),
    serialized: () => serialized,
  };
}

describe('completeWalletSubscriptionEnrollment', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('serially enrolls every owner page before resolving', async () => {
    const input = dependencies();
    input.runtime.enrollPendingPage
      .mockResolvedValueOnce(page({ scanned: 200, enrolled: 200, nextCursor: 'address-200' }))
      .mockResolvedValueOnce(page({ scanned: 1, enrolled: 1 }));

    await completeWalletSubscriptionEnrollment({
      walletId: 'wallet-1',
      network: 'testnet4',
      signal: new AbortController().signal,
    }, input);

    expect(input.ensureNetworkConnected).toHaveBeenCalledTimes(2);
    expect(input.serialized()).toBe(2);
    expect(input.runtime.enrollPendingPage).toHaveBeenNthCalledWith(1, {
      network: 'testnet4',
      walletId: 'wallet-1',
      limit: 200,
    });
    expect(input.runtime.enrollPendingPage).toHaveBeenNthCalledWith(2, {
      network: 'testnet4',
      walletId: 'wallet-1',
      cursor: 'address-200',
      limit: 200,
    });
    expect(input.onPageResult).toHaveBeenCalledTimes(2);
  });

  it('fails closed when an owner page remains unavailable', async () => {
    const input = dependencies();
    input.runtime.enrollPendingPage.mockResolvedValueOnce(page({
      scanned: 1,
      unavailable: 1,
    }));

    await expect(completeWalletSubscriptionEnrollment({
      walletId: 'wallet-1',
      network: 'mainnet',
      signal: new AbortController().signal,
    }, input)).rejects.toThrow('remains incomplete for wallet wallet-1');
    expect(input.onPageResult).toHaveBeenCalledOnce();
  });

  it('returns when the elected owner has already completed enrollment', async () => {
    const input = dependencies();
    input.isSubscriptionOwner.mockReturnValue(false);

    await completeWalletSubscriptionEnrollment({
      walletId: 'wallet-1',
      network: 'signet',
      signal: new AbortController().signal,
    }, input);

    expect(input.runtime.hasPendingWalletEnrollment).toHaveBeenCalledWith({
      network: 'signet',
      walletId: 'wallet-1',
    });
    expect(input.runtime.enrollPendingPage).not.toHaveBeenCalled();
  });

  it('waits for ownership and then enrolls the pending wallet', async () => {
    vi.useFakeTimers();
    const input = dependencies();
    input.isSubscriptionOwner
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    input.runtime.hasPendingWalletEnrollment.mockResolvedValueOnce(true);

    const completion = completeWalletSubscriptionEnrollment({
      walletId: 'wallet-1',
      network: 'regtest',
      signal: new AbortController().signal,
    }, input);
    await vi.advanceTimersByTimeAsync(250);

    await expect(completion).resolves.toBeUndefined();
    expect(input.runtime.enrollPendingPage).toHaveBeenCalledOnce();
  });

  it('honors an already-aborted sync attempt', async () => {
    const input = dependencies();
    const controller = new AbortController();
    controller.abort(new Error('sync attempt stopped'));

    await expect(completeWalletSubscriptionEnrollment({
      walletId: 'wallet-1',
      network: 'mainnet',
      signal: controller.signal,
    }, input)).rejects.toThrow('sync attempt stopped');
    expect(input.isSubscriptionOwner).not.toHaveBeenCalled();
  });
});
