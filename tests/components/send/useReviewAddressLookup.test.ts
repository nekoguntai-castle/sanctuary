/**
 * useReviewAddressLookup Hook Tests
 *
 * Non-regression test for `review-address-lookup-out-of-order-overwrite`:
 * the effect in useReviewAddressLookup had no cancellation guard, so a
 * slower lookup for a stale (superseded) address set could resolve after a
 * faster lookup for the current, larger address set and clobber it with
 * stale data. The contract is that the latest address set's lookup always
 * wins, regardless of resolution order.
 */
import { act,renderHook } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { OutputEntry,TransactionState } from '../../../src/contexts/send/types';

const mockLookupAddresses = vi.fn();

vi.mock('../../../src/api/bitcoin', () => ({
  lookupAddresses: (...args: unknown[]) => mockLookupAddresses(...args),
}));

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

import { useReviewAddressLookup } from '../../../src/components/send/steps/review/useReviewAddressLookup';

function outputsFor(addresses: string[]): TransactionState['outputs'] {
  return addresses.map(
    (address): OutputEntry => ({
      address,
      amount: '0.001',
    })
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useReviewAddressLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a superseded lookup that resolves after the latest lookup', async () => {
    const firstAddresses = outputsFor(['addr1']);
    const secondAddresses = outputsFor(['addr1', 'addr2']);

    const firstDeferred = createDeferred<{ lookup: Record<string, { walletId: string; walletName: string }> }>();
    const secondDeferred = createDeferred<{ lookup: Record<string, { walletId: string; walletName: string }> }>();

    mockLookupAddresses
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise);

    const { result, rerender } = renderHook(
      ({ outputs }: { outputs: TransactionState['outputs'] }) => useReviewAddressLookup(outputs, null),
      { initialProps: { outputs: firstAddresses } }
    );

    // Rerender with a larger, superseding address set before the first lookup resolves.
    rerender({ outputs: secondAddresses });

    expect(mockLookupAddresses).toHaveBeenCalledTimes(2);

    // The second (latest) lookup resolves first.
    await act(async () => {
      secondDeferred.resolve({
        lookup: {
          addr1: { walletId: 'w1', walletName: 'Wallet One' },
          addr2: { walletId: 'w2', walletName: 'Wallet Two' },
        },
      });
      await secondDeferred.promise;
    });

    expect(result.current).toEqual({
      addr1: { walletId: 'w1', walletName: 'Wallet One' },
      addr2: { walletId: 'w2', walletName: 'Wallet Two' },
    });

    // The stale first lookup resolves afterward and must be ignored.
    await act(async () => {
      firstDeferred.resolve({
        lookup: {
          addr1: { walletId: 'stale', walletName: 'Stale Wallet' },
        },
      });
      await firstDeferred.promise;
    });

    expect(result.current).toEqual({
      addr1: { walletId: 'w1', walletName: 'Wallet One' },
      addr2: { walletId: 'w2', walletName: 'Wallet Two' },
    });
  });

  it('suppresses a superseded lookup rejection instead of logging it', async () => {
    const firstAddresses = outputsFor(['addr1']);
    const secondAddresses = outputsFor(['addr1', 'addr2']);

    const firstDeferred = createDeferred<{ lookup: Record<string, { walletId: string; walletName: string }> }>();
    const secondDeferred = createDeferred<{ lookup: Record<string, { walletId: string; walletName: string }> }>();

    mockLookupAddresses
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise);

    const { rerender } = renderHook(
      ({ outputs }: { outputs: TransactionState['outputs'] }) => useReviewAddressLookup(outputs, null),
      { initialProps: { outputs: firstAddresses } }
    );

    rerender({ outputs: secondAddresses });

    await act(async () => {
      secondDeferred.resolve({
        lookup: { addr1: { walletId: 'w1', walletName: 'Wallet One' } },
      });
      await secondDeferred.promise;
    });

    // The stale first lookup rejects after being superseded; it must be
    // swallowed silently rather than logged as a real failure.
    firstDeferred.promise.catch(() => undefined);
    await act(async () => {
      firstDeferred.reject(new Error('stale failure'));
      await firstDeferred.promise.catch(() => undefined);
    });

    expect(loggerSpies.warn).not.toHaveBeenCalled();
  });
});
