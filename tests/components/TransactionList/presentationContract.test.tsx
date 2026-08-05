import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TransactionList } from '../../../src/components/TransactionList/TransactionList';
import type { Transaction } from '../../../src/types';

/**
 * Baseline presentation contract for the shared TransactionList.
 *
 * Wallet Detail and Console Results render this component with no presentation
 * options, and both depend on the two defaults locked here: the seven-tile
 * statistics grid, and the 300px-minimum empty state that keeps the wallet
 * viewport from collapsing.
 *
 * The dashboard is about to need neither. These assertions exist so the option
 * that lets the dashboard opt out cannot silently change what the default
 * callers get — the failure mode is invisible in a dashboard-focused diff.
 */

vi.mock('../../../src/contexts/CurrencyContext', () => {
  const value = {
    format: (sats: number) => `${sats.toLocaleString()} sats`,
    unit: 'sats',
  };
  return {
    useCurrency: () => value,
    usePriceFreeFormatter: () => value,
  };
});

vi.mock('../../../src/hooks/useAIStatus', () => ({
  useAIStatus: () => ({ enabled: false, loading: false }),
}));

// Amount pulls fiat formatting and network off the real currency context; this
// contract is about which tiles render, not how a value is formatted.
vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats = 0 }: { sats?: number }) => <span>{sats.toLocaleString()} sats</span>,
}));

vi.mock('react-virtuoso', () => ({
  TableVirtuoso: ({
    data,
    fixedHeaderContent,
    itemContent,
    components,
  }: {
    data: unknown[];
    fixedHeaderContent?: () => React.ReactNode;
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components?: {
      Table?: React.ComponentType<Record<string, unknown>>;
      TableBody?: React.ComponentType<Record<string, unknown>>;
    };
  }) => {
    const Table = components?.Table ?? ((props: Record<string, unknown>) => <table {...props} />);
    const TableBody =
      components?.TableBody ?? ((props: Record<string, unknown>) => <tbody {...props} />);
    return (
      <Table data-testid="virtuoso-table">
        <thead>{fixedHeaderContent?.()}</thead>
        <TableBody>
          {data.map((item, index) => (
            <tr key={index}>{itemContent(index, item)}</tr>
          ))}
        </TableBody>
      </Table>
    );
  },
}));

const transaction = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-1',
    txid: 'a'.repeat(64),
    walletId: 'wallet-1',
    type: 'receive',
    amount: 125_000,
    fee: 500,
    confirmations: 6,
    timestamp: Date.parse('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }) as Transaction;

const renderList = (transactions: Transaction[]) =>
  render(
    <MemoryRouter>
      <TransactionList transactions={transactions} walletId="wallet-1" />
    </MemoryRouter>
  );

describe('TransactionList presentation contract', () => {
  it('renders the statistics grid by default, as Wallet Detail and Console Results rely on', () => {
    renderList([transaction()]);

    const stats = screen.getByTestId('transaction-stats-grid');
    expect(stats).toBeInTheDocument();

    // All seven tiles, not just the container — a partial grid would still
    // satisfy a presence-only assertion. Scoped to the grid because several of
    // these words are also column headers in the table below it.
    for (const label of [
      'Total',
      'Received',
      'Sent',
      'Consolidations',
      'Total In',
      'Total Out',
      'Fees Paid',
    ]) {
      expect(within(stats).getByText(label)).toBeInTheDocument();
    }
  });

  it('reserves a 300px minimum for the default empty state', () => {
    const { container } = renderList([]);

    expect(screen.getByText('No transactions found.')).toBeInTheDocument();
    expect(container.querySelector('.min-h-\\[300px\\]')).not.toBeNull();
  });

  it('still renders the statistics grid when the list is empty', () => {
    renderList([]);

    expect(screen.getByTestId('transaction-stats-grid')).toBeInTheDocument();
  });
});
