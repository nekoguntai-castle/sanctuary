/**
 * TransactionsTab - Transaction list with AI filtering and export
 *
 * Displays the full transaction list with optional AI natural language
 * query filtering, aggregation results, and load-more pagination.
 */

import React from 'react';
import { Download, X } from 'lucide-react';
import { TransactionList } from '../../TransactionList';
import { AIQueryInput } from '../../AIQueryInput';
import { TransactionFilterBar } from './TransactionFilterBar';
import { useWalletLabels } from '../../../hooks/queries/useWalletLabels';
import type { Transaction } from '../../../types';
import type { NaturalQueryResult } from '../../../src/api/ai';
import type { TransactionStats } from '../../../src/api/transactions';
import type { TransactionFilters, TxTypeFilter, ConfirmationFilter, DatePreset } from '../hooks/useTransactionFilters';

interface TransactionsTabProps {
  walletId: string;
  transactions: Transaction[];
  filteredTransactions: Transaction[];
  walletAddressStrings: string[];
  highlightTxId?: string;
  aiQueryFilter: NaturalQueryResult | null;
  onAiQueryChange: (result: NaturalQueryResult | null) => void;
  aiAggregationResult: number | null;
  aiEnabled: boolean;
  transactionStats: TransactionStats | null;
  hasMoreTx: boolean;
  loadingMoreTx: boolean;
  onLoadMore: () => void;
  onLabelsChange: () => void;
  onShowTransactionExport: () => void;
  canEdit: boolean;
  confirmationThreshold?: number;
  deepConfirmationThreshold?: number;
  walletBalance: number;
  // Manual filter props
  filters: TransactionFilters;
  onTypeFilterChange: (type: TxTypeFilter) => void;
  onConfirmationFilterChange: (status: ConfirmationFilter) => void;
  onDatePresetChange: (preset: DatePreset) => void;
  onCustomDateRangeChange: (from: number | null, to: number | null) => void;
  onLabelFilterChange: (labelId: string | null) => void;
  onClearAllFilters: () => void;
  hasActiveFilters: boolean;
}

export const TransactionsTab: React.FC<TransactionsTabProps> = ({
  walletId,
  transactions,
  filteredTransactions,
  walletAddressStrings,
  highlightTxId,
  aiQueryFilter,
  onAiQueryChange,
  aiAggregationResult,
  aiEnabled,
  transactionStats,
  hasMoreTx,
  loadingMoreTx,
  onLoadMore,
  onLabelsChange,
  onShowTransactionExport,
  canEdit,
  confirmationThreshold,
  deepConfirmationThreshold,
  walletBalance,
  filters,
  onTypeFilterChange,
  onConfirmationFilterChange,
  onDatePresetChange,
  onCustomDateRangeChange,
  onLabelFilterChange,
  onClearAllFilters,
  hasActiveFilters,
}) => {
  const { data: walletLabels = [] } = useWalletLabels(walletId);

  return (
    <div className="surface-elevated rounded-xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
      {/* Header with Export Button and AI Query */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        {/* AI Natural Language Query - only show when AI is enabled */}
        {aiEnabled && (
          <div className="flex-1 max-w-xl">
            <AIQueryInput
              walletId={walletId}
              onQueryResult={(result) => onAiQueryChange(result)}
            />
          </div>
        )}
        {/* Export Button */}
        {transactions.length > 0 && (
          <button
            onClick={onShowTransactionExport}
            className="flex items-center px-3 py-1.5 text-sm text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg transition-colors self-end sm:self-auto"
          >
            <Download className="w-4 h-4 mr-1.5" />
            Export
          </button>
        )}
      </div>

      {/* Manual Filter Bar */}
      {transactions.length > 0 && (
        <TransactionFilterBar
          filters={filters}
          onTypeChange={onTypeFilterChange}
          onConfirmationChange={onConfirmationFilterChange}
          onDatePresetChange={onDatePresetChange}
          onCustomDateRangeChange={onCustomDateRangeChange}
          onLabelChange={onLabelFilterChange}
          onClearAll={onClearAllFilters}
          hasActiveFilters={hasActiveFilters}
          labels={walletLabels}
        />
      )}

      {/* AI Filter Results Summary */}
      {aiQueryFilter && (
        <div className="mb-4 p-3 bg-primary-50 dark:bg-sanctuary-800 border border-primary-200 dark:border-sanctuary-600 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {aiAggregationResult !== null ? (
                  <>
                    Result: <span className="font-bold">{aiQueryFilter.aggregation === 'count' ? aiAggregationResult : `${aiAggregationResult.toLocaleString()} sats`}</span>
                    {aiQueryFilter.aggregation && <span className="text-sanctuary-500 ml-1">({aiQueryFilter.aggregation})</span>}
                  </>
                ) : (
                  <>Showing {filteredTransactions.length} of {transactions.length} transactions</>
                )}
              </span>
            </div>
            <button
              onClick={() => onAiQueryChange(null)}
              className="ml-3 p-1.5 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 rounded transition-colors"
              title="Clear filter"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <TransactionList
        transactions={filteredTransactions}
        highlightedTxId={highlightTxId}
        onLabelsChange={onLabelsChange}
        walletAddresses={walletAddressStrings}
        canEdit={canEdit}
        confirmationThreshold={confirmationThreshold}
        deepConfirmationThreshold={deepConfirmationThreshold}
        walletBalance={walletBalance}
        transactionStats={aiQueryFilter || hasActiveFilters ? undefined : (transactionStats || undefined)}
      />
      {hasMoreTx && transactions.length > 0 && (
        <div className="mt-4 text-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMoreTx}
            className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingMoreTx ? (
              <span className="flex items-center justify-center">
                <span className="animate-spin rounded-full h-4 w-4 border border-primary-500 border-t-transparent mr-2" />
                Loading...
              </span>
            ) : (
              `Load More (${transactions.length} shown)`
            )}
          </button>
        </div>
      )}
    </div>
  );
};
