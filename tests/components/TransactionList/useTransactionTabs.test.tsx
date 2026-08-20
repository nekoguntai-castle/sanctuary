import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useTransactionTabs } from '../../../src/components/TransactionList/hooks/useTransactionTabs';
import {
  LIST_TAB,
  MAX_OPEN_TABS,
} from '../../../src/components/TransactionList/hooks/transactionTabsState';
import type { Transaction } from '../../../src/types';

const txid = (marker: string) => marker.repeat(64);
const A = txid('a');
const B = txid('b');
const C = txid('c');

const tx = (id: string): Transaction => ({
  id: `row-${id.slice(0, 4)}`,
  txid: id,
  walletId: 'wallet-1',
  amount: 1000,
  confirmations: 1,
  labels: [],
} as Transaction);

const wrapperFor = (entry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };

function renderTabs(entry = '/', enabled = true) {
  return renderHook(
    () => {
      const tabs = useTransactionTabs({ enabled });
      const [params] = useSearchParams();
      return { tabs, params };
    },
    { wrapper: wrapperFor(entry) },
  );
}

describe('useTransactionTabs', () => {
  it('opens a tab and makes it active, recording both in the URL', () => {
    const { result } = renderTabs();

    act(() => result.current.tabs.openTab(tx(A)));

    expect(result.current.tabs.openTxids).toEqual([A]);
    expect(result.current.tabs.activeTab).toBe(A);
    expect(result.current.params.get('tx')).toBe(A);
    expect(result.current.params.get('txTab')).toBe(A);
  });

  it('opens further tabs after the first, in click order', () => {
    const { result } = renderTabs();

    act(() => result.current.tabs.openTab(tx(A)));
    act(() => result.current.tabs.openTab(tx(B)));

    expect(result.current.tabs.openTxids).toEqual([A, B]);
    expect(result.current.tabs.activeTab).toBe(B);
  });

  it('focuses the existing tab when the same transaction is opened again', () => {
    // Clicking a row whose tab is already open should not open a second
    // identical tab; it should bring the one that exists forward.
    const { result } = renderTabs();

    act(() => result.current.tabs.openTab(tx(A)));
    act(() => result.current.tabs.openTab(tx(B)));
    act(() => result.current.tabs.openTab(tx(A)));

    expect(result.current.tabs.openTxids).toEqual([A, B]);
    expect(result.current.tabs.activeTab).toBe(A);
  });

  it('opens in the background without leaving the current tab', () => {
    const { result } = renderTabs();

    act(() => result.current.tabs.openTab(tx(A)));
    act(() => result.current.tabs.openTab(tx(B), { background: true }));

    expect(result.current.tabs.openTxids).toEqual([A, B]);
    expect(result.current.tabs.activeTab).toBe(A);
  });

  it('normalizes the txid it is handed, so case never opens a second tab', () => {
    const { result } = renderTabs();

    act(() => result.current.tabs.openTab(tx(A.toUpperCase())));
    act(() => result.current.tabs.openTab(tx(A)));

    expect(result.current.tabs.openTxids).toEqual([A]);
  });

  it('activates the list without closing anything', () => {
    const { result } = renderTabs();
    act(() => result.current.tabs.openTab(tx(A)));

    act(() => result.current.tabs.activateTab(LIST_TAB));

    expect(result.current.tabs.activeTab).toBe(LIST_TAB);
    expect(result.current.tabs.openTxids).toEqual([A]);
    expect(result.current.params.get('tx')).toBe(A);
  });

  it('ignores activation of a tab that is not open', () => {
    const { result } = renderTabs();
    act(() => result.current.tabs.openTab(tx(A)));

    act(() => result.current.tabs.activateTab(B));

    expect(result.current.tabs.activeTab).toBe(A);
  });

  it('ignores a list activation when there is nothing open, leaving the URL clean', () => {
    const { result } = renderTabs();

    act(() => result.current.tabs.activateTab(LIST_TAB));

    expect(result.current.params.get('txTab')).toBeNull();
  });

  it('moves to the neighbouring tab when the active one closes', () => {
    const { result } = renderTabs();
    act(() => result.current.tabs.openTab(tx(A)));
    act(() => result.current.tabs.openTab(tx(B)));
    act(() => result.current.tabs.openTab(tx(C)));
    act(() => result.current.tabs.activateTab(B));

    act(() => result.current.tabs.closeTab(B));

    expect(result.current.tabs.openTxids).toEqual([A, C]);
    expect(result.current.tabs.activeTab).toBe(C);
  });

  it('drops both parameters when the last tab closes', () => {
    // A stale `txTab` left behind would make the next opened tab inherit an
    // active tab that no longer exists.
    const { result } = renderTabs();
    act(() => result.current.tabs.openTab(tx(A)));

    act(() => result.current.tabs.closeTab(A));

    expect(result.current.tabs.openTxids).toEqual([]);
    expect(result.current.tabs.activeTab).toBe(LIST_TAB);
    expect(result.current.params.get('tx')).toBeNull();
    expect(result.current.params.get('txTab')).toBeNull();
  });

  it('ignores a close for a tab that is not open', () => {
    const { result } = renderTabs();
    act(() => result.current.tabs.openTab(tx(A)));

    act(() => result.current.tabs.closeTab(B));

    expect(result.current.tabs.openTxids).toEqual([A]);
  });

  it('keeps other query parameters intact', () => {
    const { result } = renderTabs('/?view=compact');

    act(() => result.current.tabs.openTab(tx(A)));
    expect(result.current.params.get('view')).toBe('compact');

    act(() => result.current.tabs.closeTab(A));
    expect(result.current.params.get('view')).toBe('compact');
  });

  it('opens a legacy single-transaction deep link straight onto its detail', () => {
    const { result } = renderTabs(`/?tx=${A}`);

    expect(result.current.tabs.openTxids).toEqual([A]);
    expect(result.current.tabs.activeTab).toBe(A);
  });

  it('restores a multi-tab link, including which tab was showing', () => {
    const { result } = renderTabs(`/?tx=${A},${B}&txTab=${B}`);

    expect(result.current.tabs.openTxids).toEqual([A, B]);
    expect(result.current.tabs.activeTab).toBe(B);
  });

  it('drops the oldest inactive tab rather than refusing to open past the cap', () => {
    // Refusing would make a row click do nothing, which reads as a broken row.
    const { result } = renderTabs();
    const opened = Array.from({ length: MAX_OPEN_TABS }, (_, index) =>
      String(index).padStart(64, '0'));
    for (const id of opened) {
      act(() => result.current.tabs.openTab(tx(id)));
    }
    expect(result.current.tabs.openTxids).toHaveLength(MAX_OPEN_TABS);

    act(() => result.current.tabs.openTab(tx(C)));

    expect(result.current.tabs.openTxids).toHaveLength(MAX_OPEN_TABS);
    expect(result.current.tabs.openTxids).toContain(C);
    expect(result.current.tabs.openTxids).not.toContain(opened[0]);
  });

  it('keeps the tab being read when the cap evicts one', () => {
    const { result } = renderTabs();
    const opened = Array.from({ length: MAX_OPEN_TABS }, (_, index) =>
      String(index).padStart(64, '0'));
    for (const id of opened) {
      act(() => result.current.tabs.openTab(tx(id)));
    }
    act(() => result.current.tabs.activateTab(opened[0]));

    act(() => result.current.tabs.openTab(tx(C)));

    expect(result.current.tabs.openTxids).toContain(opened[0]);
    expect(result.current.tabs.openTxids).not.toContain(opened[1]);
  });

  it('stays out of the URL entirely when the caller owns selection', () => {
    // The dashboard preview and console results hand clicks upward; they must
    // not read or write the shared ?tx parameter.
    const { result } = renderTabs(`/?tx=${A}`, false);

    expect(result.current.tabs.openTxids).toEqual([]);
    expect(result.current.tabs.activeTab).toBe(LIST_TAB);
  });

  describe('detaching and docking', () => {
    it('detaches a tab into a floating panel and moves the strip off it', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.openTab(tx(B)));

      act(() => result.current.tabs.detachTab(B));

      expect(result.current.tabs.floatingTxids).toEqual([B]);
      expect(result.current.tabs.openTxids).toEqual([A, B]);
      expect(result.current.tabs.activeTab).toBe(A);
      expect(result.current.params.get('txWin')).toBe(B);
    });

    it('shows the list when the only open tab detaches', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));

      act(() => result.current.tabs.detachTab(A));

      expect(result.current.tabs.activeTab).toBe(LIST_TAB);
    });

    it('docks a panel back and shows what was just docked', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.detachTab(A));

      act(() => result.current.tabs.dockTab(A));

      expect(result.current.tabs.floatingTxids).toEqual([]);
      expect(result.current.tabs.activeTab).toBe(A);
      expect(result.current.params.get('txWin')).toBeNull();
    });

    it('ignores detaching a tab that is not open, or already floating', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));

      act(() => result.current.tabs.detachTab(B));
      expect(result.current.tabs.floatingTxids).toEqual([]);

      act(() => result.current.tabs.detachTab(A));
      act(() => result.current.tabs.detachTab(A));
      expect(result.current.tabs.floatingTxids).toEqual([A]);
    });

    it('ignores docking a tab that is not floating', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));

      act(() => result.current.tabs.dockTab(A));

      expect(result.current.tabs.activeTab).toBe(A);
      expect(result.current.tabs.floatingTxids).toEqual([]);
    });

    it('raises a floating panel when its row is clicked again, without docking it', () => {
      // The panel is already on screen; pulling it back into the strip would
      // undo a placement the user chose.
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.openTab(tx(B)));
      act(() => result.current.tabs.detachTab(A));
      act(() => result.current.tabs.detachTab(B));
      expect(result.current.tabs.floatingTxids).toEqual([A, B]);

      act(() => result.current.tabs.openTab(tx(A)));

      expect(result.current.tabs.floatingTxids).toEqual([B, A]);
      expect(result.current.tabs.activeTab).toBe(LIST_TAB);
    });

    it('drops a floating panel when its tab closes', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.openTab(tx(B)));
      act(() => result.current.tabs.detachTab(A));

      act(() => result.current.tabs.closeTab(A));

      expect(result.current.tabs.floatingTxids).toEqual([]);
      expect(result.current.tabs.openTxids).toEqual([B]);
      expect(result.current.params.get('txWin')).toBeNull();
    });

    it('restores detached panels from a link', () => {
      const { result } = renderTabs(`/?tx=${A},${B}&txWin=${A}&txTab=${B}`);

      expect(result.current.tabs.floatingTxids).toEqual([A]);
      expect(result.current.tabs.activeTab).toBe(B);
    });

    it('clears every parameter when the last tab closes', () => {
      const { result } = renderTabs(`/?tx=${A}&txWin=${A}`);

      act(() => result.current.tabs.closeTab(A));

      expect(result.current.params.get('tx')).toBeNull();
      expect(result.current.params.get('txTab')).toBeNull();
      expect(result.current.params.get('txWin')).toBeNull();
    });
  });

  describe('reordering', () => {
    it('rewrites the open order, so a reordered strip survives a reload', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.openTab(tx(B)));
      act(() => result.current.tabs.openTab(tx(C)));

      act(() => result.current.tabs.reorderTab(A, C));

      expect(result.current.tabs.openTxids).toEqual([B, C, A]);
      expect(result.current.params.get('tx')).toBe(`${B},${C},${A}`);
    });

    it('keeps the active tab through a reorder', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.openTab(tx(B)));
      act(() => result.current.tabs.activateTab(A));

      act(() => result.current.tabs.reorderTab(A, B));

      expect(result.current.tabs.activeTab).toBe(A);
    });

    it('nudges one place at a time', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.openTab(tx(B)));

      act(() => result.current.tabs.nudgeTab(A, 1));

      expect(result.current.tabs.openTxids).toEqual([B, A]);
    });

    it('leaves the URL untouched when the move changes nothing', () => {
      const { result } = renderTabs();
      act(() => result.current.tabs.openTab(tx(A)));
      act(() => result.current.tabs.openTab(tx(B)));
      const before = result.current.params.toString();

      act(() => result.current.tabs.nudgeTab(A, -1));
      act(() => result.current.tabs.reorderTab(A, C));

      expect(result.current.params.toString()).toBe(before);
      expect(result.current.tabs.openTxids).toEqual([A, B]);
    });
  });
});
