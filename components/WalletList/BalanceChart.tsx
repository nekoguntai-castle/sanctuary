import React, { useState } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Amount } from '../Amount';
import { useBalanceHistory } from '../../hooks/queries/useWallets';
import { useDelayedRender } from '../../hooks/useDelayedRender';

type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

interface BalanceChartProps {
  totalBalance: number;
  walletCount: number;
  walletIds: string[];
  selectedNetwork: string;
}

/**
 * Displays the total balance summary and a historical balance area chart
 * with selectable timeframe controls.
 */
export const BalanceChart: React.FC<BalanceChartProps> = ({
  totalBalance,
  walletCount,
  walletIds,
  selectedNetwork,
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');

  // Delay chart render to avoid Recharts dimension warning during initial layout
  const chartReady = useDelayedRender();

  // Fetch real balance history from transactions
  const { data: chartData } = useBalanceHistory(walletIds, totalBalance, timeframe);

  return (
    <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
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
              {(['1D', '1W', '1M', '1Y', 'ALL'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
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
                      <stop offset="5%" stopColor="var(--color-success-500)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--color-success-500)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#a39e93'}} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1c1c1e', border: 'none', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: 'var(--color-success-500)' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="var(--color-success-500)" strokeWidth={2} fillOpacity={1} fill="url(#colorOverview)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
