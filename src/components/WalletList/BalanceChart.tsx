import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Amount } from '../Amount';
import { useBalanceHistory } from '../../hooks/queries/useWallets';
import { useDelayedRender } from '../../hooks/useDelayedRender';
import type { Timeframe } from '../../api/transactions/types';
import { BALANCE_TIMEFRAMES, buildBalanceSeries, buildBalanceTimeAxis } from '../../utils/balanceHistorySeries';
import { Card } from '../ui/Card';

interface BalanceChartProps {
  totalBalance: number;
  walletCount: number;
  walletIds: string[];
  selectedNetwork: string;
  /** Owned by the page: the wallet cards' sparklines follow the same period. */
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
}

const BALANCE_CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-chart-tooltip-bg)',
  border: 'none',
  borderRadius: '8px',
  color: 'var(--color-chart-tooltip-text)',
};

/**
 * Displays the total balance summary and a historical balance area chart
 * with selectable timeframe controls.
 */
export const BalanceChart: React.FC<BalanceChartProps> = ({
  totalBalance,
  walletCount,
  walletIds,
  selectedNetwork,
  timeframe,
  onTimeframeChange,
}) => {

  // Delay chart render to avoid Recharts dimension warning during initial layout
  const chartReady = useDelayedRender();

  // Fetch real balance history from transactions
  const { data: history } = useBalanceHistory(walletIds, totalBalance, timeframe);
  const chartData = useMemo(() => buildBalanceSeries(history, timeframe), [history, timeframe]);
  const timeAxis = useMemo(() => buildBalanceTimeAxis(chartData, timeframe), [chartData, timeframe]);

  return (
    <Card padding="sm">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-1/3 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide mb-1">Total Balance</h3>
            <Amount
              sats={totalBalance}
              size="lg"
              className="font-bold text-sanctuary-900 dark:text-sanctuary-50"
            />
            <p className="text-xs text-sanctuary-400 mt-2">
              {walletCount} {selectedNetwork} wallet{walletCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="md:w-2/3">
          <div className="flex justify-end mb-2">
            <div className="flex space-x-0.5 surface-secondary p-0.5 rounded-lg">
              {BALANCE_TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  aria-pressed={timeframe === tf}
                  onClick={() => onTimeframeChange(tf)}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${timeframe === tf ? 'bg-white dark:bg-sanctuary-600 text-sanctuary-900 dark:text-sanctuary-50 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <div className="h-36 w-full min-w-[200px]">
            {chartReady && (
              <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorOverview" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-series-success)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--color-chart-series-success)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis
                    {...timeAxis.xAxisProps}
                    axisLine={false}
                    tickLine={false}
                    tick={{fontSize: 10, fill: 'var(--color-chart-axis)'}}
                  />
                  <Tooltip
                    labelFormatter={(t) => timeAxis.formatTooltip(Number(t))}
                    contentStyle={BALANCE_CHART_TOOLTIP_STYLE}
                    itemStyle={{ color: 'var(--color-chart-series-success)' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--color-chart-series-success)" strokeWidth={2} fillOpacity={1} fill="url(#colorOverview)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};
