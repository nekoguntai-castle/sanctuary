import type { Timeframe } from '../hooks/useDashboardData';
import type { PriceChartPoint } from './types';

export type TrendDirection = 'gain' | 'loss' | 'flat';

export interface BalanceTrend {
  direction: TrendDirection;
  /** Balance at the start of the selected period, in sats. */
  openingSats: number;
  /** Balance at the end of the selected period, in sats. */
  closingSats: number;
  /** Signed change over the period. Positive means the balance grew. */
  deltaSats: number;
  /**
   * Percentage change, or null when it cannot be stated honestly — which is any
   * time the opening balance is zero. A wallet going from 0 to 100,000 sats has
   * not grown by "infinity percent"; it has grown by 100,000 sats.
   */
  percentChange: number | null;
  /**
   * Human phrase for the selected period, ready to follow "over" — e.g.
   * `the past week`, or `all time`, which takes no article.
   */
  timeframeLabel: string;
}

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1D': 'the past day',
  '1W': 'the past week',
  '1M': 'the past month',
  '1Y': 'the past year',
  ALL: 'all time',
};

/**
 * Describes how the BTC balance moved across the selected period.
 *
 * This is balance/net flow, not investment return: it says nothing about what
 * the coins were worth in fiat at either end.
 *
 * A period needs two usable readings to describe a change. Empty histories,
 * single points, and histories whose values are not finite numbers are all
 * reported as flat rather than guessed at.
 */
export function buildBalanceTrend(
  points: readonly PriceChartPoint[],
  timeframe: Timeframe
): BalanceTrend {
  const timeframeLabel = TIMEFRAME_LABELS[timeframe];
  const usable = points.filter(point => Number.isFinite(point?.sats));

  if (usable.length < 2) {
    // One reading is a position, not a movement. Report the balance we do know
    // (or zero) and call the direction flat.
    const only = usable.length === 1 ? usable[0].sats : 0;
    return {
      direction: 'flat',
      openingSats: only,
      closingSats: only,
      deltaSats: 0,
      percentChange: null,
      timeframeLabel,
    };
  }

  const openingSats = usable[0].sats;
  const closingSats = usable[usable.length - 1].sats;
  const deltaSats = closingSats - openingSats;

  return {
    direction: deltaSats === 0 ? 'flat' : deltaSats > 0 ? 'gain' : 'loss',
    openingSats,
    closingSats,
    deltaSats,
    // Guard the divide rather than letting it produce Infinity or NaN.
    percentChange: openingSats === 0 ? null : (deltaSats / Math.abs(openingSats)) * 100,
    timeframeLabel,
  };
}

/**
 * `+125,000 sats (+4.2%) over the past week`, or the same without the
 * percentage when there is no meaningful basis for one.
 *
 * The sign is always written out. Colour alone must never be the thing that
 * tells a reader whether they gained or lost.
 */
export function formatBalanceTrend(trend: BalanceTrend): string {
  if (trend.direction === 'flat') {
    return `No change over ${trend.timeframeLabel}`;
  }

  const sign = trend.deltaSats > 0 ? '+' : '-';
  const sats = `${sign}${Math.abs(trend.deltaSats).toLocaleString()} sats`;
  const percent =
    trend.percentChange === null
      ? ''
      : ` (${sign}${Math.abs(trend.percentChange).toFixed(1)}%)`;

  return `${sats}${percent} over ${trend.timeframeLabel}`;
}
