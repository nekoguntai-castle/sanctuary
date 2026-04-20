/**
 * TransactionsTab - Transaction list with AI filtering and export
 *
 * Displays the full transaction list with optional AI natural language
 * query filtering, aggregation results, and load-more pagination.
 */

import React from 'react';
import { TransactionList } from '../../TransactionList';
import { useWalletLabels } from '../../../hooks/queries/useWalletLabels';
import { AiFilterSummary } from './TransactionsTab/AiFilterSummary';
import { LoadMoreTransactions } from './TransactionsTab/LoadMoreTransactions';
import { TransactionsFilterSection } from './TransactionsTab/TransactionsFilterSection';
import { TransactionsTabHeader } from './TransactionsTab/TransactionsTabHeader';
import { getTransactionStatsForList } from './TransactionsTab/transactionStats';
import type { TransactionsTabProps } from './TransactionsTab/types';

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
  const transactionsCount = transactions.length;

  return (
    <div className="surface-elevated rounded-xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
      <TransactionsTabHeader
        walletId={walletId}
        aiEnabled={aiEnabled}
        transactionsCount={transactionsCount}
        onAiQueryChange={onAiQueryChange}
        onShowTransactionExport={onShowTransactionExport}
      />
      <TransactionsFilterSection
        transactions={transactions}
        filters={filters}
        onTypeFilterChange={onTypeFilterChange}
        onConfirmationFilterChange={onConfirmationFilterChange}
        onDatePresetChange={onDatePresetChange}
        onCustomDateRangeChange={onCustomDateRangeChange}
        onLabelFilterChange={onLabelFilterChange}
        onClearAllFilters={onClearAllFilters}
        hasActiveFilters={hasActiveFilters}
        labels={walletLabels}
      />
      <AiFilterSummary
        aiQueryFilter={aiQueryFilter}
        aiAggregationResult={aiAggregationResult}
        filteredTransactions={filteredTransactions}
        transactions={transactions}
        onAiQueryChange={onAiQueryChange}
      />

      <TransactionList
        transactions={filteredTransactions}
        highlightedTxId={highlightTxId}
        onLabelsChange={onLabelsChange}
        walletAddresses={walletAddressStrings}
        walletLabels={walletLabels}
        canEdit={canEdit}
        confirmationThreshold={confirmationThreshold}
        deepConfirmationThreshold={deepConfirmationThreshold}
        walletBalance={walletBalance}
        transactionStats={getTransactionStatsForList(transactionStats, aiQueryFilter, hasActiveFilters)}
      />
      <LoadMoreTransactions
        hasMoreTx={hasMoreTx}
        transactionsCount={transactionsCount}
        loadingMoreTx={loadingMoreTx}
        onLoadMore={onLoadMore}
      />
    </div>
  );
};
