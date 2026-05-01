import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTransactionFilters } from '../../../../components/WalletDetail/hooks/useTransactionFilters';
import type { Transaction } from '../../../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WALLET_ADDRESSES = ['addr_wallet_1', 'addr_wallet_2'];

function makeTx(overrides: Partial<Transaction> & { id: string }): Transaction {
  return {
    txid: `txid-${overrides.id}`,
    walletId: 'w1',
    amount: 10_000,
    confirmations: 6,
    timestamp: 1_700_000_000,
    ...overrides,
  } as Transaction;
}

const txReceived = makeTx({ id: 'rx', amount: 50_000, confirmations: 3, timestamp: 1_700_000_100 });
const txSent = makeTx({ id: 'sx', amount: -20_000, confirmations: 2, timestamp: 1_700_000_200 });
const txConsolidationType = makeTx({ id: 'cx', amount: -5_000, type: 'consolidation', confirmations: 10, timestamp: 1_700_000_300 });
const txConsolidationByAddr = makeTx({
  id: 'ca',
  amount: -3_000,
  type: 'sent',
  counterpartyAddress: 'addr_wallet_1',
  confirmations: 4,
  timestamp: 1_700_000_400,
});
const txUnconfirmed = makeTx({ id: 'ux', amount: 1_000, confirmations: 0, timestamp: 1_700_000_500 });
const txPending = makeTx({ id: 'px', amount: 500, confirmations: 0, timestamp: undefined as unknown as number });
const txLabeled = makeTx({
  id: 'lx',
  amount: 7_000,
  confirmations: 6,
  timestamp: 1_700_000_600,
  labels: [{ id: 'lbl-1', walletId: 'w1', name: 'salary', color: '#00ff00' }],
});
const txMultiLabel = makeTx({
  id: 'ml',
  amount: 2_000,
  confirmations: 1,
  timestamp: 1_700_000_700,
  labels: [
    { id: 'lbl-2', walletId: 'w1', name: 'groceries', color: '#ff0000' },
    { id: 'lbl-1', walletId: 'w1', name: 'salary', color: '#00ff00' },
  ],
});

const allTransactions: Transaction[] = [
  txReceived,
  txSent,
  txConsolidationType,
  txConsolidationByAddr,
  txUnconfirmed,
  txPending,
  txLabeled,
  txMultiLabel,
];

const MID_MONTH_TEST_TIME = new Date(2026, 4, 15, 12).getTime();

function renderFilters(
  transactions: Transaction[] = allTransactions,
  walletAddresses: string[] = WALLET_ADDRESSES,
  confirmationThreshold?: number,
  deepConfirmationThreshold?: number,
) {
  return renderHook(() =>
    useTransactionFilters({
      transactions,
      walletAddresses,
      ...(confirmationThreshold !== undefined ? { confirmationThreshold } : {}),
      ...(deepConfirmationThreshold !== undefined ? { deepConfirmationThreshold } : {}),
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTransactionFilters', () => {
  // -----------------------------------------------------------------------
  // Default / no filters
  // -----------------------------------------------------------------------

  it('returns all transactions with no active filters by default', () => {
    const { result } = renderFilters();
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filteredTransactions).toEqual(allTransactions);
    expect(result.current.filters).toEqual({
      type: 'all',
      confirmations: 'all',
      datePreset: 'all',
      dateFrom: null,
      dateTo: null,
      labelId: null,
    });
  });

  // -----------------------------------------------------------------------
  // Type filter
  // -----------------------------------------------------------------------

  describe('type filter', () => {
    it('received: excludes consolidations and non-positive amounts', () => {
      const { result } = renderFilters();
      act(() => result.current.setTypeFilter('received'));

      expect(result.current.hasActiveFilters).toBe(true);
      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // txReceived (50k), txUnconfirmed (1k), txPending (500), txLabeled (7k), txMultiLabel (2k) are positive, non-consolidation
      expect(ids).toContain('rx');
      expect(ids).toContain('ux');
      expect(ids).toContain('lx');
      expect(ids).toContain('ml');
      // txSent is negative, consolidations are excluded
      expect(ids).not.toContain('sx');
      expect(ids).not.toContain('cx');
      expect(ids).not.toContain('ca');
    });

    it('sent: excludes consolidations and non-negative amounts', () => {
      const { result } = renderFilters();
      act(() => result.current.setTypeFilter('sent'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toEqual(['sx']);
    });

    it('consolidation: only consolidation transactions', () => {
      const { result } = renderFilters();
      act(() => result.current.setTypeFilter('consolidation'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toContain('cx'); // type === 'consolidation'
      expect(ids).toContain('ca'); // counterpartyAddress in walletAddresses
      expect(ids).toHaveLength(2);
    });

    it('all: returns everything (no type filtering)', () => {
      const { result } = renderFilters();
      act(() => result.current.setTypeFilter('received'));
      act(() => result.current.setTypeFilter('all'));

      expect(result.current.filters.type).toBe('all');
    });
  });

  // -----------------------------------------------------------------------
  // Consolidation detection
  // -----------------------------------------------------------------------

  describe('consolidation detection', () => {
    it('detects tx.type === consolidation', () => {
      const { result } = renderFilters([txConsolidationType]);
      act(() => result.current.setTypeFilter('consolidation'));
      expect(result.current.filteredTransactions).toHaveLength(1);
    });

    it('detects counterpartyAddress in walletAddresses when type is not consolidation', () => {
      const { result } = renderFilters([txConsolidationByAddr]);
      act(() => result.current.setTypeFilter('consolidation'));
      expect(result.current.filteredTransactions).toHaveLength(1);
      expect(result.current.filteredTransactions[0].id).toBe('ca');
    });

    it('non-consolidation tx with no counterpartyAddress is not a consolidation', () => {
      const { result } = renderFilters([txReceived]);
      act(() => result.current.setTypeFilter('consolidation'));
      expect(result.current.filteredTransactions).toHaveLength(0);
    });

    it('tx with counterpartyAddress NOT in walletAddresses is not a consolidation', () => {
      const externalTx = makeTx({
        id: 'ext',
        amount: -1_000,
        type: 'sent',
        counterpartyAddress: 'addr_external',
      });
      const { result } = renderFilters([externalTx]);
      act(() => result.current.setTypeFilter('consolidation'));
      expect(result.current.filteredTransactions).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Date filter
  // -----------------------------------------------------------------------

  describe('date filter', () => {
    it('7d: includes transactions within last 7 days', () => {
      const now = Date.now();
      const recent = makeTx({ id: 'recent', timestamp: now - 3 * 86_400_000 });
      const old = makeTx({ id: 'old', timestamp: now - 10 * 86_400_000 });

      const { result } = renderFilters([recent, old]);
      act(() => result.current.setDatePreset('7d'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toContain('recent');
      expect(ids).not.toContain('old');
    });

    it('30d: includes transactions within last 30 days', () => {
      const now = Date.now();
      const recent = makeTx({ id: 'r30', timestamp: now - 15 * 86_400_000 });
      const old = makeTx({ id: 'o30', timestamp: now - 60 * 86_400_000 });

      const { result } = renderFilters([recent, old]);
      act(() => result.current.setDatePreset('30d'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toContain('r30');
      expect(ids).not.toContain('o30');
    });

    it('this_month: includes transactions from start of current month', () => {
      vi.useFakeTimers({ now: MID_MONTH_TEST_TIME });

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const inMonth = makeTx({ id: 'tm', timestamp: startOfMonth + 86_400_000 });
      const beforeMonth = makeTx({ id: 'bm', timestamp: startOfMonth - 86_400_000 });

      const { result } = renderFilters([inMonth, beforeMonth]);
      act(() => result.current.setDatePreset('this_month'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toContain('tm');
      expect(ids).not.toContain('bm');
    });

    it('last_month: includes transactions from previous month only', () => {
      vi.useFakeTimers({ now: MID_MONTH_TEST_TIME });

      const now = new Date();
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const inLastMonth = makeTx({ id: 'lm', timestamp: startOfLastMonth + 86_400_000 });
      const inThisMonth = makeTx({ id: 'tm2', timestamp: startOfThisMonth + 86_400_000 });
      const beforeLastMonth = makeTx({ id: 'blm', timestamp: startOfLastMonth - 86_400_000 });

      const { result } = renderFilters([inLastMonth, inThisMonth, beforeLastMonth]);
      act(() => result.current.setDatePreset('last_month'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toContain('lm');
      expect(ids).not.toContain('tm2');
      expect(ids).not.toContain('blm');
    });

    it('custom: filters by dateFrom and dateTo', () => {
      const { result } = renderFilters();
      act(() => result.current.setCustomDateRange(1_700_000_150, 1_700_000_350));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // txSent (ts 200), txConsolidationType (ts 300) are in range
      expect(ids).toContain('sx');
      expect(ids).toContain('cx');
      // txReceived (ts 100) is before range
      expect(ids).not.toContain('rx');
      // txConsolidationByAddr (ts 400) is after range
      expect(ids).not.toContain('ca');
    });

    it('custom: only dateFrom set (dateTo null) filters from start', () => {
      const { result } = renderFilters();
      act(() => result.current.setCustomDateRange(1_700_000_350, null));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // Only transactions at or after 350: ca (400), ux (500), lx (600), ml (700)
      expect(ids).toContain('ca');
      expect(ids).toContain('ux');
      expect(ids).toContain('lx');
      expect(ids).toContain('ml');
      expect(ids).not.toContain('rx');
      expect(ids).not.toContain('sx');
    });

    it('custom: only dateTo set (dateFrom null) filters until end', () => {
      const { result } = renderFilters();
      act(() => result.current.setCustomDateRange(null, 1_700_000_250));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // txReceived (100), txSent (200) are in range
      expect(ids).toContain('rx');
      expect(ids).toContain('sx');
      // txConsolidationByAddr (400) etc. are after dateTo
      expect(ids).not.toContain('ca');
    });

    it('custom: both dateFrom and dateTo null does not filter by date', () => {
      const { result } = renderFilters();
      act(() => result.current.setCustomDateRange(null, null));

      // datePreset is 'custom' but both dateFrom/dateTo are null
      // Pending tx (no timestamp) is still excluded because datePreset !== 'all'
      expect(result.current.filters.datePreset).toBe('custom');
      expect(result.current.filters.dateFrom).toBeNull();
      expect(result.current.filters.dateTo).toBeNull();
      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // All transactions with timestamps pass, but pending (no timestamp) is excluded
      expect(ids).not.toContain('px');
      expect(ids).toContain('rx');
      expect(ids).toContain('sx');
    });

    it('excludes pending transactions with no timestamp', () => {
      const { result } = renderFilters([txPending, txReceived]);
      act(() => result.current.setDatePreset('7d'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).not.toContain('px');
    });
  });

  // -----------------------------------------------------------------------
  // Confirmation filter
  // -----------------------------------------------------------------------

  describe('confirmation filter', () => {
    it('unconfirmed: only transactions with 0 confirmations', () => {
      const { result } = renderFilters();
      act(() => result.current.setConfirmationFilter('unconfirmed'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toContain('ux');
      expect(ids).toContain('px');
      expect(ids).not.toContain('rx'); // confirmations: 3
      expect(ids).not.toContain('sx'); // confirmations: 2
    });

    it('confirmed: uses default threshold of 1', () => {
      const { result } = renderFilters();
      act(() => result.current.setConfirmationFilter('confirmed'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // All with confirmations >= 1
      expect(ids).toContain('rx');
      expect(ids).toContain('sx');
      expect(ids).toContain('lx');
      // Unconfirmed excluded
      expect(ids).not.toContain('ux');
      expect(ids).not.toContain('px');
    });

    it('confirmed: uses custom threshold', () => {
      const { result } = renderFilters(allTransactions, WALLET_ADDRESSES, 3);
      act(() => result.current.setConfirmationFilter('confirmed'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // Only txReceived (3), txConsolidationType (10), txConsolidationByAddr (4), txLabeled (6) have >= 3
      expect(ids).toContain('rx');
      expect(ids).toContain('cx');
      expect(ids).toContain('ca');
      expect(ids).toContain('lx');
      // txSent (2), txUnconfirmed (0), txPending (0), txMultiLabel (1) have < 3
      expect(ids).not.toContain('sx');
      expect(ids).not.toContain('ux');
      expect(ids).not.toContain('px');
      expect(ids).not.toContain('ml');
    });

    it('deep: uses default threshold of 3', () => {
      const { result } = renderFilters();
      act(() => result.current.setConfirmationFilter('deep'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // Only >= 3: txReceived (3), txConsolidationType (10), txConsolidationByAddr (4), txLabeled (6)
      expect(ids).toContain('rx');
      expect(ids).toContain('cx');
      expect(ids).toContain('ca');
      expect(ids).toContain('lx');
      // txSent (2), txUnconfirmed (0), txPending (0), txMultiLabel (1)
      expect(ids).not.toContain('sx');
      expect(ids).not.toContain('ux');
    });

    it('deep: uses custom deepConfirmationThreshold', () => {
      const { result } = renderFilters(allTransactions, WALLET_ADDRESSES, undefined, 6);
      act(() => result.current.setConfirmationFilter('deep'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // Only >= 6: txConsolidationType (10), txLabeled (6)
      expect(ids).toContain('cx');
      expect(ids).toContain('lx');
      expect(ids).not.toContain('rx'); // 3 < 6
      expect(ids).not.toContain('sx'); // 2 < 6
    });
  });

  // -----------------------------------------------------------------------
  // Label filter
  // -----------------------------------------------------------------------

  describe('label filter', () => {
    it('filters by labelId', () => {
      const { result } = renderFilters();
      act(() => result.current.setLabelFilter('lbl-1'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toContain('lx');
      expect(ids).toContain('ml'); // Has lbl-1 as second label
      expect(ids).toHaveLength(2);
    });

    it('excludes transactions without labels', () => {
      const { result } = renderFilters();
      act(() => result.current.setLabelFilter('lbl-2'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toEqual(['ml']);
    });

    it('excludes transactions with undefined labels array', () => {
      const noLabelTx = makeTx({ id: 'nl', amount: 1_000 });
      const { result } = renderFilters([noLabelTx]);
      act(() => result.current.setLabelFilter('lbl-1'));

      expect(result.current.filteredTransactions).toHaveLength(0);
    });

    it('clearing label filter (null) removes label filtering', () => {
      const { result } = renderFilters();
      act(() => result.current.setLabelFilter('lbl-1'));
      expect(result.current.filteredTransactions.length).toBeLessThan(allTransactions.length);

      act(() => result.current.setLabelFilter(null));
      // labelId is null => no label filtering, but since all other filters are 'all',
      // hasActiveFilters is false and all transactions are returned
      expect(result.current.filters.labelId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Combined filters
  // -----------------------------------------------------------------------

  describe('combined filters', () => {
    it('applies type + confirmation filters together', () => {
      const { result } = renderFilters();

      act(() => {
        result.current.setTypeFilter('received');
        result.current.setConfirmationFilter('confirmed');
      });

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // received + confirmed (>=1): txReceived (3), txLabeled (6), txMultiLabel (1)
      expect(ids).toContain('rx');
      expect(ids).toContain('lx');
      expect(ids).toContain('ml');
      // txUnconfirmed is received but unconfirmed, txPending is received but 0 confirmations
      expect(ids).not.toContain('ux');
      expect(ids).not.toContain('px');
    });

    it('applies type + label filters together', () => {
      const { result } = renderFilters();

      act(() => {
        result.current.setTypeFilter('received');
        result.current.setLabelFilter('lbl-1');
      });

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // received + has label lbl-1: txLabeled (positive, lbl-1), txMultiLabel (positive, has lbl-1)
      expect(ids).toContain('lx');
      expect(ids).toContain('ml');
      expect(ids).toHaveLength(2);
    });

    it('applies date + confirmation + type filters together', () => {
      const now = Date.now();
      const recentReceived = makeTx({ id: 'rr', amount: 5_000, confirmations: 2, timestamp: now - 86_400_000 });
      const recentSent = makeTx({ id: 'rs', amount: -1_000, confirmations: 2, timestamp: now - 86_400_000 });
      const oldReceived = makeTx({ id: 'or', amount: 3_000, confirmations: 5, timestamp: now - 60 * 86_400_000 });

      const { result } = renderFilters([recentReceived, recentSent, oldReceived]);

      act(() => {
        result.current.setTypeFilter('received');
        result.current.setDatePreset('7d');
        result.current.setConfirmationFilter('confirmed');
      });

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      expect(ids).toEqual(['rr']);
    });
  });

  // -----------------------------------------------------------------------
  // clearAllFilters
  // -----------------------------------------------------------------------

  describe('clearAllFilters', () => {
    it('resets all filters to defaults', () => {
      const { result } = renderFilters();

      act(() => {
        result.current.setTypeFilter('sent');
        result.current.setConfirmationFilter('deep');
        result.current.setCustomDateRange(100, 200);
        result.current.setLabelFilter('lbl-1');
      });

      expect(result.current.hasActiveFilters).toBe(true);

      act(() => result.current.clearAllFilters());

      expect(result.current.filters).toEqual({
        type: 'all',
        confirmations: 'all',
        datePreset: 'all',
        dateFrom: null,
        dateTo: null,
        labelId: null,
      });
      expect(result.current.hasActiveFilters).toBe(false);
      expect(result.current.filteredTransactions).toEqual(allTransactions);
    });
  });

  // -----------------------------------------------------------------------
  // setCustomDateRange
  // -----------------------------------------------------------------------

  describe('setCustomDateRange', () => {
    it('sets datePreset to custom', () => {
      const { result } = renderFilters();
      act(() => result.current.setCustomDateRange(100, 200));

      expect(result.current.filters.datePreset).toBe('custom');
      expect(result.current.filters.dateFrom).toBe(100);
      expect(result.current.filters.dateTo).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // setDatePreset
  // -----------------------------------------------------------------------

  describe('setDatePreset', () => {
    it('clears custom range when switching away from custom', () => {
      const { result } = renderFilters();

      act(() => result.current.setCustomDateRange(100, 200));
      expect(result.current.filters.dateFrom).toBe(100);
      expect(result.current.filters.dateTo).toBe(200);

      act(() => result.current.setDatePreset('7d'));
      expect(result.current.filters.datePreset).toBe('7d');
      expect(result.current.filters.dateFrom).toBeNull();
      expect(result.current.filters.dateTo).toBeNull();
    });

    it('preserves custom range when setting preset to custom', () => {
      const { result } = renderFilters();

      act(() => result.current.setCustomDateRange(100, 200));
      // Setting to 'custom' again should not clear the custom range
      act(() => result.current.setDatePreset('custom'));
      expect(result.current.filters.datePreset).toBe('custom');
      // dateFrom/dateTo were set by setCustomDateRange, setDatePreset('custom') doesn't clear them
      expect(result.current.filters.dateFrom).toBe(100);
      expect(result.current.filters.dateTo).toBe(200);
    });

    it('setting preset to all clears custom range and removes date filter', () => {
      const { result } = renderFilters();
      act(() => result.current.setCustomDateRange(100, 200));
      act(() => result.current.setDatePreset('all'));

      expect(result.current.filters.datePreset).toBe('all');
      expect(result.current.filters.dateFrom).toBeNull();
      expect(result.current.filters.dateTo).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // hasActiveFilters
  // -----------------------------------------------------------------------

  describe('hasActiveFilters', () => {
    it('is false when all filters are at defaults', () => {
      const { result } = renderFilters();
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it('is true when type filter is not all', () => {
      const { result } = renderFilters();
      act(() => result.current.setTypeFilter('sent'));
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('is true when confirmation filter is not all', () => {
      const { result } = renderFilters();
      act(() => result.current.setConfirmationFilter('unconfirmed'));
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('is true when date preset is not all', () => {
      const { result } = renderFilters();
      act(() => result.current.setDatePreset('30d'));
      expect(result.current.hasActiveFilters).toBe(true);
    });

    it('is true when label filter is set', () => {
      const { result } = renderFilters();
      act(() => result.current.setLabelFilter('lbl-1'));
      expect(result.current.hasActiveFilters).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty transactions array', () => {
      const { result } = renderFilters([]);
      expect(result.current.filteredTransactions).toEqual([]);
      expect(result.current.hasActiveFilters).toBe(false);
    });

    it('handles empty walletAddresses', () => {
      const { result } = renderFilters(allTransactions, []);
      act(() => result.current.setTypeFilter('consolidation'));

      const ids = result.current.filteredTransactions.map(tx => tx.id);
      // Only type === 'consolidation' matches, not counterpartyAddress (empty addresses array)
      expect(ids).toContain('cx');
      expect(ids).not.toContain('ca'); // counterpartyAddress won't match empty array
      expect(ids).toHaveLength(1);
    });

    it('sent filter excludes zero-amount transactions', () => {
      const zeroTx = makeTx({ id: 'z0', amount: 0 });
      const { result } = renderFilters([zeroTx]);
      act(() => result.current.setTypeFilter('sent'));
      // amount >= 0 => excluded by sent filter
      expect(result.current.filteredTransactions).toHaveLength(0);
    });

    it('received filter excludes zero-amount transactions', () => {
      const zeroTx = makeTx({ id: 'z0', amount: 0 });
      const { result } = renderFilters([zeroTx]);
      act(() => result.current.setTypeFilter('received'));
      // amount <= 0 => excluded by received filter
      expect(result.current.filteredTransactions).toHaveLength(0);
    });

    it('tx with counterpartyAddress but no type field is detected as consolidation if address matches', () => {
      const tx = makeTx({
        id: 'nc',
        amount: -2_000,
        counterpartyAddress: 'addr_wallet_2',
      });
      // type is undefined (not set)
      const { result } = renderFilters([tx]);
      act(() => result.current.setTypeFilter('consolidation'));
      expect(result.current.filteredTransactions).toHaveLength(1);
    });
  });
});
