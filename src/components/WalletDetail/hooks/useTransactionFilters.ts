/**
 * useTransactionFilters Hook
 *
 * Manages manual transaction filtering by type, date range, confirmation
 * status, and label. Applied before the AI query filter in the pipeline.
 */

import { useState, useMemo, useCallback } from 'react';
import type { Transaction } from '../../../types';
import { isConsolidation } from '../../../utils/transaction';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxTypeFilter = 'all' | 'received' | 'sent' | 'consolidation';
export type ConfirmationFilter = 'all' | 'confirmed' | 'unconfirmed' | 'deep';
export type DatePreset = 'all' | '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

export interface TransactionFilters {
  type: TxTypeFilter;
  confirmations: ConfirmationFilter;
  datePreset: DatePreset;
  dateFrom: number | null;
  dateTo: number | null;
  labelId: string | null;
}

const DEFAULT_FILTERS: TransactionFilters = {
  type: 'all',
  confirmations: 'all',
  datePreset: 'all',
  dateFrom: null,
  dateTo: null,
  labelId: null,
};

export interface UseTransactionFiltersParams {
  transactions: Transaction[];
  walletAddresses: string[];
  confirmationThreshold?: number;
  deepConfirmationThreshold?: number;
}

export interface UseTransactionFiltersReturn {
  filters: TransactionFilters;
  setTypeFilter: (type: TxTypeFilter) => void;
  setConfirmationFilter: (status: ConfirmationFilter) => void;
  setDatePreset: (preset: DatePreset) => void;
  setCustomDateRange: (from: number | null, to: number | null) => void;
  setLabelFilter: (labelId: string | null) => void;
  clearAllFilters: () => void;
  hasActiveFilters: boolean;
  filteredTransactions: Transaction[];
}

interface DateRange {
  from: number;
  to: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getDateRange = (preset: '7d' | '30d' | 'this_month' | 'last_month'): DateRange => {
  const now = new Date();
  const to = now.getTime();

  switch (preset) {
    case '7d':
      return { from: to - 7 * 86_400_000, to };
    case '30d':
      return { from: to - 30 * 86_400_000, to };
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start.getTime(), to };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start.getTime(), to: end.getTime() };
    }
  }
};

const matchesDateFilter = (
  tx: Transaction,
  filters: TransactionFilters,
  dateRange: DateRange | null
): boolean => {
  if (filters.datePreset === 'all') {
    return true;
  }

  const ts = tx.timestamp;
  if (!ts) {
    return false;
  }

  if (filters.datePreset === 'custom') {
    if (filters.dateFrom && ts < filters.dateFrom) return false;
    if (filters.dateTo && ts > filters.dateTo) return false;
    return true;
  }

  return !dateRange || (ts >= dateRange.from && ts <= dateRange.to);
};

const matchesConfirmationFilter = (
  tx: Transaction,
  confirmations: ConfirmationFilter,
  confirmationThreshold: number,
  deepConfirmationThreshold: number
): boolean => {
  switch (confirmations) {
    case 'all':
      return true;
    case 'unconfirmed':
      return tx.confirmations <= 0;
    case 'confirmed':
      return tx.confirmations >= confirmationThreshold;
    case 'deep':
      return tx.confirmations >= deepConfirmationThreshold;
  }

  // Defensive fallback — the switch above is exhaustive over ConfirmationFilter,
  // so TypeScript narrows this branch to `never`. Unreachable at runtime.
  /* c8 ignore next */
  return true;
};

const matchesLabelFilter = (tx: Transaction, labelId: string | null): boolean => {
  if (!labelId) {
    return true;
  }

  return tx.labels?.some(l => l.id === labelId) === true;
};

const matchesTransactionFilters = (
  tx: Transaction,
  filters: TransactionFilters,
  walletAddresses: string[],
  dateRange: DateRange | null,
  confirmationThreshold: number,
  deepConfirmationThreshold: number
): boolean => {
  return (
    matchesTypeFilter(tx, filters.type, walletAddresses) &&
    matchesDateFilter(tx, filters, dateRange) &&
    matchesConfirmationFilter(
      tx,
      filters.confirmations,
      confirmationThreshold,
      deepConfirmationThreshold
    ) &&
    matchesLabelFilter(tx, filters.labelId)
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTransactionFilters({
  transactions,
  walletAddresses,
  confirmationThreshold = 1,
  deepConfirmationThreshold = 3,
}: UseTransactionFiltersParams): UseTransactionFiltersReturn {
  const [filters, setFilters] = useState<TransactionFilters>(DEFAULT_FILTERS);

  const setTypeFilter = useCallback((type: TxTypeFilter) => {
    setFilters(prev => ({ ...prev, type }));
  }, []);

  const setConfirmationFilter = useCallback((confirmations: ConfirmationFilter) => {
    setFilters(prev => ({ ...prev, confirmations }));
  }, []);

  const setDatePreset = useCallback((datePreset: DatePreset) => {
    setFilters(prev => ({
      ...prev,
      datePreset,
      // Clear custom range when switching away from custom
      ...(datePreset !== 'custom' ? { dateFrom: null, dateTo: null } : {}),
    }));
  }, []);

  const setCustomDateRange = useCallback((from: number | null, to: number | null) => {
    setFilters(prev => ({ ...prev, datePreset: 'custom' as DatePreset, dateFrom: from, dateTo: to }));
  }, []);

  const setLabelFilter = useCallback((labelId: string | null) => {
    setFilters(prev => ({ ...prev, labelId }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasActiveFilters =
    filters.type !== 'all' ||
    filters.confirmations !== 'all' ||
    filters.datePreset !== 'all' ||
    filters.labelId !== null;

  const filteredTransactions = useMemo(() => {
    if (!hasActiveFilters) return transactions;

    // Hoist date range computation outside the per-transaction loop
    const dateRange = filters.datePreset !== 'all' && filters.datePreset !== 'custom'
      ? getDateRange(filters.datePreset)
      : null;

    return transactions.filter(tx => matchesTransactionFilters(
      tx,
      filters,
      walletAddresses,
      dateRange,
      confirmationThreshold,
      deepConfirmationThreshold
    ));
  }, [transactions, walletAddresses, filters, confirmationThreshold, deepConfirmationThreshold]);

  return {
    filters,
    setTypeFilter,
    setConfirmationFilter,
    setDatePreset,
    setCustomDateRange,
    setLabelFilter,
    clearAllFilters,
    hasActiveFilters,
    filteredTransactions,
  };
}

function matchesTypeFilter(tx: Transaction, filterType: TxTypeFilter, walletAddresses: string[]): boolean {
  if (filterType === 'all') {
    return true;
  }

  const txIsConsolidation = isConsolidation(tx, walletAddresses);

  if (filterType === 'consolidation') {
    return txIsConsolidation;
  }

  return filterType === 'received'
    ? !txIsConsolidation && tx.amount > 0
    : !txIsConsolidation && tx.amount < 0;
}
