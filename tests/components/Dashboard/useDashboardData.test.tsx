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
import {
  activitySummaryCalls,
  mockAddNotification,
  mockCheckVersion,
  mockInvalidateAllWallets,
  mockLoggerWarn,
  mockPlayEventSound,
  mockPreferences,
  mockRefetchMempool,
  mockSubscribe,
  mockSubscribeWallets,
  mockUnsubscribe,
  mockUnsubscribeWallets,
  mockUpdateWalletSyncStatus,
  recentTxCalls,
  resetState,
  state,
  wsEventHandlers,
} from './useDashboardDataHarness';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyNetworkSearchParam,
  resolveInitialNetwork,
} from '../../../src/components/Dashboard/hooks/dashboardDataModel';
import { useDashboardData } from '../../../src/components/Dashboard/hooks/useDashboardData';

describe('useDashboardData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetState();
    mockCheckVersion.mockResolvedValue({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
      releaseUrl: 'https://example.com/release',
      releaseName: 'Stability',
      publishedAt: '2026-02-01T00:00:00.000Z',
      releaseNotes: 'Test notes',
      prerelease: false,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('resolves and writes dashboard network search parameters', () => {
    expect(resolveInitialNetwork('testnet3')).toBe('testnet3');
    expect(resolveInitialNetwork('testnet')).toBe('testnet3');
    expect(resolveInitialNetwork('testnet4')).toBe('testnet4');
    expect(resolveInitialNetwork('regtest')).toBe('mainnet');

    const params = new URLSearchParams('network=testnet3&page=2');
    expect(applyNetworkSearchParam(params, 'mainnet').toString()).toBe('page=2');
    expect(applyNetworkSearchParam(params, 'signet').toString()).toBe('page=2&network=signet');
  });

  it('maps API data, derives dashboard values, and sets up subscriptions', async () => {
    const removeVisibilitySpy = vi.spyOn(document, 'removeEventListener');

    const { result, unmount } = renderHook(() => useDashboardData());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.versionInfo?.latestVersion).toBe('1.1.0');

    expect(result.current.wallets).toHaveLength(4);
    expect(result.current.filteredWallets.map(w => w.id)).toEqual([
      'w-main-high',
      'w-fallback',
      'w-main-low',
    ]);
    expect(result.current.walletCounts).toEqual({
      mainnet: 3,
      testnet3: 1,
      testnet4: 0,
      signet: 0,
    });
    expect(result.current.totalBalance).toBe(7000);
    expect(result.current.loading).toBe(false);
    expect(result.current.isMainnet).toBe(true);
    expect(state.mempoolNetworks).toContain('mainnet');

    expect(result.current.recentTx).toHaveLength(2);
    expect(result.current.recentTx[0].amount).toBe(1500);
    expect(result.current.recentTx[0].fee).toBe(100);
    expect(result.current.recentTx[0].confirmations).toBeGreaterThan(0);
    expect(result.current.recentTx[1].amount).toBe(-500);
    expect(result.current.recentTx[1].confirmations).toBe(0);
    expect(result.current.recentTx[1].isLocked).toBe(true);
    expect(result.current.recentTx[1].lockedByDraftLabel).toBe('Draft Payment');
    expect(result.current.pendingTxs).toEqual(state.pendingTxData);

    expect(result.current.fees).toEqual({ fast: 18.6, medium: 9, slow: 3.4 });
    expect(result.current.formatFeeRate(undefined)).toBe('---');
    expect(result.current.formatFeeRate(10.6)).toBe('11');
    expect(result.current.formatFeeRate(9)).toBe('9');
    expect(result.current.formatFeeRate(9.2)).toBe('9.2');

    expect(result.current.nodeStatus).toBe('connected');
    expect(result.current.mempoolBlocks).toHaveLength(3);
    expect(result.current.queuedBlocksSummary).toEqual(state.mempoolDataData.queuedBlocksSummary);
    expect(result.current.lastMempoolUpdate).not.toBeNull();
    expect(result.current.chartReady).toBe(true);
    expect(result.current.chartData).toEqual([
      { name: 'Start', sats: 5000 },
      { name: 'Now', sats: 8000 },
    ]);
    expect(result.current.priceChangePositive).toBe(true);

    expect(mockSubscribeWallets).toHaveBeenCalledWith([
      'w-main-high',
      'w-fallback',
      'w-main-low',
    ]);
    expect(mockSubscribe).toHaveBeenCalledWith('blocks');
    expect(mockSubscribe).toHaveBeenCalledWith('mempool');

    act(() => {
      result.current.refreshMempoolData();
    });
    expect(mockRefetchMempool).toHaveBeenCalledTimes(1);

    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockInvalidateAllWallets).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockInvalidateAllWallets).toHaveBeenCalled();

    unmount();
    expect(mockUnsubscribeWallets).toHaveBeenCalledWith([
      'w-main-high',
      'w-fallback',
      'w-main-low',
    ]);
    expect(mockUnsubscribe).toHaveBeenCalledWith('blocks');
    expect(mockUnsubscribe).toHaveBeenCalledWith('mempool');
    expect(removeVisibilitySpy).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function)
    );
  });

  it('splits pending totals by direction instead of netting them', () => {
    // Server sends `amount` already negative for sends. A single signed total
    // would report this pair as "nothing pending".
    state.pendingTxData = [
      { txid: 'p-in', amount: 100000 },
      { txid: 'p-out', amount: -100000 },
      { txid: 'p-out-2', amount: -25000 },
    ];

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.pendingTotals).toEqual({ incoming: 100000, outgoing: 125000 });
  });

  it('uses the active network preference for dashboard data', async () => {
    state.activeNetworkState = 'testnet3';

    const { result, rerender } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.selectedNetwork).toBe('testnet3');
    expect(result.current.isMainnet).toBe(false);
    expect(result.current.filteredWallets.map(w => w.id)).toEqual(['w-test']);
    expect(state.bitcoinStatusNetworks).toContain('testnet3');
    expect(state.mempoolNetworks).toContain('testnet3');

    act(() => {
      state.activeNetworkState = 'signet';
    });
    rerender();
    expect(result.current.selectedNetwork).toBe('signet');
    expect(state.bitcoinStatusNetworks).toContain('signet');
    expect(state.mempoolNetworks).toContain('signet');

    act(() => {
      state.activeNetworkState = 'mainnet';
    });
    rerender();
    expect(result.current.selectedNetwork).toBe('mainnet');
  });

  it('covers loading/unknown/error node status for the active mainnet view', async () => {
    state.walletsData = [];
    state.walletsLoading = true;
    state.feeEstimatesData = undefined;
    state.mempoolDataData = undefined;
    state.mempoolRefreshing = true;
    state.statusLoading = true;
    state.bitcoinStatusData = undefined;
    state.currencyState.priceChange24h = null;

    const { result, rerender } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.selectedNetwork).toBe('mainnet');
    expect(result.current.loading).toBe(true);
    expect(result.current.nodeStatus).toBe('checking');
    expect(result.current.fees).toBeNull();
    expect(result.current.mempoolBlocks).toEqual([]);
    expect(result.current.queuedBlocksSummary).toBeNull();
    expect(result.current.lastMempoolUpdate).toBeNull();
    expect(result.current.priceChangePositive).toBe(false);
    expect(result.current.mempoolRefreshing).toBe(true);

    state.statusLoading = false;
    rerender();
    expect(result.current.nodeStatus).toBe('unknown');

    state.bitcoinStatusData = { connected: false };
    rerender();
    expect(result.current.nodeStatus).toBe('error');
  });

  it('handles version-check failures by logging a warning', async () => {
    mockCheckVersion.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCheckVersion).toHaveBeenCalledTimes(1);
    expect(result.current.versionInfo).toBeNull();
    expect(mockLoggerWarn).toHaveBeenCalledWith('Failed to check for updates', {
      error: expect.any(Error),
    });
  });

  it('covers nullish query fallbacks, hidden visibility branch, and wsDisconnected reconnect branch', async () => {
    state.walletsData = null as any;
    state.recentTxData = null as any;
    state.pendingTxData = null as any;
    state.wsConnected = false;

    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.wallets).toEqual([]);
    expect(result.current.filteredWallets).toEqual([]);
    expect(result.current.recentTx).toEqual([]);
    expect(result.current.pendingTxs).toEqual([]);

    const invalidateCountBeforeVisibility = mockInvalidateAllWallets.mock.calls.length;
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(600);
    });
    expect(mockInvalidateAllWallets.mock.calls.length).toBe(invalidateCountBeforeVisibility);
  });

  it('handles websocket transaction/balance/block/confirmation/sync events', async () => {
    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.wsConnected).toBe(true);
    expect(result.current.wsState).toBe('connected');

    expect(wsEventHandlers.transaction).toBeTypeOf('function');
    expect(wsEventHandlers.balance).toBeTypeOf('function');
    expect(wsEventHandlers.block).toBeTypeOf('function');
    expect(wsEventHandlers.confirmation).toBeTypeOf('function');
    expect(wsEventHandlers.sync).toBeTypeOf('function');

    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'received',
          amount: 250000,
          confirmations: 2,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transaction',
        title: 'Bitcoin Received',
      })
    );
    expect(mockPlayEventSound).toHaveBeenCalledWith('receive');

    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'consolidation',
          amount: 120000,
          confirmations: 0,
        },
      });
    });
    expect(mockPlayEventSound).toHaveBeenCalledWith('send');

    const notificationCountBeforeSmallBalance = mockAddNotification.mock.calls.length;
    act(() => {
      wsEventHandlers.balance?.({
        data: {
          change: 9000,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledTimes(notificationCountBeforeSmallBalance);

    act(() => {
      wsEventHandlers.balance?.({
        data: {
          change: 25000,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'balance',
        title: 'Balance Updated',
      })
    );

    act(() => {
      wsEventHandlers.block?.({
        data: {
          height: 900100,
          transactionCount: 3120,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'block',
        title: 'New Block Mined',
      })
    );
    expect(mockRefetchMempool).toHaveBeenCalled();

    const soundCountBeforeConfirmations = mockPlayEventSound.mock.calls.length;
    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 0,
          confirmations: 2,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        title: 'Transaction Confirmed',
      })
    );
    expect(mockPlayEventSound).toHaveBeenCalledWith('confirmation');

    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 1,
          confirmations: 3,
        },
      });
    });
    expect(mockPlayEventSound.mock.calls.length).toBe(soundCountBeforeConfirmations + 1);

    const confirmationNoticeCount = mockAddNotification.mock.calls.length;
    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 2,
          confirmations: 2,
        },
      });
    });
    expect(mockAddNotification.mock.calls.length).toBe(confirmationNoticeCount);

    act(() => {
      wsEventHandlers.sync?.({
        data: {
          walletId: 'w-main-low',
          inProgress: false,
          status: 'success',
        },
      });
    });
    expect(mockUpdateWalletSyncStatus).toHaveBeenCalledWith('w-main-low', false, 'success');

    const syncCallCount = mockUpdateWalletSyncStatus.mock.calls.length;
    act(() => {
      wsEventHandlers.sync?.({
        data: {
          inProgress: true,
          status: 'partial',
        },
      });
    });
    expect(mockUpdateWalletSyncStatus.mock.calls.length).toBe(syncCallCount);

    expect(mockInvalidateAllWallets).toHaveBeenCalled();
  });

  it('covers websocket/event fallback branches and fee-zero transaction mapping', async () => {
    state.mempoolDataData = {
      mempool: [],
      blocks: [],
      mempoolInfo: { count: 0, size: 0, totalFees: 0 },
    };
    state.recentTxData = [
      {
        id: 'tx-fee-zero',
        txid: 'fee-zero',
        walletId: 'w-main-low',
        amount: 1000,
        fee: 0,
        confirmations: 0,
        type: 'sent',
      },
      {
        id: 'tx-null-amount',
        txid: 'null-amount',
        walletId: 'w-main-low',
        amount: null,
        fee: null,
        confirmations: 0,
        type: 'received',
      },
    ];

    const { result } = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.recentTx[0].fee).toBeUndefined();
    expect(result.current.recentTx[1].amount).toBe(0);
    expect(result.current.queuedBlocksSummary).toBeNull();
    expect(result.current.lastMempoolUpdate).not.toBeNull();

    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'sent',
          // amount + confirmations intentionally omitted for nullish fallbacks
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transaction',
        title: 'Bitcoin Sent',
      })
    );
    expect(mockPlayEventSound).toHaveBeenCalledWith('send');

    const soundCountBeforeUnknownType = mockPlayEventSound.mock.calls.length;
    act(() => {
      wsEventHandlers.transaction?.({
        data: {
          type: 'self_transfer',
          amount: 500,
        },
      });
    });
    expect(mockPlayEventSound.mock.calls.length).toBe(soundCountBeforeUnknownType);

    act(() => {
      wsEventHandlers.balance?.({ data: {} });
    });
    expect(mockInvalidateAllWallets).toHaveBeenCalled();

    act(() => {
      wsEventHandlers.balance?.({
        data: { change: -20000 },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'balance',
        message: expect.stringContaining('-'),
      })
    );

    act(() => {
      wsEventHandlers.block?.({
        data: {
          height: 900101,
          // transactionCount intentionally omitted for fallback
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'block',
        message: expect.stringContaining('0 transactions'),
      })
    );

    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 0,
          confirmations: 1,
        },
      });
    });
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirmation',
        message: '1 confirmation reached',
      })
    );

    const notifyCountBeforeNoConfirm = mockAddNotification.mock.calls.length;
    act(() => {
      wsEventHandlers.confirmation?.({
        data: {
          previousConfirmations: 0,
          // confirmations omitted => fallback to 0
        },
      });
    });
    expect(mockAddNotification.mock.calls.length).toBe(notifyCountBeforeNoConfirm);

    act(() => {
      wsEventHandlers.sync?.({
        data: {
          walletId: 'w-main-high',
          status: 'partial',
          // inProgress omitted => fallback false
        },
      });
    });
    expect(mockUpdateWalletSyncStatus).toHaveBeenCalledWith('w-main-high', false, 'partial');
  });

  describe('recent activity paging', () => {
    it('starts on the first page at the persisted page size', () => {
      mockPreferences.set('viewSettings.dashboard.activityPageSize', 20);

      const { result } = renderHook(() => useDashboardData());

      expect(result.current.activityPageSize).toBe(20);
      expect(result.current.activityPage).toBe(0);
      expect(recentTxCalls.at(-1)).toMatchObject({ pageSize: 20, page: 0 });
    });

    it('requests the page the reader moved to', () => {
      const { result } = renderHook(() => useDashboardData());

      act(() => {
        result.current.setActivityPage(2);
      });

      expect(result.current.activityPage).toBe(2);
      expect(recentTxCalls.at(-1)).toMatchObject({ page: 2 });
    });

    it('returns to the first page when the page size changes', () => {
      const { result } = renderHook(() => useDashboardData());

      act(() => {
        result.current.setActivityPage(3);
      });
      expect(result.current.activityPage).toBe(3);

      act(() => {
        result.current.setActivityPageSize(5);
      });

      // Page 4 of a 10-row paging is not page 4 of a 5-row paging, and may not
      // exist at all.
      expect(result.current.activityPage).toBe(0);
      expect(result.current.activityPageSize).toBe(5);
    });

    it('steps back rather than stranding the reader on an emptied page', async () => {
      const { result, rerender } = renderHook(() => useDashboardData());

      act(() => {
        result.current.setActivityPage(2);
      });
      expect(result.current.activityPage).toBe(2);

      // Invalidation shrank the set: this page no longer has rows. Re-render
      // rather than re-setting the page, which React would bail out of.
      state.recentTxData = [];
      await act(async () => {
        rerender();
      });

      expect(result.current.activityPage).toBeLessThan(2);
    });

    it('waits for the request to settle before stepping back', () => {
      state.recentTxFetching = true;
      state.recentTxData = [];

      const { result } = renderHook(() => useDashboardData());

      act(() => {
        result.current.setActivityPage(2);
      });

      // An in-flight page is empty because it has not arrived, not because it
      // does not exist — stepping back here would fight the reader's click.
      expect(result.current.activityPage).toBe(2);
    });
  });

  describe('activity summary', () => {
    it('surfaces the summary and its error state to the dashboard', () => {
      const { result } = renderHook(() => useDashboardData());

      expect(result.current.activitySummary).toMatchObject({ count: 3 });
      expect(result.current.activitySummaryError).toBe(false);
    });

    // The dashboard must distinguish "you have no wallets" from "we could not
    // ask": the empty case renders new-user onboarding.
    // These pin the wiring, which a component test with a mocked hook cannot.
    it('reports wallets unavailable only when no list was ever received', () => {
      state.walletsIsError = true;
      state.walletsData = undefined;
      expect(renderHook(() => useDashboardData()).result.current.walletsUnavailable).toBe(true);

      // A failed refetch still holding a list must not blank the card.
      state.walletsData = [];
      expect(renderHook(() => useDashboardData()).result.current.walletsUnavailable).toBe(false);
    });

    it('reports the mempool unavailable only when no snapshot was ever received', () => {
      state.mempoolIsError = true;
      state.mempoolDataData = undefined;
      expect(renderHook(() => useDashboardData()).result.current.mempoolUnavailable).toBe(true);

      state.mempoolDataData = { mempool: [], blocks: [], mempoolInfo: null, queuedBlocksSummary: null };
      expect(renderHook(() => useDashboardData()).result.current.mempoolUnavailable).toBe(false);
    });

    it('passes a failed aggregate through so the bar can say so', () => {
      state.activitySummaryIsError = true;
      state.activitySummaryData = undefined;

      const { result } = renderHook(() => useDashboardData());

      expect(result.current.activitySummaryError).toBe(true);
      expect(result.current.activitySummary).toBeUndefined();
    });

    it('scopes the summary to the selected period', () => {
      const { result } = renderHook(() => useDashboardData());

      expect(activitySummaryCalls.at(-1)).toEqual({ timeframe: '1W' });

      act(() => {
        result.current.setTimeframe('1Y');
      });

      // The same control drives the balance chart; the two must describe the
      // same window or the page contradicts itself.
      expect(activitySummaryCalls.at(-1)).toEqual({ timeframe: '1Y' });
    });
  });
});
