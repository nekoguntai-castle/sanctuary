/**
 * useAITransactionFilter Hook
 *
 * Manages AI-driven transaction filtering, sorting, limiting, and aggregation.
 * Extracted from WalletDetail.tsx to isolate AI query filter concerns.
 */

import { useState, useMemo } from 'react';
import type { Transaction } from '../../../types';
import type { NaturalQueryResult } from '../../../src/api/ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAITransactionFilterParams {
  /** Full (unfiltered) transaction list for this wallet */
  transactions: Transaction[];
}

export interface UseAITransactionFilterReturn {
  /** Current AI query filter (null = no filter active) */
  aiQueryFilter: NaturalQueryResult | null;
  /** Set or clear the AI query filter */
  setAiQueryFilter: (filter: NaturalQueryResult | null) => void;
  /** Transactions after applying the AI filter/sort/limit */
  filteredTransactions: Transaction[];
  /** Computed aggregation value (sum, count, max, min) or null */
  aiAggregationResult: number | null;
}

type NaturalTransactionFilter = NonNullable<NaturalQueryResult['filter']>;
type NaturalTransactionSort = NonNullable<NaturalQueryResult['sort']>;

const getAITransactionType = (tx: Transaction): string => {
  return tx.type === 'received'
    ? 'receive'
    : tx.type === 'sent'
      ? 'send'
      : tx.type ?? '';
};

const matchesAITypeFilter = (tx: Transaction, filter: NaturalTransactionFilter): boolean => {
  return !filter.type || getAITransactionType(tx) === filter.type;
};

const matchesAILabelFilter = (tx: Transaction, filter: NaturalTransactionFilter): boolean => {
  if (!filter.label) {
    return true;
  }

  const labelQuery = String(filter.label).toLowerCase();
  return tx.labels?.some(l => l.name.toLowerCase().includes(labelQuery)) === true;
};

const matchesAIAmountFilter = (tx: Transaction, filter: NaturalTransactionFilter): boolean => {
  if (!filter.amount) {
    return true;
  }

  const absAmount = Math.abs(tx.amount);
  const amountFilter = filter.amount;

  if (typeof amountFilter !== 'object') {
    return true;
  }

  if (amountFilter['>'] && absAmount <= amountFilter['>']) return false;
  if (amountFilter['<'] && absAmount >= amountFilter['<']) return false;
  if (amountFilter['>='] && absAmount < amountFilter['>=']) return false;
  if (amountFilter['<='] && absAmount > amountFilter['<=']) return false;
  return true;
};

const matchesAIConfirmationFilter = (tx: Transaction, filter: NaturalTransactionFilter): boolean => {
  return filter.confirmations === undefined || tx.confirmations === filter.confirmations;
};

const matchesAITransactionFilter = (tx: Transaction, filter: NaturalTransactionFilter): boolean => {
  return (
    matchesAITypeFilter(tx, filter) &&
    matchesAILabelFilter(tx, filter) &&
    matchesAIAmountFilter(tx, filter) &&
    matchesAIConfirmationFilter(tx, filter)
  );
};

const getAISortValue = (tx: Transaction, field: string): number | string => {
  if (field === 'amount') {
    return Math.abs(tx.amount);
  }

  if (field === 'date' || field === 'timestamp') {
    return tx.timestamp || 0;
  }

  if (field === 'confirmations') {
    return tx.confirmations || 0;
  }

  return 0;
};

const compareAISortValues = (
  a: Transaction,
  b: Transaction,
  sort: NaturalTransactionSort
): number => {
  const aVal = getAISortValue(a, sort.field);
  const bVal = getAISortValue(b, sort.field);

  return sort.order === 'desc'
    ? (bVal > aVal ? 1 : -1)
    : (aVal > bVal ? 1 : -1);
};

const applyAITransactionFilter = (
  transactions: Transaction[],
  aiQueryFilter: NaturalQueryResult | null
): Transaction[] => {
  if (!aiQueryFilter || aiQueryFilter.type !== 'transactions') {
    return transactions;
  }

  let result = [...transactions];

  const filter = aiQueryFilter.filter;
  if (filter) {
    result = result.filter(tx => matchesAITransactionFilter(tx, filter));
  }

  const sort = aiQueryFilter.sort;
  if (sort) {
    result.sort((a, b) => compareAISortValues(a, b, sort));
  }

  if (aiQueryFilter.limit && aiQueryFilter.limit > 0) {
    result = result.slice(0, aiQueryFilter.limit);
  }

  return result;
};

const computeAIAggregationResult = (
  transactions: Transaction[],
  aggregation: NaturalQueryResult['aggregation'] | undefined
): number | null => {
  if (!aggregation || transactions.length === 0) {
    return null;
  }

  const amounts = transactions.map(tx => Math.abs(tx.amount));

  switch (aggregation) {
    case 'sum':
      return amounts.reduce((a, b) => a + b, 0);
    case 'count':
      return transactions.length;
    case 'max':
      return Math.max(...amounts);
    case 'min':
      return Math.min(...amounts);
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAITransactionFilter({
  transactions,
}: UseAITransactionFilterParams): UseAITransactionFilterReturn {
  const [aiQueryFilter, setAiQueryFilter] = useState<NaturalQueryResult | null>(null);

  // Apply AI query filter to transactions
  const filteredTransactions = useMemo(() => {
    return applyAITransactionFilter(transactions, aiQueryFilter);
  }, [transactions, aiQueryFilter]);

  // Compute aggregation result if requested
  const aiAggregationResult = useMemo(() => {
    return computeAIAggregationResult(filteredTransactions, aiQueryFilter?.aggregation);
  }, [filteredTransactions, aiQueryFilter?.aggregation]);

  return {
    aiQueryFilter,
    setAiQueryFilter,
    filteredTransactions,
    aiAggregationResult,
  };
}
