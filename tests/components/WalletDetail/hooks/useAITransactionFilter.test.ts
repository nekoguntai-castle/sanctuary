import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAITransactionFilter } from '../../../../components/WalletDetail/hooks/useAITransactionFilter';

const transactions = [
  {
    id: 'tx-1',
    txid: 'txid-1',
    type: 'received',
    amount: 50_000,
    confirmations: 1,
    timestamp: 1_700_000_000,
    labels: [{ name: 'salary' }],
  },
  {
    id: 'tx-2',
    txid: 'txid-2',
    type: 'sent',
    amount: -12_000,
    confirmations: 0,
    timestamp: 1_700_000_100,
    labels: [{ name: 'groceries' }],
  },
  {
    id: 'tx-3',
    txid: 'txid-3',
    type: 'consolidation',
    amount: -90_000,
    confirmations: 6,
    timestamp: 1_700_000_200,
    labels: [{ name: 'savings' }],
  },
];

describe('useAITransactionFilter', () => {
  it('returns original transactions when no active transaction filter exists', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));
    expect(result.current.filteredTransactions).toHaveLength(3);
    expect(result.current.aiAggregationResult).toBeNull();
  });

  it('filters by type/label/amount/confirmations', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: {
          type: 'receive',
          label: 'sal',
          amount: { '>=': 10_000, '<=': 60_000 },
          confirmations: 1,
        },
      });
    });

    expect(result.current.filteredTransactions).toHaveLength(1);
    expect(result.current.filteredTransactions[0].txid).toBe('txid-1');
  });

  it('returns original transactions when filter type is not transactions', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'wallets' as any,
        sort: { field: 'amount', order: 'desc' },
      });
    });

    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-1', 'txid-2', 'txid-3']);
  });

  it('maps tx types (received/sent/other) when filtering by type', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: { type: 'send' },
      });
    });
    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-2']);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: { type: 'consolidation' as any },
      });
    });
    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-3']);
  });

  it('handles label filter when labels are missing and matches case-insensitively', () => {
    const withMissingLabels = [
      ...transactions,
      {
        id: 'tx-4',
        txid: 'txid-4',
        type: 'received',
        amount: 2_000,
        confirmations: 0,
        timestamp: 1_700_000_300,
      },
    ];
    const { result } = renderHook(() =>
      useAITransactionFilter({ transactions: withMissingLabels as any })
    );

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: { label: 'GRO' },
      });
    });

    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-2']);
  });

  it.each([
    { amountFilter: { '>': 50_000 }, expected: ['txid-3'] },
    { amountFilter: { '<': 13_000 }, expected: ['txid-2'] },
    { amountFilter: { '>=': 90_000 }, expected: ['txid-3'] },
    { amountFilter: { '<=': 12_000 }, expected: ['txid-2'] },
  ])('supports amount operator filter $amountFilter', ({ amountFilter, expected }) => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: { amount: amountFilter },
      });
    });

    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(expected);
  });

  it('ignores non-object amount filters without excluding transactions', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: { amount: 10_000 as any },
      });
    });

    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-1', 'txid-2', 'txid-3']);
  });

  it('filters by exact confirmations value and excludes non-matching transactions', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: { confirmations: 0 },
      });
    });

    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-2']);
  });

  it('applies sort and limit', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'amount', order: 'desc' },
        limit: 2,
      });
    });

    expect(result.current.filteredTransactions).toHaveLength(2);
    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-3', 'txid-1']);
  });

  it('sorts by date/timestamp and confirmations with asc/desc branches', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'date', order: 'asc' },
      });
    });
    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-1', 'txid-2', 'txid-3']);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'timestamp', order: 'desc' },
      });
    });
    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-3', 'txid-2', 'txid-1']);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'confirmations', order: 'asc' },
      });
    });
    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-2', 'txid-1', 'txid-3']);
  });

  it('sorts with timestamp fallbacks and safely handles unknown sort fields', () => {
    const withMissingTimestamp = transactions.map((tx) => ({ ...tx, timestamp: undefined }));
    const { result } = renderHook(() =>
      useAITransactionFilter({ transactions: withMissingTimestamp as any })
    );

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'timestamp', order: 'desc' },
      });
    });
    expect(result.current.filteredTransactions).toHaveLength(3);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'unknown' as any, order: 'asc' },
      });
    });
    expect(result.current.filteredTransactions).toHaveLength(3);
  });

  it('does not apply limit when limit is zero or negative', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'amount', order: 'desc' },
        limit: 0,
      });
    });
    expect(result.current.filteredTransactions).toHaveLength(3);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'amount', order: 'desc' },
        limit: -2,
      });
    });
    expect(result.current.filteredTransactions).toHaveLength(3);
  });

  it('calculates all supported aggregations', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'sum',
      });
    });
    expect(result.current.aiAggregationResult).toBe(152_000);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'count',
      });
    });
    expect(result.current.aiAggregationResult).toBe(3);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'max',
      });
    });
    expect(result.current.aiAggregationResult).toBe(90_000);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'min',
      });
    });
    expect(result.current.aiAggregationResult).toBe(12_000);
  });

  it('returns null aggregation for unsupported aggregation values', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'unknown' as any,
      });
    });

    expect(result.current.aiAggregationResult).toBeNull();
  });

  it('returns null aggregation when filtered transactions are empty', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: { label: 'does-not-exist' },
        aggregation: 'sum',
      });
    });

    expect(result.current.filteredTransactions).toHaveLength(0);
    expect(result.current.aiAggregationResult).toBeNull();
  });
});
