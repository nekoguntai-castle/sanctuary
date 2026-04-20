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

export interface PriceChartProps {
  totalBalance: number;
  chartReady: boolean;
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
  chartData: PriceChartPoint[];
}

export type PriceDirection = 'up' | 'down' | 'none';
