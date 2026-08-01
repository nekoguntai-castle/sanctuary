import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Amount } from '../Amount';
import { AnimatedPrice } from './PriceChart/AnimatedPrice';
import { PriceChartBody } from './PriceChart/PriceChartBody';
import { TimeframeControls } from './PriceChart/TimeframeControls';
import type { PriceChartProps, PendingTotals } from './PriceChart/types';

/**
 * Incoming and outgoing are shown separately, never netted — a pending +100k
 * receive against a -100k send is not "nothing pending".
 *
 * Icons and colours follow the existing pending vocabulary
 * (WalletList/WalletGridCardBalance + walletGridCardStyles.pendingNetClass):
 * ArrowDownLeft/success for incoming, ArrowUpRight/sent for outgoing. `sent-*`
 * rather than `warning-*`, which means "multisig/caution" elsewhere.
 */
function PendingTotalsRow({ pendingTotals }: { pendingTotals: PendingTotals }) {
  const { incoming, outgoing } = pendingTotals;

  if (incoming === 0 && outgoing === 0) {
    return null;
  }

  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs">
      {incoming > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowDownLeft className="w-3.5 h-3.5 text-success-500 shrink-0" />
          <Amount sats={incoming} size="sm" inline className="text-success-600 dark:text-success-400" />
        </span>
      )}
      {outgoing > 0 && (
        <span className="inline-flex items-center gap-1">
          <ArrowUpRight className="w-3.5 h-3.5 text-sent-500 shrink-0" />
          <Amount sats={outgoing} size="sm" inline className="text-sent-600 dark:text-sent-400" />
        </span>
      )}
      <span className="text-sanctuary-400">pending</span>
    </div>
  );
}

export function PriceChart({
  totalBalance,
  chartReady,
  timeframe,
  setTimeframe,
  chartData,
  pendingTotals,
  walletCount,
}: PriceChartProps) {
  return (
    <div className="surface-elevated rounded-xl p-5 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
      {/* Eyebrow and timeframe share a row — the controls used to occupy a full
          row of their own above the chart. */}
      <div className="flex items-center justify-between gap-4 mb-1">
        <p className="text-[11px] font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-[0.08em]">
          Total Balance
        </p>
        <TimeframeControls timeframe={timeframe} setTimeframe={setTimeframe} />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* The left column was two lines against a ~170px chart; the pending
            delta and wallet count fill that dead space with the numbers that
            previously had nowhere to live. */}
        <div className="flex-shrink-0 space-y-1">
          <Amount
            sats={totalBalance}
            size="xl"
            className="font-bold text-sanctuary-900 dark:text-sanctuary-50"
          />
          <PendingTotalsRow pendingTotals={pendingTotals} />
          <p className="text-xs text-sanctuary-400">
            across {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
          </p>
        </div>
        <div className="flex-1 lg:w-2/3 min-w-[200px]">
          <PriceChartBody chartReady={chartReady} chartData={chartData} />
        </div>
      </div>
    </div>
  );
}

export { AnimatedPrice };
export type { PriceChartProps };
