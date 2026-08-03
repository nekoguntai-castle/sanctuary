/**
 * TransactionFilterBar - Compact filter controls for the transaction list
 *
 * Renders a horizontal bar with chip-style type toggles, date/confirmation
 * dropdowns, and an optional label filter. Sits between the AI search bar
 * and the transaction list.
 */

import React from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, X, ListFilter } from 'lucide-react';
import type { TransactionFilters, TxTypeFilter, ConfirmationFilter, DatePreset } from '../hooks/useTransactionFilters';
import type { Label } from '../../../types';

interface TransactionFilterBarProps {
  filters: TransactionFilters;
  onTypeChange: (type: TxTypeFilter) => void;
  onConfirmationChange: (status: ConfirmationFilter) => void;
  onDatePresetChange: (preset: DatePreset) => void;
  onCustomDateRangeChange: (from: number | null, to: number | null) => void;
  onLabelChange: (labelId: string | null) => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  labels: Label[];
}

const TYPE_OPTIONS: { value: TxTypeFilter; label: string; icon?: React.ReactNode }[] = [
  { value: 'all', label: 'All' },
  { value: 'received', label: 'Received', icon: <ArrowDownLeft className="w-3 h-3" /> },
  { value: 'sent', label: 'Sent', icon: <ArrowUpRight className="w-3 h-3" /> },
  { value: 'consolidation', label: 'Consolidation', icon: <RefreshCw className="w-3 h-3" /> },
];

function toDateInputValue(ts: number | null): string {
  if (ts === null) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

function fromDateInputValue(value: string): number | null {
  if (!value) return null;
  return new Date(value + 'T00:00:00').getTime();
}

function fromDateInputValueEndOfDay(value: string): number | null {
  if (!value) return null;
  return new Date(value + 'T23:59:59.999').getTime();
}

export const TransactionFilterBar: React.FC<TransactionFilterBarProps> = ({
  filters,
  onTypeChange,
  onConfirmationChange,
  onDatePresetChange,
  onCustomDateRangeChange,
  onLabelChange,
  onClearAll,
  hasActiveFilters,
  labels,
}) => {
  const selectClass =
    'h-7 text-xs rounded-md border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100 pl-2 pr-6 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition-colors appearance-none cursor-pointer';

  return (
    <div className="border-b border-sanctuary-200 dark:border-sanctuary-800 pb-4 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-sanctuary-400 dark:text-sanctuary-500 mr-0.5">
          <ListFilter className="w-3.5 h-3.5" />
        </div>

        <div className="flex items-center gap-1 p-0.5 surface-secondary rounded-md">
          {TYPE_OPTIONS.map(({ value, label, icon }) => {
            const isActive = filters.type === value;
            return (
              <button
                key={value}
                onClick={() => onTypeChange(value)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-primary-600 text-white dark:bg-primary-200 dark:text-primary-900 shadow-sm'
                    : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-800 dark:hover:text-sanctuary-200 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-700'
                }`}
              >
                {icon}
                {label}
              </button>
            );
          })}
        </div>

        <div className="w-px h-5 bg-sanctuary-200 dark:bg-sanctuary-700 hidden sm:block" />

        <select
          value={filters.datePreset}
          onChange={(e) => onDatePresetChange(e.target.value as DatePreset)}
          className={selectClass}
        >
          <option value="all">All Time</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="custom">Custom Range</option>
        </select>

        {filters.datePreset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={toDateInputValue(filters.dateFrom)}
              onChange={(e) => onCustomDateRangeChange(fromDateInputValue(e.target.value), filters.dateTo)}
              className={`${selectClass} w-[130px] pl-2 pr-2`}
            />
            <span className="text-[10px] text-sanctuary-400">to</span>
            <input
              type="date"
              value={toDateInputValue(filters.dateTo)}
              onChange={(e) => onCustomDateRangeChange(filters.dateFrom, fromDateInputValueEndOfDay(e.target.value))}
              className={`${selectClass} w-[130px] pl-2 pr-2`}
            />
          </div>
        )}

        <select
          value={filters.confirmations}
          onChange={(e) => onConfirmationChange(e.target.value as ConfirmationFilter)}
          className={selectClass}
        >
          <option value="all">All Status</option>
          <option value="unconfirmed">Unconfirmed</option>
          <option value="confirmed">Confirmed</option>
          <option value="deep">Deeply Confirmed</option>
        </select>

        {labels.length > 0 && (
          <select
            value={filters.labelId || ''}
            onChange={(e) => onLabelChange(e.target.value || null)}
            className={selectClass}
          >
            <option value="">All Labels</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        )}

        {hasActiveFilters && (
          <button
            onClick={onClearAll}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
};
