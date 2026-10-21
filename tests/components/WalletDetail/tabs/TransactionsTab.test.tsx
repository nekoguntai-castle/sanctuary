import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { TransactionsTab } from '../../../../src/components/WalletDetail/tabs/TransactionsTab';

const mockRefs = vi.hoisted(() => ({
  txListProps: null as any,
  aiOwnershipKey: null as string | null,
  unit: 'sats' as 'btc' | 'sats',
}));

vi.mock('../../../../src/contexts/CurrencyContext', () => ({
  usePriceFreeFormatter: () => ({
    unit: mockRefs.unit,
    format: (sats: number) =>
      mockRefs.unit === 'sats' ? `${sats.toLocaleString()} sats` : `${(sats / 100_000_000).toFixed(8)} BTC`,
  }),
}));

vi.mock('../../../../src/components/TransactionList', () => ({
  TransactionList: (props: any) => {
    mockRefs.txListProps = props;
    return <div data-testid="transaction-list" />;
  },
}));

vi.mock('../../../../src/components/AIQueryInput', () => ({
  AIQueryInput: ({
    onQueryResult,
    ownershipKey,
  }: {
    onQueryResult: (result: any) => void;
    ownershipKey: string;
  }) => {
    mockRefs.aiOwnershipKey = ownershipKey;
    return (
      <button type="button" onClick={() => onQueryResult({ type: 'summary', aggregation: null })}>
        Run AI Query
      </button>
    );
  },
}));

vi.mock('../../../../src/hooks/queries/useWalletLabels', () => ({
  useWalletLabels: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../../../src/components/WalletDetail/tabs/TransactionFilterBar', () => ({
  TransactionFilterBar: () => <div data-testid="filter-bar" />,
}));

describe('TransactionsTab', () => {
  const baseProps = {
    walletId: 'wallet-1',
    ownershipKey: 'wallet-1:user-1:mainnet',
    transactions: [
      { id: 'tx-1', txid: 'abc', walletId: 'wallet-1', amount: 123, timestamp: Date.now(), type: 'receive' },
      { id: 'tx-2', txid: 'def', walletId: 'wallet-1', amount: -50, timestamp: Date.now(), type: 'sent' },
    ] as any,
    filteredTransactions: [
      { id: 'tx-1', txid: 'abc', walletId: 'wallet-1', amount: 123, timestamp: Date.now(), type: 'receive' },
    ] as any,
    walletAddressStrings: ['bc1qtest'],
    highlightTxId: 'tx-1',
    aiQueryFilter: null,
    onAiQueryChange: vi.fn(),
    aiAggregationResult: null,
    aiEnabled: false,
    transactionStats: { totalSent: 1, totalReceived: 2 } as any,
    hasMoreTx: true,
    loadingMoreTx: false,
    onLoadMore: vi.fn(),
    onLabelsChange: vi.fn(),
    onShowTransactionExport: vi.fn(),
    canEdit: true,
    confirmationThreshold: 1,
    deepConfirmationThreshold: 6,
    walletBalance: 1000,
    filters: { type: 'all' as const, confirmations: 'all' as const, datePreset: 'all' as const, dateFrom: null, dateTo: null, labelId: null },
    onTypeFilterChange: vi.fn(),
    onConfirmationFilterChange: vi.fn(),
    onDatePresetChange: vi.fn(),
    onCustomDateRangeChange: vi.fn(),
    onLabelFilterChange: vi.fn(),
    onClearAllFilters: vi.fn(),
    hasActiveFilters: false,
  };

  it('renders export/load-more and passes stats when no AI filter is active', () => {
    render(<TransactionsTab {...baseProps} />);

    fireEvent.click(screen.getByText('Export'));
    expect(baseProps.onShowTransactionExport).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Load More (2 shown)'));
    expect(baseProps.onLoadMore).toHaveBeenCalled();

    expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
    expect(mockRefs.txListProps.transactionStats).toEqual(baseProps.transactionStats);
    expect(mockRefs.txListProps.highlightedTxId).toBe('tx-1');
    expect(mockRefs.txListProps.walletAddresses).toEqual(['bc1qtest']);
  });

  it('renders AI query summary, can clear filter, and omits stats while filtered', () => {
    const onAiQueryChange = vi.fn();

    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: 'count' }}
        hasMoreTx={false}
        aiAggregationResult={4}
        onAiQueryChange={onAiQueryChange}
      />
    );

    expect(screen.getByText('Run AI Query')).toBeInTheDocument();
    expect(screen.getByText('Result:')).toBeInTheDocument();
    expect(screen.getByText('(count)')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Clear filter'));
    expect(onAiQueryChange).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByText('Run AI Query'));
    expect(onAiQueryChange).toHaveBeenCalledWith({ type: 'summary', aggregation: null });
    expect(mockRefs.aiOwnershipKey).toBe(baseProps.ownershipKey);

    expect(mockRefs.txListProps.transactionStats).toBeUndefined();
  });

  it('shows loading state for load more button', () => {
    render(
      <TransactionsTab
        {...baseProps}
        loadingMoreTx={true}
      />
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('formats non-count aggregation as sats and falls back stats prop to undefined when null', () => {
    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: 'sum' }}
        hasMoreTx={false}
        aiAggregationResult={12345}
        transactionStats={null}
      />
    );

    expect(screen.getByText('12,345 sats')).toBeInTheDocument();
    expect(screen.getByText('(sum)')).toBeInTheDocument();
    expect(mockRefs.txListProps.transactionStats).toBeUndefined();
  });

  it('formats an amount aggregation in BTC when that is the display unit', () => {
    mockRefs.unit = 'btc';
    try {
      render(
        <TransactionsTab
          {...baseProps}
          aiEnabled={true}
          aiQueryFilter={{ type: 'transactions', aggregation: 'sum' }}
          hasMoreTx={false}
          aiAggregationResult={12345}
        />
      );

      expect(screen.getByText('0.00012345 BTC')).toBeInTheDocument();
      expect(screen.queryByText('12,345 sats')).not.toBeInTheDocument();
    } finally {
      mockRefs.unit = 'sats';
    }
  });

  it('shows a count aggregation as a plain number in either unit', () => {
    mockRefs.unit = 'btc';
    try {
      render(
        <TransactionsTab
          {...baseProps}
          aiEnabled={true}
          aiQueryFilter={{ type: 'transactions', aggregation: 'count' }}
          hasMoreTx={false}
          aiAggregationResult={3}
        />
      );

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('(count)')).toBeInTheDocument();
    } finally {
      mockRefs.unit = 'sats';
    }
  });

  it('shows filtered transaction summary when AI filter has no aggregation result', () => {
    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: 'sum' }}
        hasMoreTx={false}
        aiAggregationResult={null}
      />
    );

    expect(screen.getByText('Showing 1 of 2 transactions')).toBeInTheDocument();
  });

  it('shows aggregation results without an aggregation label when none is provided', () => {
    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: null }}
        hasMoreTx={false}
        aiAggregationResult={7}
      />
    );

    expect(screen.getByText('7 sats')).toBeInTheDocument();
    expect(screen.queryByText('(count)')).not.toBeInTheDocument();
    expect(screen.queryByText('(sum)')).not.toBeInTheDocument();
  });

  it('omits transactionStats when hasActiveFilters is true', () => {
    render(
      <TransactionsTab
        {...baseProps}
        hasActiveFilters={true}
      />
    );

    expect(mockRefs.txListProps.transactionStats).toBeUndefined();
  });

  it('renders filter bar when there are transactions', () => {
    render(<TransactionsTab {...baseProps} />);
    expect(screen.getByTestId('filter-bar')).toBeInTheDocument();
  });

  it('omits export, filters, and pagination when there are no transactions', () => {
    render(
      <TransactionsTab
        {...baseProps}
        transactions={[]}
        filteredTransactions={[]}
      />
    );

    expect(screen.queryByText('Export')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-bar')).not.toBeInTheDocument();
    expect(screen.queryByText(/Load More/)).not.toBeInTheDocument();
  });

  it('omits pagination when there are no more transactions', () => {
    render(
      <TransactionsTab
        {...baseProps}
        hasMoreTx={false}
      />
    );

    expect(screen.queryByText(/Load More/)).not.toBeInTheDocument();
  });

  it('falls back transactionStats prop to undefined when no filter and stats are null', () => {
    render(
      <TransactionsTab
        {...baseProps}
        transactionStats={null}
      />
    );

    expect(mockRefs.txListProps.transactionStats).toBeUndefined();
  });
  it('labels an AI aggregate as partial while older pages are unloaded', () => {
    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: 'sum' }}
        aiAggregationResult={12345}
        hasMoreTx={true}
      />
    );

    expect(screen.getByText('Partial result:')).toBeInTheDocument();
    expect(screen.queryByText('Result:')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-filter-partial-notice')).toHaveTextContent(
      'over the 2 loaded transactions; older transactions are not included'
    );
  });

  it('shows no partial notice on a final aggregate', () => {
    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: 'sum' }}
        aiAggregationResult={12345}
        hasMoreTx={false}
      />
    );

    expect(screen.getByText('Result:')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-filter-partial-notice')).not.toBeInTheDocument();
  });

  it('marks a non-aggregate AI filter (sort + limit) as computed over loaded pages only', () => {
    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: null }}
        aiAggregationResult={null}
        hasMoreTx={true}
      />
    );

    expect(screen.getByText('Showing 1 of 2 loaded transactions; more are not loaded')).toBeInTheDocument();
  });

  describe('manual filters over loaded pages only', () => {
    const PARTIAL_TEXT =
      'Partial result: 1 of the 2 loaded transactions match these filters. Older transactions are not included, ' +
      'and the totals below count only these matches. Load more to extend.';
    const EMPTY_MESSAGE = 'No matches in the 2 loaded transactions. Load more to search older transactions.';

    it('marks manual filters as partial while older pages are unloaded', () => {
      render(<TransactionsTab {...baseProps} hasActiveFilters={true} />);

      expect(screen.getByTestId('manual-filter-partial-notice')).toHaveTextContent(PARTIAL_TEXT);
    });

    it('counts only the rows the list renders, not RBF-replaced ones', () => {
      render(
        <TransactionsTab
          {...baseProps}
          hasActiveFilters={true}
          filteredTransactions={[
            ...baseProps.filteredTransactions,
            { id: 'tx-3', txid: 'ghi', walletId: 'wallet-1', amount: 10, timestamp: Date.now(), type: 'receive', rbfStatus: 'replaced' },
          ] as any}
        />
      );

      expect(screen.getByTestId('manual-filter-partial-notice')).toHaveTextContent(PARTIAL_TEXT);
    });

    it('counts only displayable loaded rows, not RBF-replaced ones', () => {
      render(
        <TransactionsTab
          {...baseProps}
          hasActiveFilters={true}
          transactions={[
            ...baseProps.transactions,
            { id: 'tx-3', txid: 'ghi', walletId: 'wallet-1', amount: 10, timestamp: Date.now(), type: 'receive', rbfStatus: 'replaced' },
          ] as any}
        />
      );

      expect(screen.getByTestId('manual-filter-partial-notice')).toHaveTextContent(PARTIAL_TEXT);
      expect(mockRefs.txListProps.emptyMessage).toBe(EMPTY_MESSAGE);
    });

    it('shows no partial notice once the known total is loaded, even when the last page was full', () => {
      render(
        <TransactionsTab
          {...baseProps}
          hasActiveFilters={true}
          transactionStats={{ ...baseProps.transactionStats, totalCount: 2 } as any}
        />
      );

      expect(screen.queryByTestId('manual-filter-partial-notice')).not.toBeInTheDocument();
      expect(mockRefs.txListProps.emptyMessage).toBeUndefined();
    });

    it('stays partial while the known total exceeds the loaded rows', () => {
      render(
        <TransactionsTab
          {...baseProps}
          hasActiveFilters={true}
          transactionStats={{ ...baseProps.transactionStats, totalCount: 3 } as any}
        />
      );

      expect(screen.getByTestId('manual-filter-partial-notice')).toHaveTextContent(PARTIAL_TEXT);
    });

    it('passes a load-more empty message while a filtered result is partial', () => {
      const { unmount } = render(<TransactionsTab {...baseProps} hasActiveFilters={true} />);
      expect(mockRefs.txListProps.emptyMessage).toBe(EMPTY_MESSAGE);
      unmount();

      render(
        <TransactionsTab
          {...baseProps}
          aiEnabled={true}
          aiQueryFilter={{ type: 'transactions', aggregation: null }}
          hasActiveFilters={false}
        />
      );
      expect(mockRefs.txListProps.emptyMessage).toBe(EMPTY_MESSAGE);
    });

    it('shows no manual partial notice once every page is loaded', () => {
      render(<TransactionsTab {...baseProps} hasActiveFilters={true} hasMoreTx={false} />);

      expect(screen.queryByTestId('manual-filter-partial-notice')).not.toBeInTheDocument();
      expect(mockRefs.txListProps.emptyMessage).toBeUndefined();
    });

    it('defers to the AI summary when both AI and manual filters are active', () => {
      render(
        <TransactionsTab
          {...baseProps}
          aiEnabled={true}
          aiQueryFilter={{ type: 'transactions', aggregation: null }}
          hasActiveFilters={true}
        />
      );

      expect(screen.queryByTestId('manual-filter-partial-notice')).not.toBeInTheDocument();
      expect(screen.getByText('Showing 1 of 2 loaded transactions; more are not loaded')).toBeInTheDocument();
      expect(mockRefs.txListProps.emptyMessage).toBe(EMPTY_MESSAGE);
    });

    it('leaves the unfiltered list unchanged', () => {
      render(<TransactionsTab {...baseProps} />);

      expect(screen.queryByTestId('manual-filter-partial-notice')).not.toBeInTheDocument();
      expect(mockRefs.txListProps.emptyMessage).toBeUndefined();
    });

    it('does not claim a partial result before any page has loaded', () => {
      render(
        <TransactionsTab {...baseProps} transactions={[]} filteredTransactions={[]} hasActiveFilters={true} />
      );

      expect(screen.queryByTestId('manual-filter-partial-notice')).not.toBeInTheDocument();
      expect(mockRefs.txListProps.emptyMessage).toBeUndefined();
    });
  });
});
