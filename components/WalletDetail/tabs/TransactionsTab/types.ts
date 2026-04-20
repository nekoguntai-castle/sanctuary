import type { Transaction } from '../../../../types';
import type { NaturalQueryResult } from '../../../../src/api/ai';
import type { TransactionStats } from '../../../../src/api/transactions';
import type { ConfirmationFilter, DatePreset, TransactionFilters, TxTypeFilter } from '../../hooks/useTransactionFilters';

export interface TransactionsTabProps {
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
  filters: TransactionFilters;
  onTypeFilterChange: (type: TxTypeFilter) => void;
  onConfirmationFilterChange: (status: ConfirmationFilter) => void;
  onDatePresetChange: (preset: DatePreset) => void;
  onCustomDateRangeChange: (from: number | null, to: number | null) => void;
  onLabelFilterChange: (labelId: string | null) => void;
  onClearAllFilters: () => void;
  hasActiveFilters: boolean;
}
