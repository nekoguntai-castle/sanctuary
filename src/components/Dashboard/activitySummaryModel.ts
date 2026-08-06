import type { ActivitySummary } from '../../api/transactions/types';
import type { Timeframe } from './hooks/useDashboardData';

/**
 * Human phrase for the selected period, ready to follow "in".
 *
 * `ALL` has no entry on purpose: "in all time" is not English, and the callers
 * below drop the period clause entirely for it. `balanceTrendModel` keeps its
 * own map because its phrases follow "over", where `all time` does read.
 */
const TIMEFRAME_LABELS: Record<Exclude<Timeframe, 'ALL'>, string> = {
  '1D': 'the past day',
  '1W': 'the past week',
  '1M': 'the past month',
  '1Y': 'the past year',
};

function periodClause(timeframe: Timeframe): string {
  return timeframe === 'ALL' ? '' : ` in ${TIMEFRAME_LABELS[timeframe]}`;
}

export interface ActivitySummaryParts {
  /** `14 confirmed in the past week`, or the empty-period sentence. */
  countLabel: string;
  /** True when nothing confirmed in the period, so callers drop the rest. */
  isEmpty: boolean;
}

/**
 * Describes confirmed activity for the period in words.
 *
 * `undefined` in means "not known yet" and yields `null` out — a bar reading
 * "0 confirmed" while the query is still in flight states something false
 * about the reader's money. Callers render nothing until this returns.
 *
 * Two things the label has to carry, because nothing else on screen does:
 *
 * - **"confirmed"**, because this counts settled transactions only — the same
 *   filter the balance chart applies — while the list below also shows
 *   unconfirmed rows, so the two can legitimately disagree. A `title` tooltip
 *   would explain it to mouse users only.
 * - **the period**, because the control that sets it lives in a different card
 *   and the count changes silently when it moves.
 */
export function buildActivitySummaryParts(
  summary: ActivitySummary | undefined,
  timeframe: Timeframe
): ActivitySummaryParts | null {
  if (!summary) {
    return null;
  }

  if (summary.count === 0) {
    // "0 confirmed · 0 sats · never" is three ways of saying the same nothing.
    const label = timeframe === 'ALL' ? 'No confirmed activity yet' : `No activity${periodClause(timeframe)}`;
    return { countLabel: label, isEmpty: true };
  }

  return {
    countLabel: `${summary.count.toLocaleString()} confirmed${periodClause(timeframe)}`,
    isEmpty: false,
  };
}
