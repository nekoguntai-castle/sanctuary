import React from 'react';
import { X } from 'lucide-react';
import type { NaturalQueryResult } from '../../../../api/ai';
import { usePriceFreeFormatter } from '../../../../contexts/CurrencyContext';
import { FILTER_SUMMARY_PANEL_CLASS } from './filterSummaryPanel';

interface AiFilterSummaryProps {
  aiQueryFilter: NaturalQueryResult | null;
  aiAggregationResult: number | null;
  /** Matching rows the list renders (RBF-replaced rows excluded). */
  shownCount: number;
  /** Loaded rows the list can render (RBF-replaced rows excluded). */
  loadedCount: number;
  /** Older pages are unloaded: filtering and aggregation covered only the loaded rows. */
  hasMoreTx: boolean;
  onAiQueryChange: (result: NaturalQueryResult | null) => void;
}

export const AiFilterSummary: React.FC<AiFilterSummaryProps> = ({
  aiQueryFilter,
  aiAggregationResult,
  shownCount,
  loadedCount,
  hasMoreTx,
  onAiQueryChange,
}) => {
  if (!aiQueryFilter) {
    return null;
  }

  const resultLabel = hasMoreTx ? 'Partial result:' : 'Result:';
  const countSuffix = hasMoreTx ? 'loaded transactions; more are not loaded' : 'transactions';

  return (
    <div className={FILTER_SUMMARY_PANEL_CLASS}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {aiAggregationResult !== null ? (
              <>
                {resultLabel} <span className="font-bold"><AggregationValue aiQueryFilter={aiQueryFilter} value={aiAggregationResult} /></span>
                {aiQueryFilter.aggregation && <span className="text-sanctuary-500 ml-1">({aiQueryFilter.aggregation})</span>}
                {hasMoreTx && (
                  <span data-testid="ai-filter-partial-notice" className="text-sanctuary-500 ml-1">
                    {'\u2014'} over the {loadedCount} loaded transactions; older transactions are not included. Load more to extend.
                  </span>
                )}
              </>
            ) : (
              <>Showing {shownCount} of {loadedCount} {countSuffix}</>
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

// A count is a number of transactions; every other aggregation is an amount
// and follows the user's BTC/sats preference.
function AggregationValue({ aiQueryFilter, value }: { aiQueryFilter: NaturalQueryResult; value: number }) {
  const { format } = usePriceFreeFormatter();
  return <>{aiQueryFilter.aggregation === 'count' ? value : format(value)}</>;
}
