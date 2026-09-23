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
  /** The hovered point's time, epoch milliseconds. */
  label?: number;
  /** Renders `label` for the period shown — see `buildBalanceTimeAxis`. */
  formatLabel: (t: number) => string;
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
  /** Epoch milliseconds — the chart's x axis is real time. */
  t: number;
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
  /**
   * The history request failed and returned nothing, so `chartData` is the
   * flat placeholder rather than real history.
   */
  historyUnavailable?: boolean;
  /** The pending request failed and returned nothing — not "nothing pending". */
  pendingUnavailable?: boolean;
}

export type PriceDirection = 'up' | 'down' | 'none';
