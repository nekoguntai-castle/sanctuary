import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Transaction } from '../../types';
import { TransactionList } from '../TransactionList';
import { Activity, ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { SectionSummary } from '../ui/SectionSummary';
import { usePriceFreeFormatter } from '../../contexts/CurrencyContext';
import { formatRelativeTime } from '../../utils/relativeTime';
import { buildActivitySummaryParts } from './activitySummaryModel';
import type { ActivitySummary } from '../../api/transactions/types';
import type { Timeframe } from './hooks/useDashboardData';

export const ACTIVITY_PAGE_SIZES = [5, 10, 20] as const;

/**
 * Headline figures shown while the section is collapsed.
 *
 * Directions are carried separately and both are positive, following the same
 * rule as the dashboard's pending totals: a period that received and spent the
 * same amount is real activity, not an empty period, and a single netted figure
 * would render it as zero. Icons and colours match the established vocabulary
 * (PriceChart's PendingTotalsRow) — ArrowDownLeft/success in, ArrowUpRight/sent
 * out, with the amount carrying the colour too.
 *
 * Amounts come from `usePriceFreeFormatter`, not `<Amount>`. This bar holds up
 * to four figures inside a `truncate`, and Amount would append a fiat span to
 * each direction — enough to clip the row silently, with no way to reveal the
 * rest.
 *
 * No `dark:` variants on the success/sent colours. Those palettes are
 * CSS-variable-backed and each theme already inverts them between light and
 * dark, so `text-success-600` resolves correctly in both — exactly as the chart
 * series do with `var(--color-success-600)`. A `dark:` override would fight
 * that, and `dark:text-success-400` in particular emits no CSS at all: the
 * success and sent scales skip 300 and 400 entirely.
 */
function ActivityCollapsedSummary({
  summary,
  timeframe,
  isError,
}: {
  summary: ActivitySummary | undefined;
  timeframe: Timeframe;
  isError: boolean;
}) {
  const { format } = usePriceFreeFormatter();
  const parts = buildActivitySummaryParts(summary, timeframe);

  // A failed aggregate must not look like a still-loading one. Loading is
  // transient and resolves itself; an error does not, and a permanently bare
  // header reads as "nothing happened" rather than "we could not tell".
  if (isError && !parts) {
    return <SectionSummary testId="dashboard-activity-summary" parts={['Activity unavailable']} />;
  }

  // Nothing known yet. Rendering zeroes here would state something false.
  if (!parts || !summary) {
    return null;
  }

  if (parts.isEmpty) {
    return <SectionSummary testId="dashboard-activity-summary" parts={[parts.countLabel]} />;
  }

  const latest = summary.latestAt ? formatRelativeTime(summary.latestAt) : null;

  return (
    <SectionSummary
      testId="dashboard-activity-summary"
      parts={[
        parts.countLabel,
        summary.receivedSats > 0 && (
          <span key="in" className="inline-flex items-center gap-1 text-success-600">
            <ArrowDownLeft className="w-3.5 h-3.5 text-success-500 shrink-0" aria-hidden="true" />
            {format(summary.receivedSats)}
          </span>
        ),
        summary.sentSats > 0 && (
          <span key="out" className="inline-flex items-center gap-1 text-sent-600">
            <ArrowUpRight className="w-3.5 h-3.5 text-sent-500 shrink-0" aria-hidden="true" />
            {format(summary.sentSats)}
          </span>
        ),
        latest,
      ]}
    />
  );
}

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
  /** Period-scoped confirmed totals; undefined until the query resolves. */
  activitySummary: ActivitySummary | undefined;
  /** True when the aggregate failed, so the bar can say so rather than stay blank. */
  activitySummaryError: boolean;
  timeframe: Timeframe;
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
  activitySummary,
  activitySummaryError,
  timeframe,
  onPageChange,
  onPageSizeChange,
}) => {
  const navigate = useNavigate();

  const firstRow = page * pageSize + 1;
  const lastRow = page * pageSize + recentTx.length;
  // Honest about what is on screen; no invented total, because the endpoint
  // returns a page and never counts the whole set. Page-scoped, and worded
  // distinctly from the header's period-scoped empty state — that one is about
  // the timeframe, this one is about the current page.
  const range = recentTx.length === 0 ? 'No rows on this page' : `Showing ${firstRow}–${lastRow}`;

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
      // Not the paging range: "Showing 1–10" describes what is on screen, and
      // while collapsed nothing is. The period figures say something the
      // reader cannot otherwise see without expanding.
      summary={
        <ActivityCollapsedSummary
          summary={activitySummary}
          timeframe={timeframe}
          isError={activitySummaryError}
        />
      }
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
