import { Amount } from '../Amount';
import { AnimatedPrice } from './PriceChart/AnimatedPrice';
import { PriceChartBody } from './PriceChart/PriceChartBody';
import { TimeframeControls } from './PriceChart/TimeframeControls';
import type { PriceChartProps } from './PriceChart/types';

export function PriceChart({
  totalBalance,
  chartReady,
  timeframe,
  setTimeframe,
  chartData,
}: PriceChartProps) {
  return (
    <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="flex-shrink-0">
          <p className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">
            Total Balance
          </p>
          <Amount
            sats={totalBalance}
            size="xl"
            className="mt-1 font-bold text-sanctuary-900 dark:text-sanctuary-50"
          />
        </div>
        <div className="flex-1 lg:w-2/3 min-w-[200px]">
          <TimeframeControls timeframe={timeframe} setTimeframe={setTimeframe} />
          <PriceChartBody chartReady={chartReady} chartData={chartData} />
        </div>
      </div>
    </div>
  );
}

export { AnimatedPrice };
export type { PriceChartProps };
