import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Transaction } from '../../../types';
import { normalizeTxid } from './selectionResolution';
import {
  ACTIVE_PARAM,
  FLOATING_PARAM,
  LIST_TAB,
  MAX_OPEN_TABS,
  OPEN_PARAM,
  nextActiveAfterClose,
  parseFloatingTxids,
  parseOpenTxids,
  resolveActiveTab,
  serializeOpenTxids,
  type TabId,
} from './transactionTabsState';

interface UseTransactionTabsParams {
  /**
   * False where the caller takes selection over (the dashboard preview, console
   * results): those lists hand the click upward instead of opening a tab, and
   * must not touch the shared `?tx` parameter.
   */
  enabled: boolean;
}

/**
 * Open transaction-detail tabs, stored in the URL.
 *
 * The URL is the store rather than component state so that a reload, a
 * back-navigation and a shared link all reproduce the same set of open tabs —
 * and so a legacy single-transaction `?tx=<txid>` link still opens that
 * transaction. Positions of detached panels deliberately stay out of it: a
 * shared link should reproduce what is open, not where someone dragged it.
 */
export function useTransactionTabs({ enabled }: UseTransactionTabsParams) {
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = enabled ? searchParams.get(OPEN_PARAM) : null;
  const activeParam = enabled ? searchParams.get(ACTIVE_PARAM) : null;
  const floatingParam = enabled ? searchParams.get(FLOATING_PARAM) : null;

  const openTxids = useMemo(() => parseOpenTxids(openParam), [openParam]);
  const floatingTxids = useMemo(
    () => parseFloatingTxids(floatingParam, openTxids),
    [floatingParam, openTxids],
  );
  const activeTab = useMemo(
    () => resolveActiveTab(openTxids, activeParam, floatingTxids),
    [openTxids, activeParam, floatingTxids],
  );

  // Every writer goes through this so the two parameters can never disagree:
  // an active tab that is not open, or an `txTab` left behind by the last close.
  const writeTabs = useCallback((
    nextOpen: string[],
    nextActive: TabId,
    nextFloating: string[] = floatingTxids,
  ) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextOpen.length === 0) {
        next.delete(OPEN_PARAM);
        next.delete(ACTIVE_PARAM);
        next.delete(FLOATING_PARAM);
        return next;
      }
      next.set(OPEN_PARAM, serializeOpenTxids(nextOpen));
      next.set(ACTIVE_PARAM, nextActive);
      const floating = nextFloating.filter((txid) => nextOpen.includes(txid));
      if (floating.length === 0) next.delete(FLOATING_PARAM);
      else next.set(FLOATING_PARAM, serializeOpenTxids(floating));
      return next;
    }, { replace: true });
  }, [floatingTxids, setSearchParams]);

  const openTab = useCallback((tx: Transaction, options?: { background?: boolean }) => {
    const txid = normalizeTxid(tx.txid);
    const alreadyOpen = openTxids.includes(txid);
    // A full strip drops the oldest tab that is not the one being looked at,
    // rather than refusing to open: refusing makes a click do nothing, which
    // reads as a broken row.
    const trimmed = alreadyOpen || openTxids.length < MAX_OPEN_TABS
      ? openTxids
      : openTxids.filter((open) => open !== oldestClosable(openTxids, activeTab));
    const nextOpen = alreadyOpen ? trimmed : [...trimmed, txid];
    // Clicking the row behind a floating panel raises it rather than docking it:
    // the panel is already on screen, and pulling it back into the strip would
    // undo a placement the user chose.
    if (floatingTxids.includes(txid)) {
      writeTabs(nextOpen, activeTab, raiseFloating(floatingTxids, txid));
      return;
    }
    writeTabs(nextOpen, options?.background ? activeTab : txid);
  }, [activeTab, floatingTxids, openTxids, writeTabs]);

  const closeTab = useCallback((txid: string) => {
    const normalized = normalizeTxid(txid);
    if (!openTxids.includes(normalized)) return;
    writeTabs(
      openTxids.filter((open) => open !== normalized),
      nextActiveAfterClose(openTxids, normalized, activeTab, floatingTxids),
      floatingTxids.filter((open) => open !== normalized),
    );
  }, [activeTab, floatingTxids, openTxids, writeTabs]);

  const activateTab = useCallback((tab: TabId) => {
    if (tab === LIST_TAB) {
      // Selecting the list keeps the tabs open; only the view changes.
      if (openTxids.length === 0) return;
      writeTabs(openTxids, LIST_TAB);
      return;
    }
    if (!openTxids.includes(tab)) return;
    writeTabs(openTxids, tab);
  }, [openTxids, writeTabs]);

  const detachTab = useCallback((txid: string) => {
    const normalized = normalizeTxid(txid);
    if (!openTxids.includes(normalized) || floatingTxids.includes(normalized)) return;
    const nextFloating = [...floatingTxids, normalized];
    writeTabs(
      openTxids,
      // The strip cannot keep pointing at a tab that just left it.
      nextActiveAfterClose(openTxids, normalized, activeTab, nextFloating),
      nextFloating,
    );
  }, [activeTab, floatingTxids, openTxids, writeTabs]);

  const dockTab = useCallback((txid: string) => {
    const normalized = normalizeTxid(txid);
    if (!floatingTxids.includes(normalized)) return;
    // Docking shows what was just docked; anything else hides the panel the
    // user was reading behind whatever tab happened to be active.
    writeTabs(
      openTxids,
      normalized,
      floatingTxids.filter((open) => open !== normalized),
    );
  }, [floatingTxids, openTxids, writeTabs]);

  return {
    activateTab,
    activeTab,
    closeTab,
    detachTab,
    dockTab,
    floatingTxids,
    openTab,
    openTxids,
  };
}

/** Most recently raised last, which is the order the panels stack in. */
function raiseFloating(floatingTxids: string[], txid: string): string[] {
  return [...floatingTxids.filter((open) => open !== txid), txid];
}

/**
 * The tab the cap evicts: the oldest one that is not being read. Never the
 * active tab — dropping what someone is looking at to make room for something
 * else is the one eviction they would notice.
 */
function oldestClosable(openTxids: string[], activeTab: TabId): string {
  const [oldest, secondOldest] = openTxids;
  return oldest === activeTab ? secondOldest : oldest;
}
