import React from 'react';
import { FILTER_SUMMARY_PANEL_CLASS } from './filterSummaryPanel';

interface ManualFilterPartialNoticeProps {
  /** Matching rows the list renders (RBF-replaced rows excluded). */
  filteredCount: number;
  /** Loaded rows the list can render (RBF-replaced rows excluded). */
  loadedCount: number;
}

/**
 * Says that manual filters, and the totals computed from their matches, cover
 * only the loaded pages. Styled like AiFilterSummary, which says the same for
 * AI filters.
 */
export const ManualFilterPartialNotice: React.FC<ManualFilterPartialNoticeProps> = ({
  filteredCount,
  loadedCount,
}) => (
  <div
    data-testid="manual-filter-partial-notice"
    className={`${FILTER_SUMMARY_PANEL_CLASS} text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100`}
  >
    Partial result: {filteredCount} of the {loadedCount} loaded transactions match these filters. Older transactions
    are not included, and the totals below count only these matches. Load more to extend.
  </div>
);
