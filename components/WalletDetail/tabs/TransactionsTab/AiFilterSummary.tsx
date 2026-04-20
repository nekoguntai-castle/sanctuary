import React from 'react';
import { X } from 'lucide-react';
import type { Transaction } from '../../../../types';
import type { NaturalQueryResult } from '../../../../src/api/ai';

interface AiFilterSummaryProps {
  aiQueryFilter: NaturalQueryResult | null;
  aiAggregationResult: number | null;
  filteredTransactions: Transaction[];
  transactions: Transaction[];
  onAiQueryChange: (result: NaturalQueryResult | null) => void;
}

export const AiFilterSummary: React.FC<AiFilterSummaryProps> = ({
  aiQueryFilter,
  aiAggregationResult,
  filteredTransactions,
  transactions,
  onAiQueryChange,
}) => {
  if (!aiQueryFilter) {
    return null;
  }

  return (
    <div className="mb-4 p-3 bg-primary-50 dark:bg-sanctuary-800 border border-primary-200 dark:border-sanctuary-600 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {aiAggregationResult !== null ? (
              <>
                Result: <span className="font-bold">{formatAggregationValue(aiQueryFilter, aiAggregationResult)}</span>
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
  );
};

function formatAggregationValue(aiQueryFilter: NaturalQueryResult, value: number): string | number {
  if (aiQueryFilter.aggregation === 'count') {
    return value;
  }

  return `${value.toLocaleString()} sats`;
}
