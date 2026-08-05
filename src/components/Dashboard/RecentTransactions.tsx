import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Transaction } from '../../types';
import { TransactionList } from '../TransactionList';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { CollapsibleSection } from '../ui/CollapsibleSection';

export const ACTIVITY_PAGE_SIZES = [5, 10, 20] as const;

interface RecentTransactionsProps {
  recentTx: Transaction[];
  wallets: Wallet[];
  confirmationThreshold: number | undefined;
  deepConfirmationThreshold: number | undefined;
  page: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  recentTx,
  wallets,
  confirmationThreshold,
  deepConfirmationThreshold,
  page,
  pageSize,
  hasPreviousPage,
  hasNextPage,
  isFetching,
  onPageChange,
  onPageSizeChange,
}) => {
  const navigate = useNavigate();

  const firstRow = page * pageSize + 1;
  const lastRow = page * pageSize + recentTx.length;
  // Honest about what is on screen; no invented total, because the endpoint
  // returns a page and never counts the whole set.
  const range = recentTx.length === 0 ? 'No activity' : `Showing ${firstRow}–${lastRow}`;

  // A single page needs no paging chrome at all. An Entries selector beside two
  // permanently disabled arrows is three controls saying "there is nothing more".
  const showFooter = hasPreviousPage || hasNextPage;

  return (
    <CollapsibleSection
      testId="dashboard-recent-activity"
      preferenceKey="viewSettings.dashboard.recentActivityCollapsed"
      // The card shell performs no action of its own; only the disclosure
      // button, the paging controls and the transaction rows do.
      interactive={false}
      padding="md"
      headingClassName="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100"
      headerClassName="flex items-center justify-between gap-4 mb-6"
      title={
        <>
          <Activity className="w-5 h-5 mr-2 text-sanctuary-400" />
          Recent Activity
        </>
      }
      summary={<span className="text-sm text-sanctuary-400">{range}</span>}
    >
      <TransactionList
        // A preview of one page, not the whole history: the seven statistic
        // tiles would describe only what is loaded and read as totals for
        // everything.
        density="compact"
        transactions={recentTx}
        showWalletBadge={true}
        wallets={wallets}
        onWalletClick={(id) => navigate(`/wallets/${id}`)}
        onTransactionClick={(tx) => navigate(`/wallets/${tx.walletId}?tx=${encodeURIComponent(tx.txid)}`)}
        confirmationThreshold={confirmationThreshold}
        deepConfirmationThreshold={deepConfirmationThreshold}
      />

      {showFooter && (
        <div
          data-testid="activity-pagination"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-sanctuary-200 dark:border-sanctuary-800 pt-3"
        >
          <label className="flex items-center gap-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
            Entries
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded border border-sanctuary-200 dark:border-sanctuary-700 bg-transparent px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {ACTIVITY_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-3">
            <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">{range}</span>
            <button
              type="button"
              aria-label="Previous activity page"
              // Also disabled mid-flight: a second click before the request
              // settles would skip a page.
              disabled={!hasPreviousPage || isFetching}
              onClick={() => onPageChange(page - 1)}
              className="rounded p-1 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Next activity page"
              disabled={!hasNextPage || isFetching}
              onClick={() => onPageChange(page + 1)}
              className="rounded p-1 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
};
