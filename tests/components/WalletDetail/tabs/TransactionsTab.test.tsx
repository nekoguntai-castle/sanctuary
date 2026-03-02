import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionsTab } from '../../../../components/WalletDetail/tabs/TransactionsTab';

const mockRefs = vi.hoisted(() => ({
  txListProps: null as any,
}));

vi.mock('../../../../components/TransactionList', () => ({
  TransactionList: (props: any) => {
    mockRefs.txListProps = props;
    return <div data-testid="transaction-list" />;
  },
}));

vi.mock('../../../../components/AIQueryInput', () => ({
  AIQueryInput: ({ onQueryResult }: { onQueryResult: (result: any) => void }) => (
    <button type="button" onClick={() => onQueryResult({ type: 'summary', aggregation: null })}>
      Run AI Query
    </button>
  ),
}));

describe('TransactionsTab', () => {
  const baseProps = {
    walletId: 'wallet-1',
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
        aiAggregationResult={12345}
        transactionStats={null}
      />
    );

    expect(screen.getByText('12,345 sats')).toBeInTheDocument();
    expect(screen.getByText('(sum)')).toBeInTheDocument();
    expect(mockRefs.txListProps.transactionStats).toBeUndefined();
  });

  it('shows filtered transaction summary when AI filter has no aggregation result', () => {
    render(
      <TransactionsTab
        {...baseProps}
        aiEnabled={true}
        aiQueryFilter={{ type: 'transactions', aggregation: 'sum' }}
        aiAggregationResult={null}
      />
    );

    expect(screen.getByText('Showing 1 of 2 transactions')).toBeInTheDocument();
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
});
