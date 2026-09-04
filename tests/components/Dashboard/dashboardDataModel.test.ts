import { describe, expect, it } from 'vitest';

import {
  buildNodeStatusQueryData,
  formatFeeRate,
  mapApiWalletToDashboardWallet,
  neverAnswered,
  normalizeQueryError,
  type BitcoinStatusQueryLike,
} from '../../../src/components/Dashboard/hooks/dashboardDataModel';
import type { BitcoinStatus } from '../../../src/api/bitcoin';
import type { Wallet } from '../../../src/types';

function makeQuery(overrides: Partial<BitcoinStatusQueryLike> = {}): BitcoinStatusQueryLike {
  return {
    data: undefined,
    isPlaceholderData: false,
    isLoading: false,
    error: null,
    dataUpdatedAt: 0,
    ...overrides,
  };
}

function makeStatus(overrides: Partial<BitcoinStatus> = {}): BitcoinStatus {
  return { connected: true, network: 'mainnet', ...overrides };
}

describe('formatFeeRate', () => {
  it('formats rates by magnitude', () => {
    // >= 10 rounds to a whole number; below that a decimal is worth showing.
    expect(formatFeeRate(10.6)).toBe('11');
    expect(formatFeeRate(120)).toBe('120');
    expect(formatFeeRate(9)).toBe('9');
    expect(formatFeeRate(9.2)).toBe('9.2');
    expect(formatFeeRate(0)).toBe('0');
  });

  it('renders the placeholder while a rate is absent', () => {
    expect(formatFeeRate(undefined)).toBe('---');
  });

  // `FeeEstimates` declares these fields as `number`, but the response is never
  // validated at runtime — `apiClient.get<FeeEstimates>` is an unchecked
  // assertion. A null therefore reaches this formatter as easily as a number,
  // and `null.toFixed(1)` threw inside render, taking the dashboard down.
  it('renders the placeholder for values that are not usable rates', () => {
    const unusable: unknown[] = [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const value of unusable) {
      expect(formatFeeRate(value as number | undefined)).toBe('---');
    }
  });

  it('does not throw on a non-numeric value', () => {
    expect(() => formatFeeRate('12' as unknown as number)).not.toThrow();
    expect(formatFeeRate('12' as unknown as number)).toBe('---');
  });
});

describe('neverAnswered', () => {
  it('is true only when the query failed and delivered nothing', () => {
    expect(neverAnswered(true, undefined)).toBe(true);
  });

  it('is false while a failed refetch still holds an answer', () => {
    // React Query keeps the last good data through a failed refetch. Treating
    // that as unavailable would blank a card showing perfectly good figures,
    // and would yank a genuinely new user out of the welcome state.
    expect(neverAnswered(true, [])).toBe(false);
    expect(neverAnswered(true, null)).toBe(false);
    expect(neverAnswered(true, { blocks: [] })).toBe(false);
  });

  it('is false whenever the query has not failed', () => {
    expect(neverAnswered(false, undefined)).toBe(false);
    expect(neverAnswered(undefined, undefined)).toBe(false);
    expect(neverAnswered(false, [])).toBe(false);
  });
});

describe('mapApiWalletToDashboardWallet', () => {
  it('carries the sync failure reason through the whitelist', () => {
    // The mapper is an explicit field whitelist, so anything it forgets is
    // silently unavailable to every dashboard surface downstream.
    const mapped = mapApiWalletToDashboardWallet({
      id: 'w1',
      name: 'Primary',
      type: 'single_sig',
      balance: 0,
      network: 'mainnet',
      lastSyncStatus: 'failed',
      lastSyncError: 'connect ECONNREFUSED 127.0.0.1:50002',
      lastSyncFailureClass: 'electrum_unavailable',
      lastSyncedAt: null,
      syncInProgress: false,
      syncExecutionOwner: 'worker',
      syncRetryCount: 2,
      syncNextRetryAt: '2026-08-20T12:01:00.000Z',
      syncStartedAt: null,
      syncStateVersion: 17,
      requestedIncrementalSyncGeneration: 0,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncClaimedAt: null,
      incrementalSyncLeaseExpiresAt: null,
      syncActionRequiredAt: null,
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 1,
    } as unknown as Wallet);

    expect(mapped.lastSyncError).toBe('connect ECONNREFUSED 127.0.0.1:50002');
    expect(mapped.lastSyncStatus).toBe('failed');
    expect(mapped).toMatchObject({
      lastSyncFailureClass: 'electrum_unavailable',
      syncExecutionOwner: 'worker',
      syncRetryCount: 2,
      syncNextRetryAt: '2026-08-20T12:01:00.000Z',
      syncStartedAt: null,
      syncStateVersion: 17,
      requestedIncrementalSyncGeneration: 0,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncClaimedAt: null,
      incrementalSyncLeaseExpiresAt: null,
      syncActionRequiredAt: null,
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 1,
    });
  });
});

describe('normalizeQueryError', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeQueryError(null)).toBeNull();
    expect(normalizeQueryError(undefined)).toBeNull();
  });

  it('passes an Error instance through unchanged', () => {
    const err = new Error('boom');
    expect(normalizeQueryError(err)).toBe(err);
  });

  it('wraps a non-Error value in an Error carrying its message', () => {
    const result = normalizeQueryError('plain string failure');
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toBe('plain string failure');
  });
});

describe('buildNodeStatusQueryData', () => {
  it('surfaces data when the response network matches and is not a placeholder', () => {
    const status = makeStatus({ network: 'testnet3' });
    const result = buildNodeStatusQueryData('testnet3', makeQuery({ data: status, dataUpdatedAt: 1000 }));

    expect(result).toEqual({
      network: 'testnet3',
      data: status,
      isPlaceholderData: false,
      isLoading: false,
      error: null,
      dataUpdatedAt: 1000,
    });
  });

  it('hides data and reports isPlaceholderData when the response network does not match the selected network', () => {
    // Invariant 9: previous-network data must never appear under the newly
    // selected network badge.
    const staleMainnetData = makeStatus({ network: 'mainnet' });
    const result = buildNodeStatusQueryData(
      'signet',
      makeQuery({ data: staleMainnetData, dataUpdatedAt: 5000 })
    );

    expect(result.data).toBeUndefined();
    expect(result.isPlaceholderData).toBe(true);
    expect(result.dataUpdatedAt).toBe(0);
  });

  it('hides data when React Query reports isPlaceholderData even if the network matches', () => {
    // Cross-network placeholder data from keepPreviousData carries the
    // *previous* network's shape but React Query may not yet have updated
    // `data.network` synchronously with the query key; either way, placeholder
    // data is never treated as current same-network data.
    const status = makeStatus({ network: 'testnet4' });
    const result = buildNodeStatusQueryData(
      'testnet4',
      makeQuery({ data: status, isPlaceholderData: true, dataUpdatedAt: 2000 })
    );

    expect(result.data).toBeUndefined();
    expect(result.isPlaceholderData).toBe(true);
    expect(result.dataUpdatedAt).toBe(0);
  });

  it('reports isLoading and no data before the first response', () => {
    const result = buildNodeStatusQueryData('mainnet', makeQuery({ isLoading: true }));

    expect(result).toEqual({
      network: 'mainnet',
      data: undefined,
      isPlaceholderData: true,
      isLoading: true,
      error: null,
      dataUpdatedAt: 0,
    });
  });

  it('preserves retained same-network data and surfaces the error on a transient refetch failure', () => {
    const status = makeStatus({ network: 'mainnet', connected: true });
    const err = new Error('network unreachable');
    const result = buildNodeStatusQueryData(
      'mainnet',
      makeQuery({ data: status, dataUpdatedAt: 3000, error: err })
    );

    expect(result.data).toBe(status);
    expect(result.isPlaceholderData).toBe(false);
    expect(result.dataUpdatedAt).toBe(3000);
    expect(result.error).toBe(err);
  });
});
