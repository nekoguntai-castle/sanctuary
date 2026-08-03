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
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
  chartData: PriceChartPoint[];
  pendingTotals: PendingTotals;
  walletCount: number;
}

export type PriceDirection = 'up' | 'down' | 'none';
