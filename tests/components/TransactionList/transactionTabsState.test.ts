import { describe, expect, it } from 'vitest';
import {
  LIST_TAB,
  MAX_OPEN_TABS,
  nextActiveAfterClose,
  nudgeTxid,
  parseFloatingTxids,
  parseOpenTxids,
  reorderTxids,
  resolveActiveTab,
  serializeOpenTxids,
} from '../../../src/components/TransactionList/hooks/transactionTabsState';

const txid = (marker: string) => marker.repeat(64);
const A = txid('a');
const B = txid('b');
const C = txid('c');

describe('transaction tab URL state', () => {
  describe('parseOpenTxids', () => {
    it('reads a legacy single-transaction link as one open tab', () => {
      // `?tx=<txid>` predates tabs and is still handed around in links.
      expect(parseOpenTxids(A)).toEqual([A]);
    });

    it('reads a comma-separated list in order', () => {
      expect(parseOpenTxids(`${A},${B},${C}`)).toEqual([A, B, C]);
    });

    it('normalizes case and whitespace, matching how txids are compared elsewhere', () => {
      expect(parseOpenTxids(` ${A.toUpperCase()} , ${B} `)).toEqual([A, B]);
    });

    it('drops blanks and repeats rather than opening a duplicate tab', () => {
      expect(parseOpenTxids(`${A},,${A},${B},`)).toEqual([A, B]);
    });

    it('treats a missing or empty parameter as no open tabs', () => {
      expect(parseOpenTxids(null)).toEqual([]);
      expect(parseOpenTxids('')).toEqual([]);
    });

    it('caps the list, since every tab costs a request and the URL is user input', () => {
      const many = Array.from({ length: MAX_OPEN_TABS + 5 }, (_, index) =>
        String(index).padStart(64, '0'));

      expect(parseOpenTxids(many.join(','))).toHaveLength(MAX_OPEN_TABS);
    });
  });

  it('round-trips through serializeOpenTxids', () => {
    expect(parseOpenTxids(serializeOpenTxids([A, B]))).toEqual([A, B]);
  });

  describe('resolveActiveTab', () => {
    it('lands on the first open transaction when no tab is named', () => {
      // What makes a legacy `?tx=<txid>` link open that transaction's detail
      // rather than the list.
      expect(resolveActiveTab([A, B], null)).toBe(A);
    });

    it('honours an explicitly requested transaction tab', () => {
      expect(resolveActiveTab([A, B], B)).toBe(B);
      expect(resolveActiveTab([A, B], B.toUpperCase())).toBe(B);
    });

    it('honours an explicit list tab even with tabs open', () => {
      expect(resolveActiveTab([A, B], LIST_TAB)).toBe(LIST_TAB);
    });

    it('falls back to the first tab when the named one is not open', () => {
      // A stale link, or a tab that closed itself because it did not resolve.
      expect(resolveActiveTab([A], B)).toBe(A);
    });

    it('shows the list when nothing is open', () => {
      expect(resolveActiveTab([], null)).toBe(LIST_TAB);
      expect(resolveActiveTab([], B)).toBe(LIST_TAB);
    });
  });

  describe('nextActiveAfterClose', () => {
    it('keeps the active tab when a different one closes', () => {
      expect(nextActiveAfterClose([A, B, C], A, B)).toBe(B);
    });

    it('moves to the right neighbour', () => {
      expect(nextActiveAfterClose([A, B, C], B, B)).toBe(C);
    });

    it('moves to the left neighbour when the last tab closes', () => {
      expect(nextActiveAfterClose([A, B, C], C, C)).toBe(B);
    });

    it('falls back to the list when the only tab closes', () => {
      expect(nextActiveAfterClose([A], A, A)).toBe(LIST_TAB);
    });
  });

  describe('parseFloatingTxids', () => {
    it('reads which open transactions are floating', () => {
      expect(parseFloatingTxids(`${B}`, [A, B])).toEqual([B]);
    });

    it('ignores a floating entry with no tab behind it', () => {
      // A hand-edited link could otherwise conjure a panel for a transaction
      // that is not open at all.
      expect(parseFloatingTxids(`${C}`, [A, B])).toEqual([]);
    });

    it('keeps the parameter order, which is the panels stacking order', () => {
      expect(parseFloatingTxids(`${B},${A}`, [A, B])).toEqual([B, A]);
    });

    it('normalizes and dedupes like the open list does', () => {
      expect(parseFloatingTxids(` ${A.toUpperCase()} ,${A}`, [A])).toEqual([A]);
      expect(parseFloatingTxids(null, [A])).toEqual([]);
    });
  });

  describe('with floating panels', () => {
    it('never makes a floating transaction the active tab', () => {
      // Its panel is already on screen; selecting its tab would show the same
      // transaction twice and point the strip at a panel that is not in it.
      expect(resolveActiveTab([A, B], A, [A])).toBe(B);
      expect(resolveActiveTab([A, B], null, [A])).toBe(B);
    });

    it('falls back to the list when every open transaction is floating', () => {
      expect(resolveActiveTab([A, B], null, [A, B])).toBe(LIST_TAB);
    });

    it('skips floating tabs when choosing the neighbour after a close', () => {
      expect(nextActiveAfterClose([A, B, C], A, A, [B])).toBe(C);
    });

    it('falls back to the list when only floating tabs remain', () => {
      expect(nextActiveAfterClose([A, B], A, A, [B])).toBe(LIST_TAB);
    });

    it('takes the left neighbour when the closed tab was last', () => {
      expect(nextActiveAfterClose([A, B, C], C, C, [])).toBe(B);
    });
  });

  describe('reorderTxids', () => {
    it('moves a tab to the position of the one it was dropped on', () => {
      expect(reorderTxids([A, B, C], A, C)).toEqual([B, C, A]);
      expect(reorderTxids([A, B, C], C, A)).toEqual([C, A, B]);
    });

    it('returns the same list, by identity, when nothing moves', () => {
      // Callers skip the URL write on identity, so a no-op drop leaves no
      // history entry behind.
      const open = [A, B];
      expect(reorderTxids(open, A, A)).toBe(open);
      expect(reorderTxids(open, A, C)).toBe(open);
      expect(reorderTxids(open, C, A)).toBe(open);
    });
  });

  describe('nudgeTxid', () => {
    it('moves a tab one place in either direction', () => {
      expect(nudgeTxid([A, B, C], B, 1)).toEqual([A, C, B]);
      expect(nudgeTxid([A, B, C], B, -1)).toEqual([B, A, C]);
    });

    it('holds at the ends rather than wrapping', () => {
      const open = [A, B, C];
      expect(nudgeTxid(open, A, -1)).toBe(open);
      expect(nudgeTxid(open, C, 1)).toBe(open);
    });

    it('ignores a tab that is not open', () => {
      const open = [A, B];
      expect(nudgeTxid(open, C, 1)).toBe(open);
    });
  });
});
