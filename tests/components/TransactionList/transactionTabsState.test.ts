import { describe, expect, it } from 'vitest';
import {
  LIST_TAB,
  MAX_OPEN_TABS,
  nextActiveAfterClose,
  parseOpenTxids,
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
});
