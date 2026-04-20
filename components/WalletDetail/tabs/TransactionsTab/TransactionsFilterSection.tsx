import React from 'react';
import { TransactionFilterBar } from '../TransactionFilterBar';
import type { Label } from '../../../../types';
import type { TransactionsTabProps } from './types';

type FilterSectionProps = Pick<
  TransactionsTabProps,
  | 'transactions'
  | 'filters'
  | 'onTypeFilterChange'
  | 'onConfirmationFilterChange'
  | 'onDatePresetChange'
  | 'onCustomDateRangeChange'
  | 'onLabelFilterChange'
  | 'onClearAllFilters'
  | 'hasActiveFilters'
> & {
  labels: Label[];
};

export const TransactionsFilterSection: React.FC<FilterSectionProps> = ({
  transactions,
  filters,
  onTypeFilterChange,
  onConfirmationFilterChange,
  onDatePresetChange,
  onCustomDateRangeChange,
  onLabelFilterChange,
  onClearAllFilters,
  hasActiveFilters,
  labels,
}) => {
  if (transactions.length === 0) {
    return null;
  }

  return (
    <TransactionFilterBar
      filters={filters}
      onTypeChange={onTypeFilterChange}
      onConfirmationChange={onConfirmationFilterChange}
      onDatePresetChange={onDatePresetChange}
      onCustomDateRangeChange={onCustomDateRangeChange}
      onLabelChange={onLabelFilterChange}
      onClearAll={onClearAllFilters}
      hasActiveFilters={hasActiveFilters}
      labels={labels}
    />
  );
};
