import type { Timeframe } from '../hooks/useDashboardData';

export interface AnimatedPriceProps {
  value: number | null;
  symbol: string;
}

export interface ChartTooltipPayload {
  value: number;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  label?: string;
  /**
   * The app-wide sats formatter from `usePriceFreeFormatter`, so the tooltip
   * renders in the reader's selected unit without keeping a second copy of the
   * formatting rules. Required — recharts' `cloneElement` merges its own props
   * over this element and never supplies one, so a default would only mask a
   * caller that stopped passing it.
   */
  format: (sats: number) => string;
}

export interface PriceChartPoint {
  name: string;
  sats: number;
}

/** Unconfirmed sats per direction, both positive. Never netted. */
export interface PendingTotals {
  incoming: number;
  outgoing: number;
}

export interface PriceChartProps {
  totalBalance: number;
  chartReady: boolean;
  /** Read-only here; the selector that sets it lives in the page header. */
  timeframe: Timeframe;
  chartData: PriceChartPoint[];
  pendingTotals: PendingTotals;
  walletCount: number;
}

export type PriceDirection = 'up' | 'down' | 'none';
