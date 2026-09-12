/**
 * The harness import MUST stay first.
 *
 * `vi.mock` is hoisted to the top of the file that calls it, not to the top of
 * the module graph, so the harness's mocks are registered when the harness is
 * evaluated. Import anything that pulls in the real contexts ahead of it and
 * those mocks land too late: every test in this file fails with
 * "useCurrencyPreferencesContext must be used within CurrencyPreferencesProvider".
 *
 * That is a loud failure rather than a silent pass, and `tests/` is outside the
 * lint config's globs so no import sorter will rearrange it — but if you are
 * reading this because the suite went red, the order is the reason.
 */
import { resetState, state } from './useDashboardDataHarness';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardData } from '../../../src/components/Dashboard/hooks/useDashboardData';

describe('useDashboardData cross-network identity gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetState();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

    /**
     * `placeholderData: keepPreviousData` serves the previous network's payload
     * while the new query is in flight. #1008 fixed this for the node-status
     * card only; fees, mempool, wallet-detail thresholds and UTXO dust stats
     * still rendered another chain's numbers under the active network's badge.
     */
    it('does not render the previous network fee rates while the new query is in flight', () => {
      state.activeNetworkState = 'testnet4';
      state.feeEstimatesData = { fastest: 18.6, hour: 9, economy: 3.4, network: 'mainnet' };

      expect(renderHook(() => useDashboardData()).result.current.fees).toBeNull();
    });

    it('does not render a mempool snapshot belonging to another network', () => {
      state.activeNetworkState = 'testnet4';
      state.mempoolDataData = {
        mempool: [{ id: 'mp1' }],
        blocks: [{ id: 'b1' }],
        queuedBlocksSummary: null,
        network: 'mainnet',
      };

      expect(renderHook(() => useDashboardData()).result.current.mempoolBlocks).toEqual([]);
    });

    it('rejects fee rates flagged as placeholder data even when the network matches', () => {
      state.feesArePlaceholderData = true;

      expect(renderHook(() => useDashboardData()).result.current.fees).toBeNull();
    });

    it('rejects a mempool snapshot flagged as placeholder data', () => {
      state.mempoolIsPlaceholderData = true;

      expect(renderHook(() => useDashboardData()).result.current.mempoolBlocks).toEqual([]);
    });

    it('renders fees and mempool normally once the identities agree', () => {
      state.activeNetworkState = 'testnet4';
      state.feeEstimatesData = { fastest: 5, hour: 3, economy: 1, network: 'testnet4' };
      state.mempoolDataData = {
        mempool: [{ id: 'mp-tn4' }],
        blocks: [{ id: 'b-tn4' }],
        queuedBlocksSummary: null,
        network: 'testnet4',
      };

      const { result } = renderHook(() => useDashboardData());
      expect(result.current.fees).not.toBeNull();
      expect(result.current.mempoolBlocks.length).toBeGreaterThan(0);
    });
});
